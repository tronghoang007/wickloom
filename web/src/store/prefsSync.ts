import { drawingGlobal, type CursorMode, type DrawingDefaults, type DrawingGlobal, type MagnetMode } from "@/drawings/store";
import { apiFetch } from "@/lib/api";
import { useAuthStore } from "./auth";

// Tuỳ chọn công cụ vẽ theo TÀI KHOẢN như TradingView (hình vẽ thì theo layout, xem drawings/doc.ts): mặc định từng công cụ (màu, độ dày, Row Size của FRVP...),
// thanh yêu thích, nam châm, giữ công cụ sau khi vẽ, công cụ gần nhất, kiểu con trỏ.
//  - khách: chỉ nhớ trong localStorage (`tv-drawing-prefs`) như trước;
//  - user: nằm ở `/me/prefs` (một document `{ v: 1, ...các khoá bên dưới }`): đăng nhập thì lấy về, đổi thì lưu lên; localStorage vẫn giữ một bản để mở nhanh / khi backend tắt.
//    Vị trí thanh yêu thích (`favoritesPos`) ở lại máy vì nó theo kích thước màn hình.
// Server thắng ở khoá nó đã có; khoá server chưa có thì giá trị đang có trên máy được đưa lên. Đổi trước khi lấy xong: khoá đó bên vừa đổi thắng (mặc định công cụ gộp theo từng công cụ).

const PREFS_VERSION = 1;
const SAVE_DELAY = 800;
const RETRY_MS = 10_000;

type ToolDefaults = Record<string, DrawingDefaults>;
type Synced = Pick<DrawingGlobal, "toolDefaults" | "favorites" | "showFavs" | "magnet" | "magnetMode" | "stay" | "lastTool" | "cursor">;
type Key = keyof Synced;

/** Khoá của `drawingGlobal` lưu theo tài khoản, theo thứ tự cố định (so sánh chuỗi JSON). */
export const SYNCED_KEYS: Key[] = ["toolDefaults", "favorites", "showFavs", "magnet", "magnetMode", "stay", "lastTool", "cursor"];

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPrimitive = (v: unknown) => typeof v === "number" || typeof v === "string" || typeof v === "boolean";

/** Chỉ nhận mặc định đúng dạng: document trên server có thể do bản app khác ghi hoặc hỏng. */
export function parseToolDefaults(raw: unknown): ToolDefaults | null {
  if (!isRecord(raw)) return null;
  const out: ToolDefaults = {};
  for (const [type, v] of Object.entries(raw)) {
    if (!isRecord(v)) continue;
    const one: DrawingDefaults = {};
    if (typeof v.color === "string") one.color = v.color;
    if (typeof v.width === "number") one.width = v.width;
    if (v.dash === 0 || v.dash === 1 || v.dash === 2) one.dash = v.dash;
    if (typeof v.textColor === "string") one.textColor = v.textColor;
    if (isRecord(v.opts)) one.opts = Object.fromEntries(Object.entries(v.opts).filter(([, x]) => isPrimitive(x))) as NonNullable<DrawingDefaults["opts"]>;
    out[type] = one;
  }
  return out;
}

const CURSORS: CursorMode[] = ["cross", "dot", "arrow", "eraser"];
const MAGNETS: MagnetMode[] = ["weak", "strong"];

/** Các khoá hợp lệ của document trên server (khoá sai kiểu / vắng bị bỏ). */
export function parsePrefs(raw: unknown): Partial<Synced> {
  if (!isRecord(raw)) return {};
  const out: Partial<Synced> = {};
  const td = parseToolDefaults(raw.toolDefaults);
  if (td) out.toolDefaults = td;
  if (Array.isArray(raw.favorites) && raw.favorites.every((x) => typeof x === "string")) out.favorites = raw.favorites as string[];
  if (typeof raw.showFavs === "boolean") out.showFavs = raw.showFavs;
  if (typeof raw.magnet === "boolean") out.magnet = raw.magnet;
  if (MAGNETS.includes(raw.magnetMode as MagnetMode)) out.magnetMode = raw.magnetMode as MagnetMode;
  if (typeof raw.stay === "boolean") out.stay = raw.stay;
  if (isRecord(raw.lastTool) && Object.values(raw.lastTool).every((x) => typeof x === "string")) out.lastTool = raw.lastTool as Record<string, string>;
  if (CURSORS.includes(raw.cursor as CursorMode)) out.cursor = raw.cursor as CursorMode;
  return out;
}

const snapshot = (): Synced => {
  const s = drawingGlobal.getState();
  return { toolDefaults: s.toolDefaults, favorites: s.favorites, showFavs: s.showFavs, magnet: s.magnet, magnetMode: s.magnetMode, stay: s.stay, lastTool: s.lastTool, cursor: s.cursor };
};
const keyOf = (d: Partial<Synced>) => JSON.stringify(SYNCED_KEYS.map((k) => d[k] ?? null));
/** Mặc định của app (chưa nạp localStorage): khi không biết khách đã có gì trước lúc đăng nhập. */
const defaults = (): Synced => {
  const s = drawingGlobal.getInitialState();
  return { toolDefaults: s.toolDefaults, favorites: s.favorites, showFavs: s.showFavs, magnet: s.magnet, magnetMode: s.magnetMode, stay: s.stay, lastTool: s.lastTool, cursor: s.cursor };
};

type Opts = { fetch?: typeof fetch; delay?: number; retryMs?: number };

export class PrefsSync {
  private uid: string | null = null;
  private loaded = false;
  private dirty = new Set<Key>(); // khoá đổi trước khi lấy xong từ server
  private applying = false;
  private saved = ""; // bản đang có trên server (khoá JSON của phần app hiểu được)
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private offs: (() => void)[] = [];
  private lastStatus: string | null = null;
  private guestSnap: Synced | null = null; // tuỳ chọn của khách lúc đăng nhập: đăng xuất / đổi tài khoản thì trả lại, không để lại tuỳ chọn của tài khoản

  constructor(private o: Opts = {}) {}

  private f(path: string, init?: RequestInit) {
    return this.o.fetch ? this.o.fetch(path, init) : apiFetch(path, init);
  }

  /** Nghe đăng nhập / đăng xuất và thay đổi tuỳ chọn công cụ vẽ. */
  start() {
    this.offs = [useAuthStore.subscribe(this.onAuth), drawingGlobal.subscribe(this.onDrawing)];
    this.onAuth(useAuthStore.getState());
  }

  stop() {
    this.offs.forEach((f) => f());
    this.offs = [];
    this.reset();
  }

  private reset() {
    this.uid = null;
    this.loaded = false;
    this.dirty.clear();
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
  }

  private onAuth = (s: ReturnType<typeof useAuthStore.getState>) => {
    const prevStatus = this.lastStatus;
    this.lastStatus = s.status;
    if (s.status === "user" && s.user) {
      if (this.uid === s.user.id) {
        // đăng nhập lại sau khi hết phiên: lần PUT bị 401 chưa lưu được thì đưa lên lại
        if (this.loaded && !s.expired && !this.timer && keyOf(snapshot()) !== this.saved) this.schedule();
        return;
      }
      if (this.uid !== null) this.apply(this.guestSnap ?? defaults()); // đổi thẳng sang tài khoản khác: không mang tuỳ chọn của người trước sang
      else if (prevStatus === "guest") this.guestSnap = snapshot();
      this.reset();
      this.uid = s.user.id;
      void this.load();
    } else if (s.status === "guest") {
      // đăng xuất: trả lại tuỳ chọn của khách (localStorage là của máy, không giữ tuỳ chọn của tài khoản vừa rời)
      if (this.uid !== null) this.apply(this.guestSnap ?? defaults());
      this.guestSnap = null;
      this.reset();
    }
  };

  private onDrawing = (s: DrawingGlobal, prev: DrawingGlobal) => {
    if (this.applying || !this.uid) return;
    const changed = SYNCED_KEYS.filter((k) => s[k] !== prev[k]);
    if (changed.length === 0) return;
    if (this.loaded) this.schedule();
    else changed.forEach((k) => this.dirty.add(k));
  };

  private apply(patch: Partial<Synced>) {
    this.applying = true;
    try {
      drawingGlobal.setState(patch);
    } finally {
      this.applying = false;
    }
  }

  private async load() {
    const uid = this.uid;
    try {
      const r = await this.f("/me/prefs");
      if (this.uid !== uid) return;
      if (r.status === 401) return; // hết phiên: auth store xử lý, đăng nhập lại thì onAuth chạy lại
      if (r.status !== 404 && !r.ok) throw new Error(`HTTP ${r.status}`);
      const server = r.status === 404 ? {} : parsePrefs(((await r.json()) as { data?: unknown })?.data);
      if (this.uid !== uid) return;
      const local = snapshot();
      const merged: Partial<Synced> = {};
      for (const k of SYNCED_KEYS) {
        if (k === "toolDefaults" && server.toolDefaults && this.dirty.has(k)) merged.toolDefaults = { ...server.toolDefaults, ...local.toolDefaults };
        else if (server[k] !== undefined && !this.dirty.has(k)) (merged as Record<string, unknown>)[k] = server[k];
        else (merged as Record<string, unknown>)[k] = local[k];
      }
      this.loaded = true;
      this.saved = keyOf(server);
      const patch = Object.fromEntries(SYNCED_KEYS.filter((k) => JSON.stringify(merged[k]) !== JSON.stringify(local[k])).map((k) => [k, merged[k]]));
      if (Object.keys(patch).length > 0) this.apply(patch as Partial<Synced>);
      this.dirty.clear();
      if (keyOf(merged) !== this.saved) this.schedule(); // server thiếu khoá nào / có đổi chưa lưu: đưa lên
    } catch {
      if (this.uid === uid) this.retryTimer = setTimeout(() => void this.load(), this.o.retryMs ?? RETRY_MS);
    }
  }

  private schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.save(), this.o.delay ?? SAVE_DELAY);
  }

  private async save() {
    this.timer = null;
    const uid = this.uid;
    const d = snapshot();
    if (!uid || !this.loaded || keyOf(d) === this.saved) return;
    try {
      const r = await this.f("/me/prefs", { method: "PUT", body: JSON.stringify({ v: PREFS_VERSION, ...d }) });
      if (this.uid !== uid) return;
      if (r.ok) this.saved = keyOf(d);
      else if (r.status !== 401) throw new Error(`HTTP ${r.status}`);
    } catch {
      if (this.uid === uid) this.retryTimer = setTimeout(() => this.schedule(), this.o.retryMs ?? RETRY_MS);
    }
  }
}
