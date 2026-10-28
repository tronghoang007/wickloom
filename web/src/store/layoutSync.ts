import { apiFetch } from "@/lib/api";
import { docKey, type LayoutDoc } from "./layoutDoc";

// Autosave MỘT layout lên `/me/layouts/<id>`, theo khuôn DrawingSync: chỉ ghi khi nội dung thật sự đổi, gộp nhiều thay đổi liên tiếp
// thành một lần PUT, lỗi thì tự thử lại, version lạ → chỉ đọc (không ghi đè bản của app mới hơn). Thêm: 401 (hết phiên) KHÔNG
// retry mù — chuyển sang "expired", giữ nguyên layout trong bộ nhớ, chờ `resume()` sau khi đăng nhập lại.
export type SaveState = "saved" | "saving" | "error" | "readonly" | "expired";

type Opts = {
  id: string;
  snapshot: () => LayoutDoc;
  /** Bản đang có trên server (đã đọc/đã tạo xong). Sync không bao giờ ghi trước khi biết baseline. */
  baseline: LayoutDoc;
  readonly?: boolean;
  fetch?: typeof fetch;
  onState?: (s: SaveState) => void;
  /** Gọi sau mỗi lần ghi thành công (để cache local). */
  onSaved?: (doc: LayoutDoc) => void;
  saveDelay?: number;
  retryDelay?: number;
};

export class LayoutSync {
  private saved: string;
  private status: SaveState;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private inflight: Promise<void> | null = null;
  private closed = false;

  constructor(private o: Opts) {
    this.saved = docKey(o.baseline);
    this.status = o.readonly ? "readonly" : "saved";
  }

  get state(): SaveState {
    return this.status;
  }
  get id(): string {
    return this.o.id;
  }

  private f(input: string, init?: RequestInit) {
    return (this.o.fetch ?? apiFetch)(input, init);
  }
  private url() {
    return `/me/layouts/${encodeURIComponent(this.o.id)}`;
  }
  private setState(s: SaveState) {
    if (this.status === s) return;
    this.status = s;
    this.o.onState?.(s);
  }
  private dirty() {
    return docKey(this.o.snapshot()) !== this.saved;
  }

  /** Có thay đổi (bố cục, state chart, tên): lên lịch lưu. */
  schedule() {
    if (this.closed || this.status === "readonly" || this.status === "expired") return;
    if (!this.dirty() && !this.inflight) {
      this.clearTimers();
      this.setState("saved"); // sửa rồi lại hoàn về như đã lưu
      return;
    }
    if (this.status === "error") return; // đã có lịch thử lại
    this.setState("saving");
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.put(), this.o.saveDelay ?? 1000);
  }

  /** Lưu ngay và đợi server trả lời. */
  async flush(): Promise<void> {
    if (this.status === "readonly" || this.status === "expired") return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    await this.put();
  }

  /** Người dùng bấm Save khi đang lỗi: thử lại ngay. */
  retry(): Promise<void> {
    if (this.status === "readonly" || this.status === "expired") return Promise.resolve();
    this.clearTimers();
    return this.put();
  }

  /** Đã đăng nhập lại sau khi hết phiên: ghi tiếp phần đang giữ trong bộ nhớ. */
  resume(): Promise<void> {
    if (this.status !== "expired") return Promise.resolve();
    this.status = "saved";
    return this.put();
  }

  /** Đóng tab: PUT với keepalive (không đợi). */
  flushOnUnload() {
    if (this.closed || this.status === "readonly" || this.status === "expired" || !this.dirty()) return;
    const doc = { ...this.o.snapshot(), updatedAt: Date.now() };
    void this.f(this.url(), { method: "PUT", body: JSON.stringify(doc), keepalive: true }).catch(() => {});
  }

  /** Dừng sync (đổi layout / đăng xuất): lưu nốt phần còn chờ rồi không nhận thay đổi nữa. */
  async close(): Promise<void> {
    await this.flush();
    this.closed = true;
    this.clearTimers();
  }

  /** Bỏ sync mà KHÔNG lưu (layout vừa bị xoá: flush sẽ tạo lại nó). Sau đó không còn PUT nào, kể cả flush / retry. */
  abandon() {
    this.closed = true;
    this.clearTimers();
  }

  /** Xoá layout thất bại sau khi đã `abandon()`: nhận lại thay đổi, lưu tiếp phần đang chờ. */
  revive() {
    if (!this.closed) return;
    this.closed = false;
    this.schedule();
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.timer = this.retryTimer = null;
  }

  private put(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.inflight) return this.inflight.then(() => (this.closed ? undefined : this.put()));
    const doc: LayoutDoc = { ...this.o.snapshot(), updatedAt: Date.now() };
    const key = docKey(doc);
    if (key === this.saved) {
      if (this.status === "saving" || this.status === "error") this.setState("saved");
      return Promise.resolve();
    }
    this.setState("saving");
    this.inflight = this.f(this.url(), { method: "PUT", body: JSON.stringify(doc) })
      .then((res) => {
        if (res.status === 401) {
          this.setState("expired");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        this.saved = key;
        this.o.onSaved?.(doc);
        if (this.closed) return; // bị bỏ trong lúc đang ghi: snapshot giờ có thể là layout khác
        if (this.dirty()) {
          this.setState("saving");
          this.timer = setTimeout(() => void this.put(), this.o.saveDelay ?? 1000); // đổi tiếp trong lúc đang ghi
        } else this.setState("saved");
      })
      .catch(() => {
        this.setState("error");
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          if (!this.closed && this.status === "error") void this.put();
        }, this.o.retryDelay ?? 5000);
      })
      .finally(() => {
        this.inflight = null;
      });
    return this.inflight;
  }
}
