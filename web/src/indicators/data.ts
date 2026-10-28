import type { Bar } from "@/lib/api";
import type { CalendarOpts } from "./calendar";

// Dữ liệu nạp ngầm cho indicator, tách khỏi 500 nến chart đang hiển thị (EMA/RMA/RSI/ATR... cần lịch sử dài mới hội tụ giống TV).

export const HISTORY_BARS = 5000;
const RETRY_MS = 10_000;

type FetchBars = (symbol: string, tf: string, to: number | undefined, limit: number) => Promise<Bar[]>;

/** Nến cũ hơn nến đầu của chart, nạp thêm cho tới đủ `target`. Chart giữ nguyên số nến hiển thị; indicator tính trên cả hai rồi cắt phần cũ khi vẽ. */
export class BarHistory {
  private key = "";
  private older: Bar[] = [];
  private exhausted = false;
  private loading = false;
  private retryAt = 0;
  private gen = 0; // tăng khi bỏ hết (đổi broker): lần nạp đang chạy của nguồn cũ không được ghép vào

  constructor(
    private fetch: FetchBars,
    private onChange: () => void,
    private now: () => number = Date.now,
  ) {}

  /** Số nến cũ còn dùng được (cũ hơn nến đầu hiện tại của chart; chart có thể đã tự nạp bớt phần chồng). */
  private usable(first: number): number {
    let k = this.older.length;
    while (k > 0 && this.older[k - 1].t >= first) k--;
    return k;
  }

  /** `all` = lịch sử + nến chart; `cut` = số nến lịch sử đứng trước nến chart. Đổi symbol/khung thì bỏ lịch sử cũ. */
  merge(key: string, bars: Bar[]): { all: Bar[]; cut: number } {
    if (key !== this.key) {
      this.key = key;
      this.older = [];
      this.exhausted = false;
      this.loading = false;
      this.retryAt = 0;
    }
    if (bars.length === 0) return { all: bars, cut: 0 };
    const k = this.usable(bars[0].t);
    return k === 0 ? { all: bars, cut: 0 } : { all: this.older.slice(0, k).concat(bars), cut: k };
  }

  /** Nạp thêm nếu chưa đủ `target` nến (cả nến chart). Xong thì gọi `onChange`. */
  ensure(symbol: string, tf: string, bars: Bar[], target: number): void {
    if (bars.length === 0 || this.loading || this.exhausted || this.now() < this.retryAt) return;
    const k = this.usable(bars[0].t);
    const need = target - (k + bars.length);
    if (need <= 0) return;
    const key = this.key;
    const gen = this.gen;
    const earliest = k > 0 ? this.older[0].t : bars[0].t;
    this.loading = true;
    this.fetch(symbol, tf, earliest, need)
      .then((got) => {
        if (key !== this.key || gen !== this.gen) return; // đã đổi symbol/khung (hoặc broker) trong lúc chờ
        this.loading = false;
        if (got.length < need) this.exhausted = true; // DB hết (chưa backfill thêm từ MT5)
        if (got.length > 0) {
          this.older = got.concat(this.older.slice(0, k));
          this.onChange();
        }
      })
      .catch(() => {
        if (key !== this.key || gen !== this.gen) return;
        this.loading = false;
        this.retryAt = this.now() + RETRY_MS;
      });
  }

  /** Bỏ lịch sử đã nạp (backend đổi sang broker khác: nến cũ là của nguồn cũ). */
  reset() {
    this.gen++;
    this.key = "";
    this.older = [];
    this.loading = false;
  }
}

type CalendarDeps = {
  offset: () => Promise<number>;
  /** Mốc mở các nến D1 của symbol (UTC epoch giây, tăng dần). */
  dayOpens: (symbol: string) => Promise<number[]>;
};

/** Offset broker + mốc ngày thật, nạp lười theo symbol; chưa nạp xong thì `get` trả null (indicator cần lịch thì chưa vẽ, tránh nháy sai). */
export class CalendarFeed {
  private symbol = "";
  private cal: CalendarOpts | null = null;
  private loading = false;
  private gen = 0;

  constructor(
    private deps: CalendarDeps,
    private onChange: () => void,
  ) {}

  get(symbol: string): CalendarOpts | null {
    if (symbol !== this.symbol) {
      this.symbol = symbol;
      this.cal = null;
      this.loading = false;
    }
    if (!this.cal && !this.loading) {
      this.loading = true;
      const gen = this.gen;
      Promise.all([this.deps.offset(), this.deps.dayOpens(symbol)])
        .then(([offset, dayOpens]) => ({ offset, dayOpens }))
        .catch(() => ({ offset: 0, dayOpens: [] as number[] }))
        .then((cal) => {
          if (symbol !== this.symbol || gen !== this.gen) return;
          this.cal = { offset: cal.offset, ...(cal.dayOpens.length ? { dayOpens: cal.dayOpens } : {}) };
          this.loading = false;
          this.onChange();
        });
    }
    return this.cal;
  }

  /** Bỏ lịch đã nạp (đổi broker: offset và mốc D1 khác), lần `get` sau nạp lại. */
  reset() {
    this.gen++;
    this.symbol = "";
    this.cal = null;
    this.loading = false;
  }
}
