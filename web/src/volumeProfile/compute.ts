import type { Bar, FpCell, TickCell, TickStat } from "@/lib/api";

// Volume profile dùng chung cho drawings (FRVP / AVP) và indicator (Session / Visible Range Volume Profile).

const VP_MAX_ROWS = 1000; // Ticks per row quá nhỏ trên mã nhiều tick: gộp lại cho khỏi hàng chục nghìn row

// Volume theo từng row giá + POC + Value Area (va = % tổng volume) của các nến đã lọc.
// Row như help của TV: "Number of rows" lấy ticks/row = (đỉnh − đáy) / số row / tick rồi làm tròn lên hoặc
// xuống sao cho tổng số row gần số yêu cầu nhất (row cuối có thể ngắn hơn, nên tổng row có thể lệch);
// "Ticks per row" thì Row Size chính là số tick mỗi row.
export type Profile = NonNullable<ReturnType<typeof finishProfile>>;
/** Các row của một profile: [lo, lo + N * size), mỗi row cao `size` (giá). */
export type Layout = { lo: number; hi: number; size: number; N: number };

/** Chia row cho vùng giá [min low, max high] của `bars` (xem quy tắc ở trên); null nếu không có nến. */
export function profileLayout(bars: Bar[], tick: number, rows: number, layout = "rows"): Layout | null {
  if (bars.length === 0) return null;
  let priceLow = Infinity, priceHigh = -Infinity;
  for (const b of bars) {
    priceLow = Math.min(priceLow, b.l);
    priceHigh = Math.max(priceHigh, b.h);
  }
  // giá đứng yên đúng một mức (h = l = bội số tick): vẫn một row cao 1 tick, không thì row cao 0 và profile không hiện gì
  const lowTick = Math.floor(priceLow / tick), highTick = Math.max(lowTick + 1, Math.ceil(priceHigh / tick));
  const totalTicks = Math.max(1, highTick - lowTick);
  const requestedRows = Math.max(1, Math.min(VP_MAX_ROWS, Math.round(rows))); // như ô Row Size (1..1000)
  const rowCandidates = [...new Set([
    Math.max(1, Math.floor(totalTicks / requestedRows)),
    Math.max(1, Math.ceil(totalTicks / requestedRows)),
  ])];
  const ticksPerRow = layout === "ticks"
    ? Math.max(1, Math.round(rows), Math.ceil(totalTicks / VP_MAX_ROWS))
    : rowCandidates.reduce((best, candidate) =>
        Math.abs(Math.ceil(totalTicks / candidate) - requestedRows) <
          Math.abs(Math.ceil(totalTicks / best) - requestedRows) ? candidate : best,
      );
  return { lo: lowTick * tick, hi: highTick * tick, size: ticksPerRow * tick, N: Math.max(1, Math.ceil(totalTicks / ticksPerRow)) };
}

export type LineKind = "poc" | "vah" | "val";

/** Giá của ba đường: VAH = đỉnh row cao nhất của Value Area, VAL = đáy row thấp nhất, POC = giữa row POC. */
export function profileLevels(vp: Profile): { kind: LineKind; price: number }[] {
  const { lo, hi, size, poc, vl, vh } = vp;
  return [
    { kind: "vah", price: Math.min(hi, lo + size * (vh + 1)) },
    { kind: "val", price: lo + size * vl },
    { kind: "poc", price: (lo + size * poc + Math.min(hi, lo + size * (poc + 1))) / 2 },
  ];
}

/** Dữ liệu tick cho volume profile "1 tick": `covered(t0)` = tick đã nạp tới đầu `t0`; `hist` = volume lên / xuống của tick trong [t0, t1) gom vào các row của `lay` (null = chưa nạp xong).
 *  `big` (Big Trades): các ô (phút, row giá cao `size`) lớn nhất của [t0, t1) có volume >= `min`, tối đa `limit` ô (null = chưa nạp xong). */
export type TickSource = {
  covered: (t0: number) => boolean;
  hist: (t0: number, t1: number, lay: Layout) => { up: number[]; dn: number[] } | null;
  big?: (t0: number, t1: number, min: number, limit: number, size: number) => TickCell[] | null;
  /** Big Trades Sensitivity (σ): số ô, tổng và tổng bình phương volume của mọi ô (phút, row giá cao `size`) trong [t0, t1) (null = chưa nạp xong). */
  stat?: (t0: number, t1: number, size: number) => TickStat | null;
  /** Footprint: tick của các phút [bars[0], end) gom theo (nến, row giá cao `size`); `bars` = giờ mở các nến tăng dần (null = chưa nạp xong). */
  fp?: (bars: number[], end: number, size: number) => FpCell[] | null;
};

/** Profile của [t0, t1) từ tick: row chia theo vùng giá của nến chart `chart` (như `computeProfile`), volume lên / xuống do `src` gom theo giá từng tick.
 *  null = chưa dùng được (tick chưa nạp tới đầu, chưa nạp xong, không có volume): người gọi dùng nến khung nhỏ thay. */
export function computeTickProfile(src: TickSource, chart: Bar[], t0: number, t1: number, tick: number, rows: number, va: number, layout = "rows") {
  if (!src.covered(t0)) return null;
  const lay = profileLayout(chart, tick, rows, layout);
  const h = lay && src.hist(t0, t1, lay);
  return lay && h ? finishProfile(lay, h.up, h.dn, va) : null;
}

export function computeProfile(bars: Bar[], tick: number, rows: number, va: number, layout = "rows") {
  const lay = profileLayout(bars, tick, rows, layout);
  if (!lay) return null;
  const { lo, size, N } = lay;
  const up = new Array(N).fill(0), dn = new Array(N).fill(0);
  for (const b of bars) {
    // `lo` = floor(low / tick) * tick có thể lớn hơn low thật vài ulp (3748.4300000000003 > 3748.43): kẹp để nến ở đáy không rơi vào row -1
    const row = (p: number) => Math.max(0, Math.min(N - 1, Math.floor((p - lo) / size)));
    const i0 = row(b.l), i1 = row(b.h);
    // Như TV: đóng > mở là up volume, còn lại (kể cả doji) là down
    const v = b.v, range = b.h - b.l, bucket = b.c > b.o ? up : dn;
    if (!(v > 0)) continue;
    if (range <= 0 || i0 === i1) { bucket[i0] += v; continue; }
    // Chia volume của nến theo tỉ lệ phần giá nến chồng lên từng row
    for (let i = i0; i <= i1; i++) {
      const rl = lo + size * i;
      const overlap = Math.min(b.h, rl + size) - Math.max(b.l, rl);
      if (overlap > 0) bucket[i] += (v * overlap) / range;
    }
  }
  return finishProfile(lay, up, dn, va);
}

/** Volume tổng, POC và Value Area (va = % tổng volume) từ volume lên / xuống đã chia vào các row của `lay`; null nếu không có volume. */
export function finishProfile(lay: Layout, up: number[], dn: number[], va: number) {
  const { lo, hi, size, N } = lay;
  const total: number[] = up.map((v, i) => v + dn[i]);
  const mv = total.reduce((m, v) => Math.max(m, v), -Infinity), sum = total.reduce((s, v) => s + v, 0); // không spread: footprint 1 tick / row có thể hàng trăm nghìn row
  if (!(sum > 0)) return null;
  const poc = total.indexOf(mv);

  let vl = poc, vh = poc, acc = total[poc];
  const target = (sum * Math.max(0, Math.min(100, va))) / 100;
  while (acc < target && (vl > 0 || vh < N - 1)) {
    const canUp = vh < N - 1, canDn = vl > 0;
    const above = canUp ? total[vh + 1] : -1;
    const below = canDn ? total[vl - 1] : -1;
    let takeAbove = canUp && (!canDn || above > below);
    if (canUp && canDn && above === below) {
      takeAbove = vh + 1 - poc <= poc - (vl - 1);
    }
    const candidate = takeAbove ? above : below;
    if (acc + candidate > target * (1 + 1e-12)) break; // `acc` cộng khác thứ tự với `sum`: VA 100% không được hụt row ở mép vì sai số làm tròn
    acc += candidate;
    if (takeAbove) vh++;
    else vl--;
  }
  return { lo, hi, size, N, up, dn, total, mv, poc, vl, vh };
}
