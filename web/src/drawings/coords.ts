import type { Bar } from "@/lib/api";
import type { Anchor } from "./types";

// Chỉ số nến (logical) của thời điểm t: nội suy giữa 2 nến kề nhau, ngoài vùng dữ liệu thì
// ngoại suy theo step (giây mỗi nến).
export function timeToLogical(bars: Bar[], step: number, t: number): number | null {
  const n = bars.length;
  if (n === 0) return null;
  if (t <= bars[0].t) return (t - bars[0].t) / step;
  if (t >= bars[n - 1].t) return n - 1 + (t - bars[n - 1].t) / step;
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) lo = mid; else hi = mid;
  }
  return lo + (t - bars[lo].t) / (bars[hi].t - bars[lo].t);
}

// Thời điểm của nến gần logical nhất (bắt điểm vào nến).
export function logicalToTime(bars: Bar[], step: number, l: number): number | null {
  const n = bars.length;
  if (n === 0) return null;
  const i = Math.round(l);
  if (i < 0) return bars[0].t + i * step;
  if (i >= n) return bars[n - 1].t + (i - n + 1) * step;
  return bars[i].t;
}

// Nghịch đảo đúng của timeToLogical (giữ phần lẻ), dùng khi dịch điểm không nằm đúng nến.
function logicalToTimeExact(bars: Bar[], step: number, l: number): number | null {
  const n = bars.length;
  if (n === 0) return null;
  if (l <= 0) return bars[0].t + l * step;
  if (l >= n - 1) return bars[n - 1].t + (l - n + 1) * step;
  const i = Math.floor(l);
  return bars[i].t + (bars[i + 1].t - bars[i].t) * (l - i);
}

// Số nến giữa 2 thời điểm, đếm theo chỉ số nến như TradingView: nghỉ cuối tuần/giữa phiên
// không tính (H1 từ trưa thứ Sáu tới thứ Hai ra ~26 nến chứ không phải Δt/step = 75).
export function barsBetween(bars: Bar[], step: number, t0: number, t1: number): number {
  const a = timeToLogical(bars, step, t0), b = timeToLogical(bars, step, t1);
  if (a === null || b === null) return Math.round((t1 - t0) / step);
  return Math.round(b - a);
}

// Dịch cả hình: mọi điểm cùng dịch dBars nến và dPrice, nên hình giữ nguyên
// (chênh giá giữa các điểm và độ rộng tính theo số nến không đổi).
export function shiftAnchors(bars: Bar[], step: number, pts: Anchor[], dBars: number, dPrice: number): Anchor[] | null {
  const out: Anchor[] = [];
  for (const a of pts) {
    let time = a.time;
    if (dBars !== 0) {
      const l = timeToLogical(bars, step, a.time);
      const t = l === null ? null : logicalToTimeExact(bars, step, l + dBars);
      if (t === null) return null;
      time = Math.round(t);
    }
    out.push({ time, price: a.price + dPrice });
  }
  return out;
}
