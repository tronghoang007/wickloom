import type { Bar } from "@/lib/api";
import type { Layout } from "@/volumeProfile/compute";

// Volume Profile "1 tick" (Session / Visible Range): mỗi tick rơi đúng vào row chứa giá của nó. Backend giữ histogram giá theo phút (bảng tickvp) và gom sẵn
// vào các row của profile (/tickvp) nên web chỉ nhận vài trăm số cho mỗi profile. Nến delta tick (tf "TD", LowerFeed) cho biết phút nào đã có tick.

export type TickHist = { up: number[]; dn: number[] };
type Fetch = (symbol: string, from: number, to: number, lay: Layout) => Promise<TickHist | null>;
type Entry = { sig: string; data: TickHist | null; busy: boolean; retryAt: number };

const MAX_ACTIVE = 2; // số yêu cầu /tickvp chạy cùng lúc
const MAX_ENTRIES = 64; // profile giữ trong bộ nhớ (kéo chart với Visible Range liên tục tạo khoá mới)
const RETRY_MS = 10_000;
const HEAD_SLACK = 300; // giây: nến delta đầu tiên muộn hơn đầu profile quá chừng này là chưa nạp tới đầu (giống LowerFeed: 5 phút)

/** Dữ liệu tick đã nạp (nến delta "TD", tăng dần) phủ tới đầu `t0` chưa. */
export function coversFrom(cover: Bar[], t0: number): boolean {
  return cover.length > 0 && cover[0].t <= t0 + HEAD_SLACK;
}

/** Chữ ký phần nến delta trong [t0, t1): đổi khi nạp thêm phút hoặc phút cuối được EA tính lại (backend đã ghi lại histogram của phút đó). */
export function coverSig(cover: Bar[], t0: number, t1: number): string {
  const at = (t: number) => {
    let lo = 0;
    let hi = cover.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cover[mid].t < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };
  const a = at(t0);
  const b = at(t1);
  const last = cover[b - 1];
  return b > a && last ? `${b - a}:${last.t}:${last.v}:${last.c}` : "0";
}

export class TickProfileFeed {
  private cache = new Map<string, Entry>();
  private active = 0;

  constructor(private fetch: Fetch, private onChange: () => void, private now: () => number = Date.now) {}

  /** Histogram đã nạp của profile [t0, t1) chia theo `lay`; chưa có thì null và nạp ngầm rồi gọi `onChange`. `sig` đổi (dữ liệu đổi) thì nạp lại nhưng vẫn trả bản cũ trong lúc chờ. */
  get(symbol: string, t0: number, t1: number, lay: Layout, sig: string): TickHist | null {
    const key = `${symbol}|${t0}|${t1}|${lay.lo}|${lay.size}|${lay.N}`;
    let e = this.cache.get(key);
    if (e) {
      this.cache.delete(key); // LRU: mới dùng thì xếp cuối
      this.cache.set(key, e);
    } else {
      this.cache.set(key, (e = { sig: "", data: null, busy: false, retryAt: 0 }));
      if (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    }
    if (e.sig !== sig && !e.busy && this.active < MAX_ACTIVE && this.now() >= e.retryAt) void this.load(symbol, t0, t1, lay, sig, e);
    return e.data;
  }

  clear() {
    this.cache.clear();
  }

  private async load(symbol: string, t0: number, t1: number, lay: Layout, sig: string, e: Entry) {
    e.busy = true;
    this.active++;
    let got: TickHist | null = null;
    try {
      got = await this.fetch(symbol, t0, t1, lay);
    } catch {
      got = null;
    }
    this.active--;
    e.busy = false;
    if (got && got.up.length === lay.N && got.dn.length === lay.N) {
      e.data = got;
      e.sig = sig;
    } else e.retryAt = this.now() + RETRY_MS;
    this.onChange();
  }
}
