import { TF_SECONDS, type Bar } from "@/lib/api";
import { headGap, holeGaps, spliceRange, type Gap } from "./lowerGaps";

// Nến khung nhỏ cho indicator chia volume trong nến chart (CVD, Session / Visible Range Volume Profile).
// DB chỉ có M1 của vài ngày gần đây, M5 dài hơn, ... nên nạp nhiều khung và ghép: nơi nào có khung mịn thì dùng khung mịn,
// vùng cũ hơn lùi sang khung thô hơn (TV cũng nói khung lớn cho nhiều lịch sử hơn nhưng kém chính xác).

/** Khung nhỏ có thể dùng, mịn → thô (backend không có M3). */
export const LOWER_TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"] as const;

/** Khung giả cho delta theo tick từng phút (CVD "1 tick"): backend gom tick lịch sử do EA gửi (backfill tf "TD") thành MỖI PHÚT một nến o = 0,
 *  c = delta cuối phút, h / l = đỉnh / đáy của delta tích luỹ qua từng tick trong phút, v = tổng trọng số tick. Không phải khung của MT5. */
export const TICK_TF = "TD";
/** Độ dài (giây) của nến một khung nhỏ, kể cả khung giả. */
export const stepOf = (tf: string): number => (tf === TICK_TF ? 60 : TF_SECONDS[tf]);

/** Một indicator cần nến khung nhỏ nào: các khung ứng viên (mịn → thô, mọi khung nhỏ hơn khung chart) phủ từ `from` (UTC giây). */
export type LowerNeed = { tfs: string[]; from: number };

export type LowerSource = { tf: string; step: number; bars: Bar[] };

const PAGE = 50_000; // giới hạn của /bars
const MAX_PAGES = 10;
const TAIL_MS = 15_000; // làm mới phần đuôi (nến khung nhỏ mới) mỗi 15 giây
const RETRY_MS = 10_000;
// Xin EA nạp thêm (backfill) chỗ DB còn thiếu. EA nạp đồng bộ trong OnTimer (tick tạm dừng) nên mỗi lần chỉ xin tối đa một chunk của EA
// (BackfillChunk = 5000) và nối nhiều lần; backend không báo EA nạp xong nên hỏi lại /bars cho tới khi có nến mới.
const CHUNK = 5000;
const POLL_MS = 2000;
const MAX_POLLS = 6; // chờ nến mới tối đa 12 giây mỗi lần xin
const MAX_TRIES = 2; // xin hai lần cho mỗi chỗ thiếu; không có thêm = broker hết lịch sử / thị trường đóng cửa: bỏ
const WAIT_MS = 30_000; // giữa hai lần xin
const HEAD_MARGIN = 50;
const HOLE_MARGIN = 10;
// Lịch sử tick ("TD"): mỗi yêu cầu là số nến M1 (~60k tick vàng cho 360 nến), EA phải tải / gom tick nên chờ lâu hơn, và đuôi không có sẵn trong DB
// (khác nến thường, backend không gom tick thành delta) nên mỗi lần làm mới đuôi phải nhờ EA tính lại vài phút gần nhất.
const TICK_CHUNK = 360;
const TICK_POLLS = 15; // 30 giây
const TICK_TAIL_BARS = 3;
const TICK_TAIL_WAIT_MS = 1500;

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
export function overlaps(bars: Bar[], from: number, to: number): boolean {
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
/** Xin EA nạp `count` nến `tf` lùi từ mốc `before` (UTC giây); false nếu backend từ chối. */
export type Backfill = (symbol: string, tf: string, count: number, before: number) => Promise<boolean>;
type Opts = { now?: () => number; pageSize?: number; backfill?: Backfill; sleep?: (ms: number) => Promise<void>; chunk?: number; tickChunk?: number };
type Entry = {
  bars: Bar[]; lo: number; hi: number; busy: boolean; retryAt: number; tailAt: number;
  tries: Map<string, number>; readyAt: number; holes: { sig: string; gaps: Gap[] } | null;
};

export class LowerFeed {
  private cache = new Map<string, Entry>();
  private ver = 0;
  private memo: { key: string; ver: number; bars: Bar[] } | null = null;
  private filling = false; // một lần xin EA tại một thời điểm
  private now: () => number;
  private pageSize: number;
  private backfill: Backfill | undefined;
  private sleep: (ms: number) => Promise<void>;
  private chunk: number;
  private tickChunk: number;

  /** `opts.backfill`: có thì chỗ thiếu trong DB (đầu hoặc lỗ hổng) được xin EA nạp rồi gọi `onChange`; không có thì chỉ đọc DB. */
  constructor(private fetch: FetchRange, private onChange: () => void, opts: Opts = {}) {
    this.now = opts.now ?? Date.now;
    this.pageSize = opts.pageSize ?? PAGE;
    this.backfill = opts.backfill;
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.chunk = opts.chunk ?? CHUNK;
    this.tickChunk = opts.tickChunk ?? TICK_CHUNK;
  }

  /** Nến khung nhỏ đã có (ghép) trong `[need.from, to)`; thiếu thì xin nạp ngầm và gọi `onChange` khi xong. */
  get(symbol: string, need: LowerNeed, to: number): Bar[] {
    for (const tf of need.tfs) this.ensure(symbol, tf, need.from, to);
    this.fill(symbol, need, to);
    const key = `${symbol}|${need.tfs.join(",")}|${need.from}`;
    if (this.memo?.key !== key || this.memo.ver !== this.ver) {
      const merged = mergeSources(need.tfs.map((tf) => ({ tf, step: stepOf(tf), bars: this.cache.get(`${symbol}|${tf}`)?.bars ?? [] })));
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
    if (!e) this.cache.set(key, (e = { bars: [], lo: Infinity, hi: -Infinity, busy: false, retryAt: 0, tailAt: 0, tries: new Map(), readyAt: 0, holes: null }));
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
        if (changed) this.ver++;
        // đọc phần cũ xong mà DB rỗng cũng báo: manager tính lại, get() chạy `fill` xin EA nạp (không thì phải chờ tick tới mới xin)
        if (changed || wantOlder) this.onChange();
      })
      .catch(() => {
        entry.busy = false;
        entry.retryAt = this.now() + RETRY_MS;
      });
  }

  /** Khi mọi khung đã đọc xong từ DB: tìm chỗ thiếu đầu tiên và xin EA nạp (xem `nextGap`). */
  private fill(symbol: string, need: LowerNeed, to: number) {
    if (!this.backfill || this.filling) return;
    const entries: Entry[] = [];
    for (const tf of need.tfs) {
      const e = this.cache.get(`${symbol}|${tf}`);
      if (!e || e.lo === Infinity || e.busy) return; // còn đang đọc DB: chờ
      entries.push(e);
    }
    const job = this.nextGap(need, to, entries);
    if (job) void this.runFill(symbol, job.tf, job.entry, job.gap);
  }

  /** Thứ tự ưu tiên: thiếu đầu của khung mịn nhất; hết đường (đã xin, không có thêm) thì thiếu đầu của khung thô hơn; mịn nhất đủ đầu thì lỗ hổng bên trong (mới → cũ). */
  private nextGap(need: LowerNeed, to: number, entries: Entry[]): { tf: string; entry: Entry; gap: Gap } | null {
    const now = this.now();
    const status = (e: Entry, g: Gap) => ((e.tries.get(g.key) ?? 0) >= MAX_TRIES ? "done" : now < e.readyAt ? "wait" : "ready");
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const tf = need.tfs[i];
      const head = headGap(e.bars, stepOf(tf), need.from, to);
      if (!head) {
        if (i > 0 || entries.length < 2) return null;
        const gap = this.holes(e, stepOf(tf), need.from, entries[1], stepOf(need.tfs[1])).find((g) => status(e, g) === "ready");
        return gap ? { tf, entry: e, gap } : null;
      }
      const s = status(e, head);
      if (s === "ready") return { tf, entry: e, gap: head };
      if (s === "wait") return null;
    }
    return null;
  }

  private holes(e: Entry, step: number, from: number, oracle: Entry, oracleStep: number): Gap[] {
    const edge = (b: Bar[]) => `${b.length}:${b[0]?.t}:${b[b.length - 1]?.t}`;
    const sig = `${edge(e.bars)}|${edge(oracle.bars)}|${from}`;
    if (e.holes?.sig !== sig) e.holes = { sig, gaps: holeGaps(e.bars, step, from, oracle.bars, oracleStep) };
    return e.holes.gaps;
  }

  /** Xin EA nạp chỗ thiếu rồi hỏi lại /bars tới khi có nến mới trong chỗ đó (hoặc hết MAX_POLLS), ghép vào cache và báo onChange. */
  private async runFill(symbol: string, tf: string, e: Entry, gap: Gap) {
    this.filling = true;
    e.busy = true;
    e.tries.set(gap.key, (e.tries.get(gap.key) ?? 0) + 1);
    let got: Bar[] = [];
    try {
      const count = Math.min(gap.bars + (gap.kind === "head" ? HEAD_MARGIN : HOLE_MARGIN), tf === TICK_TF ? this.tickChunk : this.chunk);
      if (!(await this.backfill!(symbol, tf, count, gap.before))) throw new Error("backfill refused");
      const polls = tf === TICK_TF ? TICK_POLLS : MAX_POLLS;
      for (let i = 0; i < polls && got.length === 0; i++) {
        await this.sleep(POLL_MS);
        got = await this.fetch(symbol, tf, gap.from, gap.to, Math.min(count + 100, this.pageSize));
      }
      if (got.length > 0) e.bars = spliceRange(e.bars, gap.from, gap.to, got);
      else e.readyAt = this.now() + WAIT_MS;
    } catch {
      e.readyAt = this.now() + RETRY_MS;
    }
    e.busy = false;
    this.filling = false;
    if (got.length > 0) this.ver++;
    this.onChange(); // chạy lại get(): tìm chỗ thiếu tiếp theo
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
    if (tf === TICK_TF && this.backfill) {
      // delta theo tick chỉ có khi EA tính: nhờ EA gửi lại vài phút gần nhất (phút đang chạy dở được ghi đè), đợi một chút rồi đọc
      await this.backfill(symbol, tf, TICK_TAIL_BARS, Math.max(to, e.hi)).catch(() => false);
      await this.sleep(TICK_TAIL_WAIT_MS);
    }
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
