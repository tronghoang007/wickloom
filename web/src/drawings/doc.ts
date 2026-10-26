import { API } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { DEFAULT_LAYOUT_ID } from "@/store/layout";
import { drawingsFetch } from "./storage";
import { DrawingSync } from "./sync";
import { SPEC } from "./tools";
import type { Drawing } from "./types";

// Hình vẽ của MỘT symbol trong MỘT layout, dùng chung cho mọi chart (pane) đang mở symbol đó. Nếu mỗi DrawingManager giữ
// danh sách + DrawingSync riêng thì hai ô cùng symbol sẽ PUT đè nhau và mất hình. Doc sở hữu: danh sách hình, hình server
// có type app không biết (giữ nguyên khi lưu), lịch sử undo/redo (undo theo layout như TV) và ĐÚNG MỘT DrawingSync.
// Mỗi DrawingManager là một "view": sửa xong gọi `changed(this)` để các view khác vẽ lại.

export { DEFAULT_LAYOUT_ID };

/** Nghe mọi thay đổi hình vẽ của mọi doc (sau khi sửa / xoá / undo ở bất kỳ chart nào): alert đi theo hình dùng để giữ bản sao toạ độ cho khớp. Trả hàm huỷ đăng ký. */
const changeListeners = new Set<(doc: DrawingDoc) => void>();
export function onDocChanged(fn: (doc: DrawingDoc) => void): () => void {
  changeListeners.add(fn);
  return () => void changeListeners.delete(fn);
}

export interface DocView {
  /** Hình đổi do view khác (sửa/xoá/undo). */
  docChanged(): void;
  /** Bản trên server vừa về; `known` là các hình app hiểu được. */
  docLoaded(known: Drawing[]): void;
  /** Đổi nơi lưu (đăng nhập/đăng xuất): bỏ hết, sắp nạp lại. */
  docReset(): void;
}

type DocOpts = { url?: (symbol: string) => string; fetch?: typeof fetch; saveDelay?: number; retryDelay?: number };

export class DrawingDoc {
  // Drawing không bị sửa tại chỗ: đổi gì thì thay object mới (cache shape theo object, store luôn mới)
  drawings: Drawing[] = [];
  kept: unknown[] = []; // item trên server có type app không biết: giữ nguyên khi lưu
  undoStack: string[] = [];
  redoStack: string[] = [];
  readonly views = new Set<DocView>();
  private sync: DrawingSync | null;

  /** `symbol = null`: doc rỗng chưa gắn symbol nào, không lưu/đọc gì (trạng thái đầu của DrawingManager). */
  constructor(readonly symbol: string | null, readonly layoutId = DEFAULT_LAYOUT_ID, o: DocOpts = {}) {
    this.sync = symbol
      ? new DrawingSync({
          url: o.url ?? ((s) => `${API}/me/drawings/${encodeURIComponent(s)}__${layoutId}`),
          fetch: o.fetch ?? drawingsFetch,
          items: () => [...this.kept, ...this.drawings.filter((d) => !SPEC[d.type]?.ephemeral)],
          onLoad: (items) => this.loaded(items),
          saveDelay: o.saveDelay,
          retryDelay: o.retryDelay,
        })
      : null;
  }

  open() {
    if (this.sync && this.symbol) this.sync.open(this.symbol);
  }

  /** Đã nạp xong hình trên server (hoặc server trả dữ liệu chỉ đọc). Chưa nạp xong thì danh sách hình chưa đủ: không được kết luận "hình đã bị xoá". */
  get ready(): boolean {
    return this.sync?.state === "ready" || this.sync?.state === "readonly";
  }

  /** Một view vừa sửa: lên lịch lưu và báo các view khác. */
  changed(origin: DocView | null) {
    this.sync?.schedule();
    for (const v of [...this.views]) if (v !== origin) v.docChanged();
    for (const fn of [...changeListeners]) fn(this);
  }

  /** Lưu ngay và đợi server trả lời. */
  flush(): Promise<void> {
    return this.sync?.flush() ?? Promise.resolve();
  }

  /** Bỏ hình đang giữ (thuộc nơi lưu cũ, không lưu sang nơi mới) rồi nạp lại. */
  reload() {
    if (!this.sync || !this.symbol) return;
    this.sync.abandon();
    this.drawings = [];
    this.kept = [];
    this.undoStack = [];
    this.redoStack = [];
    for (const v of [...this.views]) v.docReset();
    this.sync.open(this.symbol);
  }

  close() {
    this.sync?.close(); // lưu nốt rồi đóng
  }

  // Bản trên server về: đặt dưới các hình đã vẽ trong lúc chờ load
  private loaded(items: unknown[]) {
    const known: Drawing[] = [];
    this.kept = [];
    for (const it of items) {
      const d = it as Drawing;
      const spec = d && SPEC[d.type];
      if (spec && Array.isArray(d.points) && d.points.length >= spec.n) known.push(d);
      else this.kept.push(it);
    }
    this.drawings = [...known, ...this.drawings];
    // ảnh chụp undo cũ chưa có bản server: undo về đó sẽ xóa mất drawings
    this.undoStack = [];
    this.redoStack = [];
    for (const v of [...this.views]) v.docLoaded(known);
  }
}

// --- registry: một doc cho mỗi (layout, symbol), đếm tham chiếu theo số view ---------------------------------------
const docs = new Map<string, { doc: DrawingDoc; refs: number }>();
const keyOf = (layoutId: string, symbol: string) => `${layoutId}|${symbol}`;

/** Lấy doc của symbol (tạo + nạp từ nơi lưu nếu chưa có) và đăng ký `view`. */
export function acquireDoc(symbol: string, view: DocView, layoutId = DEFAULT_LAYOUT_ID, o: DocOpts = {}): DrawingDoc {
  const key = keyOf(layoutId, symbol);
  let e = docs.get(key);
  if (!e) {
    e = { doc: new DrawingDoc(symbol, layoutId, o), refs: 0 };
    docs.set(key, e);
    e.doc.open();
  }
  e.refs++;
  e.doc.views.add(view);
  return e.doc;
}

/** Gỡ view; view cuối cùng đi thì doc được lưu nốt rồi đóng. */
export function releaseDoc(doc: DrawingDoc, view: DocView) {
  if (!doc.symbol) return;
  const key = keyOf(doc.layoutId, doc.symbol);
  const e = docs.get(key);
  if (!e || e.doc !== doc || !doc.views.delete(view)) return;
  if (--e.refs <= 0) {
    docs.delete(key);
    doc.close();
  }
}

export const openDocCount = () => docs.size;

/** Đóng mọi doc (lưu nốt thay đổi chưa lưu): khi thay cả layout, và để test không dính nhau. */
export function closeAllDocs() {
  const all = [...docs.values()];
  docs.clear();
  for (const { doc } of all) {
    doc.views.clear();
    doc.close();
  }
}

// Đổi nơi lưu hình vẽ (khách ↔ user, hoặc sang user khác) → mọi doc nạp lại từ nơi mới. "loading" (chưa biết là khách hay
// user) cũng tính là một nơi để lúc có kết quả thì nạp lại.
const authKey = () => {
  const s = useAuthStore.getState();
  return s.status === "user" ? `u:${s.user?.id}` : s.status;
};
let who = authKey();
useAuthStore.subscribe(() => {
  const next = authKey();
  if (next === who) return;
  who = next;
  for (const { doc } of [...docs.values()]) doc.reload();
});
