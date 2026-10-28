import { TF_SECONDS, type Bar } from "@/lib/api";

export function heikinAshi(bars: Bar[]): Bar[] {
  const out: Bar[] = [];
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    const c = (b.o + b.h + b.l + b.c) / 4;
    const o = i === 0 ? (b.o + b.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
    out.push({ t: b.t, o, h: Math.max(b.h, o, c), l: Math.min(b.l, o, c), c, v: b.v });
  }
  return out;
}

// Nến mới nạp (từ DB) ghi đè nến cũ cùng mốc - trừ nến cuối `liveT` đang chạy realtime
// (WS mới là nguồn đúng nhất của nó). Nến trước đó có thể là bản gom dở đã được EA sửa lại.
// liveT = Infinity: mọi nến của `add` thắng (vd `add` là nến WS đẩy tới trong lúc chờ tải DB).
export function mergeBars(cur: Bar[], add: Bar[], liveT: number): Bar[] {
  const m = new Map(cur.map((b) => [b.t, b]));
  for (const b of add) if (!m.has(b.t) || b.t < liveT) m.set(b.t, b);
  return [...m.values()].sort((a, b) => a.t - b.t);
}

/** Thấp nhất / cao nhất của các nến (vòng lặp: `Math.min(...bars)` vượt giới hạn tham số của V8 khi quá ~120k nến). null khi rỗng. */
export function priceExtent(bars: readonly Bar[]): { lo: number; hi: number } | null {
  if (!bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (b.l < lo) lo = b.l;
    if (b.h > hi) hi = b.h;
  }
  return { lo, hi };
}

/** Tick lúc `t` (giây UTC) có thuộc nến `last` của khung `tf` không. Không thì đừng đẩy giá của nó vào `last` (nến đã đóng
 *  sẽ thành nến ma); nến mới do bar_update mang tới. MN1 dài 28-31 ngày nên chỉ chặn phía trước; thiếu `t` thì coi như thuộc. */
export function tickInBar(last: Pick<Bar, "t">, tf: string, t: number | undefined): boolean {
  if (typeof t !== "number" || !Number.isFinite(t)) return true;
  if (t < last.t) return false;
  return tf === "MN1" || t < last.t + TF_SECONDS[tf];
}
