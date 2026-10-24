import { drawingGlobal, type DrawingDefaults } from "@/drawings/store";
import { apiFetch } from "@/lib/api";
import { useAuthStore } from "./auth";

// Mặc định công cụ vẽ (màu, độ dày, tuỳ chọn như Row Size của FRVP...) theo TÀI KHOẢN như TradingView (hình vẽ mới là của từng layout):
//  - khách: chỉ nhớ trong localStorage (`tv-drawing-prefs`) như trước;
//  - user: nằm ở `/me/prefs` (document `{ v: 1, toolDefaults }`), đăng nhập thì lấy về, đổi thì lưu lên; localStorage vẫn giữ một bản để mở nhanh / khi backend tắt.
// Server thắng khi đã có dữ liệu; tài khoản chưa có gì thì mặc định đang có trên máy này (từ lúc còn là khách) được đưa lên. Đổi trước khi lấy xong thì gộp theo từng công cụ (bên đổi thắng).

const PREFS_VERSION = 1;
const SAVE_DELAY = 800;
const RETRY_MS = 10_000;

type ToolDefaults = Record<string, DrawingDefaults>;

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

const keyOf = (d: ToolDefaults) => JSON.stringify(d);
const nonEmpty = (d: ToolDefaults) => Object.keys(d).length > 0;

type Opts = { fetch?: typeof fetch; delay?: number; retryMs?: number };

export class PrefsSync {
  private uid: string | null = null;
  private loaded = false;
  private dirty = false; // đổi trước khi lấy xong từ server
  private applying = false;
  private saved = ""; // bản đang có trên server (khoá JSON)
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private offs: (() => void)[] = [];

  constructor(private o: Opts = {}) {}

  private f(path: string, init?: RequestInit) {
    return this.o.fetch ? this.o.fetch(path, init) : apiFetch(path, init);
  }

  /** Nghe đăng nhập / đăng xuất và thay đổi mặc định công cụ. */
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
    this.dirty = false;
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
  }

  private onAuth = (s: ReturnType<typeof useAuthStore.getState>) => {
    if (s.status === "user" && s.user) {
      if (this.uid === s.user.id) return;
      this.reset();
      this.uid = s.user.id;
      void this.load();
    } else if (s.status === "guest") this.reset(); // khách: localStorage như cũ (bản đang có giữ nguyên)
  };

  private onDrawing = (s: ReturnType<typeof drawingGlobal.getState>, prev: ReturnType<typeof drawingGlobal.getState>) => {
    if (this.applying || !this.uid || s.toolDefaults === prev.toolDefaults) return;
    if (this.loaded) this.schedule();
    else this.dirty = true;
  };

  private apply(d: ToolDefaults) {
    this.applying = true;
    try {
      drawingGlobal.setState({ toolDefaults: d });
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
      const server = r.status === 404 ? null : parseToolDefaults(((await r.json()) as { data?: { toolDefaults?: unknown } })?.data?.toolDefaults);
      if (this.uid !== uid) return;
      const local = drawingGlobal.getState().toolDefaults;
      this.loaded = true;
      if (server === null) {
        this.saved = ""; // tài khoản chưa có gì: đưa mặc định đang có lên
        if (nonEmpty(local)) this.schedule();
      } else {
        this.saved = keyOf(server);
        const merged = this.dirty ? { ...server, ...local } : server;
        if (keyOf(merged) !== keyOf(local)) this.apply(merged);
        if (keyOf(merged) !== this.saved) this.schedule();
      }
      this.dirty = false;
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
    const d = drawingGlobal.getState().toolDefaults;
    if (!uid || !this.loaded || keyOf(d) === this.saved) return;
    try {
      const r = await this.f("/me/prefs", { method: "PUT", body: JSON.stringify({ v: PREFS_VERSION, toolDefaults: d }) });
      if (this.uid !== uid) return;
      if (r.ok) this.saved = keyOf(d);
      else if (r.status !== 401) throw new Error(`HTTP ${r.status}`);
    } catch {
      if (this.uid === uid) this.retryTimer = setTimeout(() => this.schedule(), this.o.retryMs ?? RETRY_MS);
    }
  }
}
