import type { Bar } from "@/lib/api";

// Volume profile dùng chung cho drawings (FRVP / AVP) và indicator (Session / Visible Range Volume Profile).

const VP_MAX_ROWS = 1000; // Ticks per row quá nhỏ trên mã nhiều tick: gộp lại cho khỏi hàng chục nghìn row

// Volume theo từng row giá + POC + Value Area (va = % tổng volume) của các nến đã lọc.
// Row như help của TV: "Number of rows" lấy ticks/row = (đỉnh − đáy) / số row / tick rồi làm tròn lên hoặc
// xuống sao cho tổng số row gần số yêu cầu nhất (row cuối có thể ngắn hơn, nên tổng row có thể lệch);
// "Ticks per row" thì Row Size chính là số tick mỗi row.
export type Profile = NonNullable<ReturnType<typeof computeProfile>>;

export function computeProfile(bars: Bar[], tick: number, rows: number, va: number, layout = "rows") {
  if (bars.length === 0) return null;
  const priceLow = Math.min(...bars.map((b) => b.l)), priceHigh = Math.max(...bars.map((b) => b.h));
  const lowTick = Math.floor(priceLow / tick), highTick = Math.ceil(priceHigh / tick);
  const totalTicks = Math.max(1, highTick - lowTick);
  const requestedRows = Math.max(2, Math.min(500, Math.round(rows)));
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
  const lo = lowTick * tick, hi = highTick * tick, size = ticksPerRow * tick;
  const N = Math.max(1, Math.ceil(totalTicks / ticksPerRow));
  const up = new Array(N).fill(0), dn = new Array(N).fill(0);
  for (const b of bars) {
    const i0 = Math.min(N - 1, Math.floor((b.l - lo) / size)), i1 = Math.min(N - 1, Math.floor((b.h - lo) / size));
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
  const total: number[] = up.map((v, i) => v + dn[i]);
  const mv = Math.max(...total), sum = total.reduce((s, v) => s + v, 0);
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
    if (acc + candidate > target) break;
    acc += candidate;
    if (takeAbove) vh++;
    else vl--;
  }
  return { lo, hi, size, N, up, dn, total, mv, poc, vl, vh };
}
