import type { Bar, FpCell, TickCell, TickStat } from "@/lib/api";
import type { Layout } from "@/volumeProfile/compute";

// Volume Profile "1 tick" (Session / Visible Range): mỗi tick rơi đúng vào row chứa giá của nó. Backend giữ histogram giá theo phút (bảng tickvp) và gom sẵn
// vào các row của profile (/tickvp) nên web chỉ nhận vài trăm số cho mỗi profile. Nến delta tick (tf "TD", LowerFeed) cho biết phút nào đã có tick.
// Big Trades dùng cùng bảng đó: /tickbig trả thẳng các ô (phút, giá) lớn nhất.
// Realtime: backend đẩy ô giá của PHÚT ĐANG CHẠY sau mỗi lô tick (`LiveMinute`); phần cũ hơn vẫn đọc từ DB (chỉ đọc lại khi sang phút mới) rồi cộng phút đang chạy vào,
// nên mỗi tick không phải quét lại cả khoảng.

export type TickHist = { up: number[]; dn: number[] };
/** Phút đang chạy do backend đẩy: `t` = đầu phút (UTC giây), `cells` = [giá, volume lên, volume xuống]. */
export type LiveMinute = { t: number; cells: [number, number, number][] };
type Fetch = (symbol: string, from: number, to: number, lay: Layout) => Promise<TickHist | null>;
type FetchBig = (symbol: string, from: number, to: number, min: number, limit: number, size: number) => Promise<TickCell[] | null>;
type FetchStat = (symbol: string, from: number, to: number, size: number) => Promise<TickStat | null>;
type FetchFp = (symbol: string, bars: number[], end: number, size: number) => Promise<FpCell[] | null>;
type Entry<T> = { sig: string; data: T | null; busy: boolean; retryAt: number; upTo: number; meta?: unknown };

const MAX_ACTIVE = 2; // số yêu cầu backend chạy cùng lúc
const MAX_ENTRIES = 64; // kết quả giữ trong bộ nhớ (kéo chart với Visible Range liên tục tạo khoá mới)
const RETRY_MS = 10_000;
const NEAR = 0.8; // histogram của profile khác dùng tạm được khi khoảng thời gian trùng từng đó (xem `TickProfileFeed.borrow`)
const BIG_NEAR = 0.5; // ô Big Trades của khoảng cùng đầu dùng tạm được khi `t1` lệch không quá nửa độ dài khoảng (xem `TickBigFeed.borrow`)
const STAT_NEAR = 0.5; // thống kê của khoảng khác dùng tạm được khi trùng từng đó (khoảng dịch một khối trong 6 khối trùng ~0.71)
const HEAD_SLACK = 300; // giây: nến delta đầu tiên muộn hơn đầu profile quá chừng này là chưa nạp tới đầu (giống LowerFeed: 5 phút)

/** Dữ liệu tick đã nạp (nến delta "TD", tăng dần) phủ tới đầu `t0` chưa. `start` (>= t0): lúc thị trường thật sự có giao dịch từ `t0` (LowerFeed.tradeStart), tick đầu muộn tới đó vẫn là đủ. */
export function coversFrom(cover: Bar[], t0: number, start = t0): boolean {
  return cover.length > 0 && cover[0].t <= Math.max(t0, start) + HEAD_SLACK;
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

/** Kết quả nạp ngầm theo khoá: `get` trả bản đã nạp (null nếu chưa) và nạp lại khi chữ ký `sig` (dữ liệu tick bên dưới) đổi, vẫn trả bản cũ trong lúc chờ. Lỗi thì thử lại sau `RETRY_MS`. */
class SigFeed<T> {
  private cache = new Map<string, Entry<T>>();
  private active = 0;

  constructor(private onChange: () => void, private now: () => number) {}

  get(key: string, sig: string, load: () => Promise<T | null>, upTo = Infinity, meta?: unknown): T | null {
    let e = this.cache.get(key);
    if (e) {
      this.cache.delete(key); // LRU: mới dùng thì xếp cuối
      this.cache.set(key, e);
    } else {
      this.cache.set(key, (e = { sig: "", data: null, busy: false, retryAt: 0, upTo, meta }));
      if (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    }
    if (e.sig !== sig && !e.busy && this.active < MAX_ACTIVE && this.now() >= e.retryAt) void this.run(load, sig, e, upTo);
    return e.data;
  }

  /** Lần nạp gần nhất của `key` lỗi và chưa tới lúc thử lại. */
  failed(key: string): boolean {
    const e = this.cache.get(key);
    return !!e && e.retryAt > this.now();
  }

  /** Entry khác `skip` (đã nạp xong, có `meta`) có điểm `score(meta)` cao nhất và >= `min`; điểm bằng nhau lấy entry dùng gần đây hơn. `upTo` = bản đó đọc DB tới đâu. */
  nearest<M>(skip: string, score: (meta: M) => number, min: number): { data: T; meta: M; upTo: number } | null {
    let best: { data: T; meta: M; upTo: number } | null = null;
    let top = min;
    for (const [k, e] of this.cache) {
      if (k === skip || !e.data || e.meta === undefined) continue;
      const v = score(e.meta as M);
      if (v >= top) {
        top = v;
        best = { data: e.data, meta: e.meta as M, upTo: e.upTo };
      }
    }
    return best;
  }

  /** Dữ liệu đang giữ của `key` được đọc từ DB tới mốc nào (undefined nếu chưa có). */
  heldUpTo(key: string): number | undefined {
    const e = this.cache.get(key);
    return e?.data ? e.upTo : undefined;
  }

  clear() {
    this.cache.clear();
  }

  private async run(load: () => Promise<T | null>, sig: string, e: Entry<T>, upTo: number) {
    e.busy = true;
    this.active++;
    let got: T | null = null;
    try {
      got = await load();
    } catch {
      got = null;
    }
    this.active--;
    e.busy = false;
    if (got) {
      e.data = got;
      e.sig = sig;
      e.upTo = upTo;
    } else e.retryAt = this.now() + RETRY_MS;
    this.onChange();
  }
}

type Win = { symbol: string; t0: number; t1: number; lay: Layout };

/** Hai khoảng thời gian trùng nhau bao nhiêu phần (phần chung / phần hợp, 0..1). */
export function overlapRatio(a0: number, a1: number, b0: number, b1: number): number {
  const union = Math.max(a1, b1) - Math.min(a0, b0);
  return union > 0 ? Math.max(0, Math.min(a1, b1) - Math.max(a0, b0)) / union : 0;
}

/** Chia lại histogram `h` (row của `from`) sang row của `to`: volume mỗi row cũ trải theo phần giá chồng lên từng row mới, phần nằm ngoài vùng giá mới dồn vào row đầu / cuối (như backend). */
export function rebin(h: TickHist, from: Layout, to: Layout): TickHist {
  if (from.lo === to.lo && from.size === to.size && from.N === to.N) return h;
  const up = new Array<number>(to.N).fill(0);
  const dn = new Array<number>(to.N).fill(0);
  const top = to.lo + to.N * to.size;
  for (let i = 0; i < from.N; i++) {
    const u = h.up[i] ?? 0;
    const d = h.dn[i] ?? 0;
    if (!(u > 0 || d > 0)) continue;
    const a = from.lo + i * from.size;
    const b = a + from.size;
    const put = (j: number, share: number) => {
      up[j] += u * share;
      dn[j] += d * share;
    };
    put(0, Math.max(0, Math.min(b, to.lo) - a) / from.size); // dưới vùng mới
    put(to.N - 1, Math.max(0, b - Math.max(a, top)) / from.size); // trên vùng mới
    const j0 = Math.max(0, Math.floor((a - to.lo) / to.size));
    const j1 = Math.min(to.N - 1, Math.ceil((b - to.lo) / to.size) - 1);
    for (let j = j0; j <= j1; j++) {
      const rl = to.lo + j * to.size;
      const share = (Math.min(b, rl + to.size) - Math.max(a, rl)) / from.size;
      if (share > 0) put(j, share);
    }
  }
  return { up, dn };
}

export class TickProfileFeed {
  private feed: SigFeed<TickHist>;
  private borrowed = new Map<string, { src: TickHist; out: TickHist; upTo: number }>(); // bản mượn (đã chia lại theo row của khoá) theo khoá: build lại liên tục trong lúc chờ không phải chia lại

  constructor(private fetch: Fetch, onChange: () => void, now: () => number = Date.now) {
    this.feed = new SigFeed(onChange, now);
  }

  /** Histogram đã nạp của profile [t0, t1) chia theo `lay`; chưa có thì nạp ngầm rồi gọi `onChange`, trong lúc chờ trả bản của profile gần giống (xem `borrow`) hoặc null. `sig` đổi (dữ liệu đổi) thì nạp lại nhưng vẫn trả bản cũ trong lúc chờ.
   *  `upTo` (< t1): chỉ đọc DB tới đó (phần còn lại là phút đang chạy, xem `liveCut`). `strict` (Replay): không mượn bản của khoảng dài quá `t1` (histogram không cắt theo thời gian được, sẽ lộ tick tương lai). */
  get(symbol: string, t0: number, t1: number, lay: Layout, sig: string, upTo = t1, strict = false): TickHist | null {
    const key = this.key(symbol, t0, t1, lay);
    const h = this.feed.get(key, sig, async () => {
      const h = await this.fetch(symbol, t0, upTo, lay);
      return h && h.up.length === lay.N && h.dn.length === lay.N ? h : null;
    }, upTo, { symbol, t0, t1, lay } satisfies Win);
    if (h) {
      this.borrowed.delete(key);
      return h;
    }
    return this.borrow(key, symbol, t0, t1, lay, strict)?.out ?? null;
  }

  /** Chưa có bản của khoá này (phiên dài thêm một nến, thêm đỉnh / đáy làm đổi row, kéo / zoom Visible Range): thay vì để profile rơi về nến cho tới khi backend trả,
   *  dùng tạm histogram đã nạp của một profile cùng symbol phủ gần như cùng khoảng thời gian (chia lại sang row mới), cùng mốc DB `upTo` của chính bản đó. Lần nạp trước đó lỗi thì không dùng. */
  private borrow(key: string, symbol: string, t0: number, t1: number, lay: Layout, strict: boolean): { out: TickHist; upTo: number } | null {
    if (this.feed.failed(key)) return null;
    const near = this.feed.nearest<Win>(key, (w) => (w.symbol === symbol && !(strict && w.t1 > t1) ? overlapRatio(w.t0, w.t1, t0, t1) : 0), NEAR);
    if (!near) {
      this.borrowed.delete(key);
      return null;
    }
    let b = this.borrowed.get(key);
    if (!b || b.src !== near.data) {
      b = { src: near.data, out: rebin(near.data, near.meta.lay, lay), upTo: near.upTo };
      this.borrowed.delete(key);
      this.borrowed.set(key, b);
      if (this.borrowed.size > MAX_ENTRIES) this.borrowed.delete(this.borrowed.keys().next().value as string);
    }
    return b;
  }

  /** Bản đang giữ của `get` cùng đối số đọc DB tới đâu; chưa có bản của khoá này mà đang dùng tạm bản của profile khác thì là mốc của bản mượn
   *  (phút live cộng theo mốc đó: tính theo mốc khoá mới thì phút nằm giữa hai mốc mất, hoặc phút đang chạy đã nằm trong DB bị cộng hai lần). */
  heldUpTo(symbol: string, t0: number, t1: number, lay: Layout, strict = false): number | undefined {
    const key = this.key(symbol, t0, t1, lay);
    return this.feed.heldUpTo(key) ?? this.borrow(key, symbol, t0, t1, lay, strict)?.upTo;
  }

  private key = (symbol: string, t0: number, t1: number, lay: Layout) => `${symbol}|${t0}|${t1}|${lay.lo}|${lay.size}|${lay.N}`;

  clear() {
    this.feed.clear();
    this.borrowed.clear();
  }
}

type BigWin = { symbol: string; t0: number; t1: number; min: number; limit: number; size: number };
/** Ô Big Trades; `floor` (bản mượn đã lọc từ một bản bị cắt ở `limit` ô): các ô nhỏ hơn mức này có thể thiếu dù danh sách ít hơn `limit` ô. */
export type BigCells = TickCell[] & { floor?: number };

/** Như `TickProfileFeed` cho Big Trades: các ô (phút, giá) lớn nhất của [t0, t1) có volume >= `min`. */
export class TickBigFeed {
  private feed: SigFeed<TickCell[]>;

  constructor(private fetch: FetchBig, onChange: () => void, now: () => number = Date.now) {
    this.feed = new SigFeed(onChange, now);
  }

  /** Các ô đã nạp của [t0, t1); chưa có thì nạp ngầm rồi gọi `onChange`, trong lúc chờ trả bản của khoảng cùng đầu / ngưỡng / số ô / row có `t1` gần nhất (xem `borrow`) hoặc null. */
  get(symbol: string, t0: number, t1: number, min: number, limit: number, size: number, sig: string, upTo = t1): BigCells | null {
    const w: BigWin = { symbol, t0, t1, min, limit, size };
    const key = this.key(symbol, t0, t1, min, limit, size);
    return this.feed.get(key, sig, () => this.fetch(symbol, t0, upTo, min, limit, size), upTo, w) ?? this.borrow(key, w)?.cells ?? null;
  }

  heldUpTo(symbol: string, t0: number, t1: number, min: number, limit: number, size: number): number | undefined {
    const key = this.key(symbol, t0, t1, min, limit, size);
    return this.feed.heldUpTo(key) ?? this.borrow(key, { symbol, t0, t1, min, limit, size })?.upTo;
  }

  /** Khoảng hay ngưỡng đổi (Replay bước thêm một nến, nến mới nối đuôi, đầu khoảng trôi theo độ sâu tick, ngưỡng sigma đổi khi thống kê nạp lại mỗi phút) là khoá mới chưa có gì để vẽ,
   *  bubble biến mất tới khi backend trả. Thay vào đó dùng tạm các ô đã nạp của khoảng cùng symbol / số ô / row trùng nhiều nhất (ưu tiên cùng ngưỡng), bỏ các ô ngoài [t0, t1)
   *  (mốc cắt lùi về sớm hơn thì không lộ ô của phía sau) và nhỏ hơn ngưỡng mới. Ngưỡng mới thấp hơn thì tạm thiếu các ô nhỏ. Lần nạp trước của khoá này lỗi thì không dùng. */
  private borrow(key: string, w: BigWin): { cells: TickCell[]; upTo: number } | null {
    if (this.feed.failed(key)) return null;
    const near = this.feed.nearest<BigWin>(
      key,
      (m) => (m.symbol === w.symbol && m.limit === w.limit && m.size === w.size ? overlapRatio(m.t0, m.t1, w.t0, w.t1) * (m.min === w.min ? 1 : 0.99) : -1),
      BIG_NEAR,
    );
    if (!near) return null;
    const m = near.meta;
    if (!(m.t1 > w.t1 || m.t0 < w.t0 || m.min < w.min)) return { cells: near.data, upTo: Math.min(near.upTo, w.t1) };
    const cells: BigCells = near.data.filter((c) => c.t >= w.t0 && c.t < w.t1 && c.up + c.dn >= w.min);
    if (near.data.length >= m.limit) cells.floor = near.data.reduce((lo, c) => Math.min(lo, c.up + c.dn), Infinity); // bản gốc bị cắt: lọc xong ít ô hơn vẫn không đủ
    return { cells, upTo: Math.min(near.upTo, w.t1) };
  }

  private key = (symbol: string, t0: number, t1: number, min: number, limit: number, size: number) => `${symbol}|${t0}|${t1}|${min}|${limit}|${size}`;

  clear() {
    this.feed.clear();
  }
}

type StatWin = { symbol: string; t0: number; t1: number; size: number };

/** Thống kê volume của các ô (phút, row giá cao `size`) trong [t0, t1) cho ngưỡng Sensitivity (σ) của Big Trades. Không cộng phút đang chạy (một phút trong cả khoảng nhiều giờ không đổi trung bình / độ lệch đáng kể). */
export class TickStatFeed {
  private feed: SigFeed<TickStat>;

  constructor(private fetch: FetchStat, onChange: () => void, now: () => number = Date.now) {
    this.feed = new SigFeed(onChange, now);
  }

  /** Khoảng thống kê dịch theo khối cố định: sang khối mới chưa có bản của khoá này thì dùng tạm bản của khoảng cùng symbol / row trùng nhiều nhất (ngưỡng chỉ lệch nhẹ), không để bubble biến mất. */
  get(symbol: string, t0: number, t1: number, size: number, sig: string, upTo = t1, strict = false): TickStat | null {
    const key = `${symbol}|${t0}|${t1}|${size}`;
    const w: StatWin = { symbol, t0, t1, size };
    const got = this.feed.get(key, sig, () => this.fetch(symbol, t0, upTo, size), upTo, w);
    if (got) return got;
    if (this.feed.failed(key)) return null;
    return this.feed.nearest<StatWin>(key, (m) => (m.symbol === symbol && m.size === size && !(strict && m.t1 > t1) ? overlapRatio(m.t0, m.t1, t0, t1) : 0), STAT_NEAR)?.data ?? null;
  }

  clear() {
    this.feed.clear();
  }
}

/** Như `TickBigFeed` cho Footprint: ô (nến, row giá) của các phút [bars[0], end). Khoá theo (symbol, nến đầu, size) chứ không theo số nến / `end`: nến mới nối đuôi (cùng nến đầu) chỉ đổi `sig` nên
 *  bản cũ vẫn hiện trong lúc nạp lại; chỉ số nến trong bản cũ vẫn đúng vì danh sách nến chỉ dài thêm ở cuối. */
export class TickFpFeed {
  private feed: SigFeed<FpCell[]>;

  constructor(private fetch: FetchFp, onChange: () => void, now: () => number = Date.now) {
    this.feed = new SigFeed(onChange, now);
  }

  /** `step`: giây mỗi nến chart, thuộc khoá (cửa sổ của khung lớn hay bắt đầu đúng giờ của một cửa sổ khung nhỏ: không được dùng ô theo nến của khung kia).
   *  `strict` (Replay): bản cũ đọc DB xa hơn `upTo` (mốc cắt vừa lùi) không được hiện trong lúc nạp lại: ô không có thời gian nên không bỏ được phần sau mốc. */
  get(symbol: string, bars: number[], end: number, size: number, sig: string, upTo = end, step = 0, strict = false): FpCell[] | null {
    const key = this.key(symbol, bars, size, step);
    const got = this.feed.get(key, sig, () => this.fetch(symbol, bars, upTo, size), upTo);
    return strict && got && (this.feed.heldUpTo(key) ?? upTo) > upTo ? null : got;
  }

  heldUpTo(symbol: string, bars: number[], size: number, step = 0): number | undefined {
    return this.feed.heldUpTo(this.key(symbol, bars, size, step));
  }

  private key = (symbol: string, bars: number[], size: number, step: number) => `${symbol}|${step}|${bars[0]}|${size}`;

  clear() {
    this.feed.clear();
  }
}

/** Phút đang chạy nằm trong [t0, t1) thì DB chỉ cần đọc tới đầu phút đó (phút đó lấy từ `live`); không thì đọc hết t1. */
export const liveCut = (live: LiveMinute | undefined, t0: number, t1: number): number => (live && live.t >= t0 && live.t < t1 ? live.t : t1);

/** Các phút còn giữ trong bộ nhớ mà bản DB đang giữ (đọc tới `held`) chưa có: phút từ `held` trở đi, trong [t0, t1). Phút vừa đóng vẫn nằm ở đây tới khi bản đọc lại xong
 *  nên bubble / row của nó không biến mất trong lúc chờ. */
export const liveFrom = (lives: LiveMinute[], held: number, t0: number, t1: number): LiveMinute[] => lives.filter((l) => l.t >= held && l.t >= t0 && l.t < t1);

/** Số phút tick gần nhất giữ trong bộ nhớ (phút đang chạy + vài phút vừa đóng chờ bản DB đọc lại theo kịp). */
export const LIVE_KEEP = 3;

/** Thêm phút `live` (mới nhất) vào danh sách phút đang giữ: phút cùng hoặc sau nó bị thay, chỉ giữ `LIVE_KEEP` phút cuối. */
export const appendLive = (lives: LiveMinute[], live: LiveMinute): LiveMinute[] => [...lives.filter((l) => l.t < live.t), live].slice(-LIVE_KEEP);

/** Histogram của profile [t0, t1) = bản DB (tới đầu phút đang chạy) + các phút `lives` mà bản đó chưa có. null = DB chưa nạp xong. */
export function liveHist(feed: TickProfileFeed, symbol: string, cover: Bar[], lives: LiveMinute[], t0: number, t1: number, lay: Layout, strict = false): TickHist | null {
  const cut = liveCut(lives[lives.length - 1], t0, t1);
  const h = feed.get(symbol, t0, t1, lay, `${cut}:${coverSig(cover, t0, cut)}`, cut, strict);
  return h && addLiveHist(h, lay, liveFrom(lives, feed.heldUpTo(symbol, t0, t1, lay, strict) ?? cut, t0, t1));
}

/** Cộng các phút `lives` vào histogram `h` của profile: tick ở giá `p` vào row `floor((p - lo) / size)` (như backend), giá ngoài khoảng dồn vào row đầu / cuối. */
export function addLiveHist(h: TickHist, lay: Layout, lives: LiveMinute[]): TickHist {
  if (lives.length === 0) return h;
  const up = h.up.slice();
  const dn = h.dn.slice();
  for (const live of lives)
    for (const [p, u, d] of live.cells) {
      const i = Math.min(lay.N - 1, Math.max(0, Math.floor((p - lay.lo) / lay.size + 1e-6)));
      up[i] += u;
      dn[i] += d;
    }
  return { up, dn };
}

/** Gộp các ô của các phút `lives` vào danh sách ô lớn nhất `base`: mỗi phút gom giá vào row cao `size` (giá của ô = giá trung bình theo volume, như backend),
 *  bỏ ô nhỏ hơn `min`, giữ `limit` ô lớn nhất (bằng nhau thì ô mới hơn) rồi sắp theo thời gian. */
export function mergeLiveBig(base: TickCell[], lives: LiveMinute[], min: number, limit: number, size: number): TickCell[] {
  if (lives.length === 0) return base;
  const extra: TickCell[] = [];
  for (const live of lives) {
    if (size > 0) {
      const rows = new Map<number, { sp: number; up: number; dn: number }>();
      for (const [p, up, dn] of live.cells) {
        if (up + dn <= 0) continue;
        const k = Math.floor(p / size + 1e-6);
        const r = rows.get(k) ?? { sp: 0, up: 0, dn: 0 };
        r.sp += p * (up + dn);
        r.up += up;
        r.dn += dn;
        rows.set(k, r);
      }
      for (const r of rows.values()) extra.push({ t: live.t, p: r.sp / (r.up + r.dn), up: r.up, dn: r.dn });
    } else for (const [p, up, dn] of live.cells) if (up + dn > 0) extra.push({ t: live.t, p, up, dn });
  }
  return base
    .concat(extra.filter((c) => c.up + c.dn >= min))
    .sort((a, b) => b.up + b.dn - (a.up + a.dn) || b.t - a.t)
    .slice(0, limit)
    .sort((a, b) => a.t - b.t || a.p - b.p);
}

/** Cộng các phút `lives` vào ô footprint `base`: mỗi tick ở giá `p` vào row `floor(p / size)` (như backend) của nến chứa phút đó (`bars` = giờ mở các nến tăng dần, nến cuối tới `end`); phút ngoài [bars[0], end) bỏ. */
export function mergeLiveFp(base: FpCell[], lives: LiveMinute[], bars: number[], end: number, size: number): FpCell[] {
  if (lives.length === 0 || bars.length === 0) return base;
  const acc = new Map<string, FpCell>(base.map((c) => [`${c[0]}:${c[1]}`, [...c] as FpCell]));
  for (const live of lives) {
    if (live.t < bars[0] || live.t >= end) continue;
    let lo = 0;
    let hi = bars.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (bars[mid] <= live.t) lo = mid;
      else hi = mid - 1;
    }
    for (const [p, up, dn] of live.cells) {
      if (up + dn <= 0) continue;
      const row = Math.floor(p / size + 1e-6);
      const key = `${lo}:${row}`;
      const c = acc.get(key);
      if (c) {
        c[2] += up;
        c[3] += dn;
      } else acc.set(key, [lo, row, up, dn]);
    }
  }
  return [...acc.values()].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
}
