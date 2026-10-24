import type { Bar, FpCell, TickCell } from "@/lib/api";
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
type FetchFp = (symbol: string, bars: number[], end: number, size: number) => Promise<FpCell[] | null>;
type Entry<T> = { sig: string; data: T | null; busy: boolean; retryAt: number; upTo: number };

const MAX_ACTIVE = 2; // số yêu cầu backend chạy cùng lúc
const MAX_ENTRIES = 64; // kết quả giữ trong bộ nhớ (kéo chart với Visible Range liên tục tạo khoá mới)
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

/** Kết quả nạp ngầm theo khoá: `get` trả bản đã nạp (null nếu chưa) và nạp lại khi chữ ký `sig` (dữ liệu tick bên dưới) đổi, vẫn trả bản cũ trong lúc chờ. Lỗi thì thử lại sau `RETRY_MS`. */
class SigFeed<T> {
  private cache = new Map<string, Entry<T>>();
  private active = 0;

  constructor(private onChange: () => void, private now: () => number) {}

  get(key: string, sig: string, load: () => Promise<T | null>, upTo = Infinity): T | null {
    let e = this.cache.get(key);
    if (e) {
      this.cache.delete(key); // LRU: mới dùng thì xếp cuối
      this.cache.set(key, e);
    } else {
      this.cache.set(key, (e = { sig: "", data: null, busy: false, retryAt: 0, upTo }));
      if (this.cache.size > MAX_ENTRIES) this.cache.delete(this.cache.keys().next().value as string);
    }
    if (e.sig !== sig && !e.busy && this.active < MAX_ACTIVE && this.now() >= e.retryAt) void this.run(load, sig, e, upTo);
    return e.data;
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

export class TickProfileFeed {
  private feed: SigFeed<TickHist>;

  constructor(private fetch: Fetch, onChange: () => void, now: () => number = Date.now) {
    this.feed = new SigFeed(onChange, now);
  }

  /** Histogram đã nạp của profile [t0, t1) chia theo `lay`; chưa có thì null và nạp ngầm rồi gọi `onChange`. `sig` đổi (dữ liệu đổi) thì nạp lại nhưng vẫn trả bản cũ trong lúc chờ.
   *  `upTo` (< t1): chỉ đọc DB tới đó (phần còn lại là phút đang chạy, xem `liveCut`). */
  get(symbol: string, t0: number, t1: number, lay: Layout, sig: string, upTo = t1): TickHist | null {
    return this.feed.get(this.key(symbol, t0, t1, lay), sig, async () => {
      const h = await this.fetch(symbol, t0, upTo, lay);
      return h && h.up.length === lay.N && h.dn.length === lay.N ? h : null;
    }, upTo);
  }

  /** Bản đang giữ của `get` cùng đối số đọc DB tới đâu. */
  heldUpTo(symbol: string, t0: number, t1: number, lay: Layout): number | undefined {
    return this.feed.heldUpTo(this.key(symbol, t0, t1, lay));
  }

  private key = (symbol: string, t0: number, t1: number, lay: Layout) => `${symbol}|${t0}|${t1}|${lay.lo}|${lay.size}|${lay.N}`;

  clear() {
    this.feed.clear();
  }
}

/** Như `TickProfileFeed` cho Big Trades: các ô (phút, giá) lớn nhất của [t0, t1) có volume >= `min`. */
export class TickBigFeed {
  private feed: SigFeed<TickCell[]>;

  constructor(private fetch: FetchBig, onChange: () => void, now: () => number = Date.now) {
    this.feed = new SigFeed(onChange, now);
  }

  get(symbol: string, t0: number, t1: number, min: number, limit: number, size: number, sig: string, upTo = t1): TickCell[] | null {
    return this.feed.get(this.key(symbol, t0, t1, min, limit, size), sig, () => this.fetch(symbol, t0, upTo, min, limit, size), upTo);
  }

  heldUpTo(symbol: string, t0: number, t1: number, min: number, limit: number, size: number): number | undefined {
    return this.feed.heldUpTo(this.key(symbol, t0, t1, min, limit, size));
  }

  private key = (symbol: string, t0: number, t1: number, min: number, limit: number, size: number) => `${symbol}|${t0}|${t1}|${min}|${limit}|${size}`;

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

  get(symbol: string, bars: number[], end: number, size: number, sig: string, upTo = end): FpCell[] | null {
    return this.feed.get(this.key(symbol, bars, size), sig, () => this.fetch(symbol, bars, upTo, size), upTo);
  }

  heldUpTo(symbol: string, bars: number[], size: number): number | undefined {
    return this.feed.heldUpTo(this.key(symbol, bars, size));
  }

  private key = (symbol: string, bars: number[], size: number) => `${symbol}|${bars[0]}|${size}`;

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
export function liveHist(feed: TickProfileFeed, symbol: string, cover: Bar[], lives: LiveMinute[], t0: number, t1: number, lay: Layout): TickHist | null {
  const cut = liveCut(lives[lives.length - 1], t0, t1);
  const h = feed.get(symbol, t0, t1, lay, `${cut}:${coverSig(cover, t0, cut)}`, cut);
  return h && addLiveHist(h, lay, liveFrom(lives, feed.heldUpTo(symbol, t0, t1, lay) ?? cut, t0, t1));
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
