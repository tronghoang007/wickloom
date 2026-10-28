export const DRAWINGS_VERSION = 1;

type Status = "idle" | "loading" | "ready" | "error" | "readonly";

type Opts = {
  url: (symbol: string) => string;
  items: () => unknown[]; // những gì sẽ lưu cho symbol đang mở
  onLoad: (items: unknown[]) => void; // bản trên server; manager gộp với hình vẽ trong lúc chờ
  fetch?: typeof fetch;
  saveDelay?: number;
  retryDelay?: number;
};

// Đọc/ghi drawings của 1 symbol. Chỉ ghi sau khi đã đọc được bản trên server: trước đây
// load lỗi (backend chưa chạy) để lại danh sách rỗng, lần vẽ sau PUT ghi đè mất drawings cũ.
// Không PUT khi nội dung không đổi (chọn hình, Measure).
export class DrawingSync {
  private symbol = "";
  private status: Status = "idle";
  private seq = 0;
  private saved: string | null = null; // JSON items đang có trên server
  // PUT gần nhất (đang chờ hoặc đã xong): PUT sau xếp hàng sau nó để server nhận đúng thứ tự (PUT cũ về sau sẽ đè bản mới)
  private inflight: Promise<boolean> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private o: Opts) {}

  get state() { return this.status; }

  // Gọi tách rời: window.fetch gọi với this khác window sẽ ném "Illegal invocation"
  private f(input: string, init?: RequestInit) { return (this.o.fetch ?? fetch)(input, init); }

  open(symbol: string) {
    this.flush();
    this.clearTimers();
    this.symbol = symbol;
    this.status = "loading";
    this.saved = null;
    void this.load(++this.seq);
  }

  /** Đóng hẳn: PUT trong lúc đóng mà lỗi thì KHÔNG thử lại. releaseDoc chỉ gọi sau khi `flush()` đã trả true (lỗi thì giữ sync mở để thử tiếp). */
  close() {
    void this.flush();
    this.clearTimers();
    this.seq++;
    this.symbol = "";
    this.status = "idle";
  }

  schedule() {
    if (this.status !== "ready") return;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => void this.flush(), this.o.saveDelay ?? 500);
  }

  /** Lưu ngay nếu có thay đổi. Promise xong khi PUT trả lời (hoặc ngay nếu không có gì để lưu) - logout đợi nó
   *  để PUT cuối còn cookie. Không ném lỗi: trả true = server đã có bản hiện tại (hoặc không có gì để lưu), false = PUT lỗi
   *  (sync tự thử lại sau retryDelay). */
  flush(): Promise<boolean> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.status !== "ready" || !this.symbol) return Promise.resolve(true);
    const items = this.o.items();
    const json = JSON.stringify(items);
    // đã gửi đúng bản này: đợi PUT đó (đang chờ thì chưa chắc đã lưu)
    if (json === this.saved) return this.inflight ?? Promise.resolve(true);
    this.saved = json;
    const { symbol, seq } = this;
    const put = () =>
      this.f(`${this.o.url(symbol)}?scope=${encodeURIComponent(symbol)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: DRAWINGS_VERSION, items }),
      }).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); });
    const p: Promise<boolean> = (this.inflight ?? Promise.resolve(true))
      .then(put)
      .then(() => true)
      .catch(() => {
        if (seq !== this.seq || this.saved !== json) return false;
        this.saved = null; // lần sau sẽ ghi lại
        this.retryLater(() => void this.flush());
        return false;
      })
      .finally(() => { if (this.inflight === p) this.inflight = null; });
    this.inflight = p;
    return p;
  }

  /** Bỏ trạng thái hiện tại mà KHÔNG lưu - khi đổi nơi lưu (đăng nhập/đăng xuất) thì nội dung đang giữ thuộc về
   *  nơi cũ, lưu nó sang nơi mới sẽ đè dữ liệu thật. Gọi `open()` sau đó để nạp lại. */
  abandon() {
    this.clearTimers();
    this.seq++;
    this.symbol = "";
    this.status = "idle";
    this.saved = null;
    this.inflight = null;
  }

  private async load(seq: number) {
    try {
      const r = await this.f(this.o.url(this.symbol));
      if (seq !== this.seq) return;
      let data: { version?: unknown; items?: unknown } | null = null;
      if (r.status !== 404) { // 404 = symbol chưa có drawings
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        data = (await r.json())?.data ?? null;
        if (seq !== this.seq) return;
      }
      const version = data?.version ?? 0; // bản cũ chưa có version
      const items = data === null ? [] : data.items;
      // Dữ liệu từ bản app mới hơn hoặc hỏng: vẫn hiện nhưng không ghi đè
      const readonly = typeof version !== "number" || version > DRAWINGS_VERSION || !Array.isArray(items);
      if (readonly) console.warn("drawings: dữ liệu không đọc được, sẽ không lưu", this.symbol, data);
      this.status = readonly ? "readonly" : "ready";
      this.saved = JSON.stringify(items);
      this.o.onLoad(Array.isArray(items) ? items : []);
      this.schedule(); // lưu hình vẽ trong lúc chờ load
    } catch {
      if (seq !== this.seq) return;
      this.status = "error";
      this.retryLater(() => { if (seq === this.seq) void this.load(seq); });
    }
  }

  private retryLater(fn: () => void) {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => { this.retryTimer = null; fn(); }, this.o.retryDelay ?? 5000);
  }

  private clearTimers() {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; }
    if (this.retryTimer) { clearTimeout(this.retryTimer); this.retryTimer = null; }
  }
}
