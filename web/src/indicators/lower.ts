import { TF_SECONDS, type Bar } from "@/lib/api";

// Nến khung nhỏ cho indicator chia volume trong nến chart (CVD, Session / Visible Range Volume Profile).
// DB chỉ có M1 của vài ngày gần đây, M5 dài hơn, ... nên nạp nhiều khung và ghép: nơi nào có khung mịn thì dùng khung mịn,
// vùng cũ hơn lùi sang khung thô hơn (TV cũng nói khung lớn cho nhiều lịch sử hơn nhưng kém chính xác).

/** Khung nhỏ có thể dùng, mịn → thô (backend không có M3). */
export const LOWER_TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const;

/** Một indicator cần nến khung nhỏ nào: các khung ứng viên (mịn → thô, mọi khung nhỏ hơn khung chart) phủ từ `from` (UTC giây). */
export type LowerNeed = { tfs: string[]; from: number };

export type LowerSource = { tf: string; step: number; bars: Bar[] };

const PAGE = 50_000; // giới hạn của /bars
const MAX_PAGES = 10;
const TAIL_MS = 15_000; // làm mới phần đuôi (nến khung nhỏ mới) mỗi 15 giây
const RETRY_MS = 10_000;

/** Ghép các nguồn (mịn → thô): nguồn mịn lấy hết; nến của nguồn thô hơn chỉ được lấy nếu không có nến mịn nào nằm trong khoảng của nó
 *  (vùng cũ hơn dữ liệu mịn, hoặc lỗ hổng bên trong dữ liệu mịn). Kết quả tăng dần theo t. */
export function mergeSources(sources: LowerSource[]): Bar[] {
  let acc: Bar[] = [];
  for (const s of sources) {
    if (s.bars.length === 0) continue;
    if (acc.length === 0) {
      acc = s.bars;
      continue;
    }
    const extra = s.bars.filter((b) => !overlaps(acc, b.t, b.t + s.step));
    if (extra.length === 0) continue;
    // hai danh sách đã tăng dần: trộn
    const out: Bar[] = [];
    let i = 0;
    let j = 0;
    while (i < acc.length || j < extra.length) out.push(j >= extra.length || (i < acc.length && acc[i].t < extra[j].t) ? acc[i++] : extra[j++]);
    acc = out;
  }
  return acc;
}

/** Có nến nào của `bars` (tăng dần) bắt đầu trong [from, to) hoặc nến liền trước chồng sang from không. Nến trước chồng sang chỉ xét khi nó ngắn hơn khoảng truy vấn nên không cần: các nến mịn không dài hơn nến thô. */
function overlaps(bars: Bar[], from: number, to: number): boolean {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < from) lo = mid + 1;
    else hi = mid;
  }
  return lo < bars.length && bars[lo].t < to;
}

/** Các khung ứng viên cho một chart khung `chartStep` giây: từ khung `first` trở lên (thô dần), chỉ lấy khung nhỏ hơn khung chart. */
export function lowerCandidates(chartStep: number, first: string): string[] {
  const i = LOWER_TFS.indexOf(first as (typeof LOWER_TFS)[number]);
  return LOWER_TFS.slice(Math.max(0, i)).filter((tf) => TF_SECONDS[tf] < chartStep);
}

/** Khung nhỏ mặc định theo khung chart như script CVD: trong ngày → M1, ngày → M5, tuần trở lên → H1. */
export const autoLowerTf = (chartStep: number): string => (chartStep < 86400 ? "M1" : chartStep < 7 * 86400 ? "M5" : "H1");

/** Bỏ các khung mịn tới mức ước lượng số nến vượt `limit` (vd M1 phủ cả năm): lấy khung mịn nhất còn nằm trong ngân sách. */
export function withinBudget(tfs: string[], from: number, to: number, limit: number): string[] {
  const k = tfs.findIndex((tf) => (to - from) / TF_SECONDS[tf] <= limit);
  return k < 0 ? [] : tfs.slice(k);
}

type FetchRange = (symbol: string, tf: string, from: number, to: number, limit: number) => Promise<Bar[]>;
type Entry = { bars: Bar[]; lo: number; hi: number; busy: boolean; retryAt: number; tailAt: number };

export class LowerFeed {
  private cache = new Map<string, Entry>();
  private ver = 0;
  private memo: { key: string; ver: number; bars: Bar[] } | null = null;

  constructor(
    private fetch: FetchRange,
    private onChange: () => void,
    private now: () => number = Date.now,
    private pageSize = PAGE,
  ) {}

  /** Nến khung nhỏ đã có (ghép) trong `[need.from, to)`; thiếu thì xin nạp ngầm và gọi `onChange` khi xong. */
  get(symbol: string, need: LowerNeed, to: number): Bar[] {
    for (const tf of need.tfs) this.ensure(symbol, tf, need.from, to);
    const key = `${symbol}|${need.tfs.join(",")}|${need.from}`;
    if (this.memo?.key !== key || this.memo.ver !== this.ver) {
      const merged = mergeSources(need.tfs.map((tf) => ({ tf, step: TF_SECONDS[tf], bars: this.cache.get(`${symbol}|${tf}`)?.bars ?? [] })));
      this.memo = { key, ver: this.ver, bars: merged };
    }
    return this.memo.bars;
  }

  /** Bỏ hết cache (đổi broker / symbol không cần: cache theo symbol). */
  clear() {
    this.cache.clear();
    this.ver++;
    this.memo = null;
  }

  private ensure(symbol: string, tf: string, from: number, to: number) {
    const key = `${symbol}|${tf}`;
    let e = this.cache.get(key);
    if (!e) this.cache.set(key, (e = { bars: [], lo: Infinity, hi: -Infinity, busy: false, retryAt: 0, tailAt: 0 }));
    if (e.busy || this.now() < e.retryAt) return;
    const entry = e;
    const first = entry.lo === Infinity;
    const wantOlder = first || from < entry.lo;
    const wantNewer = !first && (to > entry.hi || this.now() - entry.tailAt >= TAIL_MS);
    if (!wantOlder && !wantNewer) return;
    entry.busy = true;
    const job = wantOlder
      ? this.page(symbol, tf, from, first ? to : entry.lo).then((got) => {
          if (first) {
            entry.bars = got;
            entry.hi = to;
            entry.tailAt = this.now();
          } else entry.bars = got.concat(entry.bars);
          entry.lo = from;
          return got.length > 0;
        })
      : this.tail(symbol, tf, entry, to);
    job
      .then((changed) => {
        entry.busy = false;
        if (changed) {
          this.ver++;
          this.onChange();
        }
      })
      .catch(() => {
        entry.busy = false;
        entry.retryAt = this.now() + RETRY_MS;
      });
  }

  /** Nạp `[from, to)` lùi dần theo trang (mỗi trang tối đa PAGE nến mới nhất). */
  private async page(symbol: string, tf: string, from: number, to: number): Promise<Bar[]> {
    const chunks: Bar[][] = [];
    let hi = to;
    for (let i = 0; i < MAX_PAGES; i++) {
      const got = await this.fetch(symbol, tf, from, hi, this.pageSize);
      if (got.length > 0) chunks.unshift(got);
      if (got.length < this.pageSize) break;
      hi = got[0].t;
    }
    return chunks.flat();
  }

  /** Làm mới đuôi: nạp lại từ nến khung nhỏ cuối cùng (có thể mới chỉ chạy dở) tới `to`. Trả về có đổi gì không. */
  private async tail(symbol: string, tf: string, e: Entry, to: number): Promise<boolean> {
    const start = e.bars.length > 0 ? e.bars[e.bars.length - 1].t : e.lo;
    const got = await this.fetch(symbol, tf, start, Math.max(to, e.hi), this.pageSize);
    e.tailAt = this.now();
    e.hi = Math.max(to, e.hi);
    if (got.length === 0) return false;
    const last = e.bars[e.bars.length - 1];
    const same = got.length === 1 && last && last.t === got[0].t && last.c === got[0].c && last.h === got[0].h && last.l === got[0].l && last.v === got[0].v;
    if (same) return false;
    e.bars = e.bars.filter((b) => b.t < got[0].t).concat(got);
    return true;
  }
}
