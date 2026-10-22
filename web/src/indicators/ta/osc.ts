import type { Bar } from "@/lib/api";
import { isNa, type Num } from "./core";
import { nan } from "./core";
import { rma, sma } from "./ma";
import { change, dev, fixnan, highest, lowest, sum } from "./stat";

/** Pine ta.tr(handle_na): handleNa = true (ta.atr) thì nến đầu = high − low, false (ta.tr trần, DMI) thì na. */
export function trueRange(bars: Bar[], handleNa = true): Num {
  return bars.map((b, i) =>
    i === 0 ? (handleNa ? b.h - b.l : NaN) : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)),
  );
}

export const atr = (bars: Bar[], n: number): Num => rma(trueRange(bars), n);

/** Pine ta.rsi: RMA của phần tăng / phần giảm. */
export function rsi(a: Num, n: number): Num {
  const ch = change(a);
  const up = rma(ch.map((x) => (isNa(x) ? NaN : Math.max(x, 0))), n);
  const dn = rma(ch.map((x) => (isNa(x) ? NaN : Math.max(-x, 0))), n);
  return up.map((u, i) => (isNa(u) || isNa(dn[i]) ? NaN : dn[i] === 0 ? 100 : u === 0 ? 0 : 100 - 100 / (1 + u / dn[i])));
}

/** Pine rsi(x, y) của MFI: 100 − 100/(1 + x/y); y = 0 -> 100, x = 0 -> 0. */
const ratioIndex = (x: number, y: number): number => (isNa(x) || isNa(y) ? NaN : y === 0 ? 100 : x === 0 ? 0 : 100 - 100 / (1 + x / y));

/** Pine ta.cci: (src − sma) / (0.015·dev); dev = 0 thì na. */
export function cci(a: Num, n: number): Num {
  const m = sma(a, n);
  const d = dev(a, n);
  return a.map((x, i) => (d[i] === 0 ? NaN : (x - m[i]) / (0.015 * d[i])));
}

/** Pine ta.mfi: money flow của n nến. Nến đầu (chưa có change) tính vào cả hai phía như Pine. */
export function mfi(src: Num, vol: Num, n: number): Num {
  const ch = change(src);
  const upper = sum(src.map((x, i) => vol[i] * (ch[i] <= 0 ? 0 : x)), n);
  const lower = sum(src.map((x, i) => vol[i] * (ch[i] >= 0 ? 0 : x)), n);
  return upper.map((u, i) => ratioIndex(u, lower[i]));
}

/** Pine ta.obv: cộng/trừ volume theo chiều đổi của giá đóng cửa; bắt đầu từ nến thứ hai. Giá trị tuyệt đối phụ thuộc điểm bắt đầu lịch sử. */
export function obv(bars: Bar[]): Num {
  let s = 0;
  return bars.map((b, i) => (i === 0 ? NaN : (s += Math.sign(b.c - bars[i - 1].c) * b.v)));
}

/** Pine ta.mom: a[i] − a[i−n]. */
export const mom = (a: Num, n: number): Num => a.map((x, i) => (i < n ? NaN : x - a[i - n]));

/** Pine ta.roc: 100·(a[i] − a[i−n]) / a[i−n]. */
export const roc = (a: Num, n: number): Num => a.map((x, i) => (i < n ? NaN : (100 * (x - a[i - n])) / a[i - n]));

/** Williams %R: −100·(highest − src)/(highest − lowest), 0..−100. */
export function williamsR(src: Num, high: Num, low: Num, n: number): Num {
  const hh = highest(high, n);
  const ll = lowest(low, n);
  return src.map((x, i) => (hh[i] === ll[i] ? NaN : (100 * (x - hh[i])) / (hh[i] - ll[i])));
}

/** Pine ta.dmi: [+DI, −DI, ADX]. */
export function dmi(bars: Bar[], diLength: number, adxSmoothing: number): [Num, Num, Num] {
  const up = change(bars.map((b) => b.h));
  const down = change(bars.map((b) => b.l)).map((x) => -x);
  const plusDM = up.map((u, i) => (isNa(u) ? NaN : u > down[i] && u > 0 ? u : 0));
  const minusDM = down.map((d, i) => (isNa(d) ? NaN : d > up[i] && d > 0 ? d : 0));
  const tr = rma(trueRange(bars, false), diLength);
  const plus = fixnan(rma(plusDM, diLength).map((x, i) => (100 * x) / tr[i]));
  const minus = fixnan(rma(minusDM, diLength).map((x, i) => (100 * x) / tr[i]));
  const adx = rma(plus.map((p, i) => Math.abs(p - minus[i]) / (p + minus[i] === 0 ? 1 : p + minus[i])), adxSmoothing).map((x) => 100 * x);
  return [plus, minus, adx];
}

/** Pine ta.sar (Parabolic SAR). Nến đầu na. */
export function sar(bars: Bar[], start: number, inc: number, max: number): Num {
  const out = nan(bars.length);
  let result = NaN;
  let maxMin = NaN;
  let acc = start;
  let isBelow = false;
  for (let i = 1; i < bars.length; i++) {
    const { h, l, c } = bars[i];
    let firstTrendBar = false;
    if (i === 1) {
      if (c > bars[0].c) { isBelow = true; maxMin = h; result = bars[0].l; }
      else { isBelow = false; maxMin = l; result = bars[0].h; }
      firstTrendBar = true;
      acc = start;
    }
    result += acc * (maxMin - result);
    if (isBelow) {
      if (result > l) { firstTrendBar = true; isBelow = false; result = Math.max(h, maxMin); maxMin = l; acc = start; }
    } else if (result < h) { firstTrendBar = true; isBelow = true; result = Math.min(l, maxMin); maxMin = h; acc = start; }
    if (!firstTrendBar) {
      if (isBelow) { if (h > maxMin) { maxMin = h; acc = Math.min(acc + inc, max); } }
      else if (l < maxMin) { maxMin = l; acc = Math.min(acc + inc, max); }
    }
    if (isBelow) {
      result = Math.min(result, bars[i - 1].l);
      if (i > 1) result = Math.min(result, bars[i - 2].l);
    } else {
      result = Math.max(result, bars[i - 1].h);
      if (i > 1) result = Math.max(result, bars[i - 2].h);
    }
    out[i] = result;
  }
  return out;
}

/** Pine ta.supertrend trên `src` (hl2) với `atrArr` đã tính: [đường, hướng], hướng −1 = xu hướng tăng (đường nằm dưới giá). */
export function supertrend(bars: Bar[], src: Num, atrArr: Num, factor: number): [Num, Num] {
  const n = bars.length;
  const line = nan(n);
  const dir = nan(n);
  let prevUpper = 0;
  let prevLower = 0;
  let prevLine = NaN;
  for (let i = 0; i < n; i++) {
    let upper = src[i] + factor * atrArr[i];
    let lower = src[i] - factor * atrArr[i];
    const prevClose = i > 0 ? bars[i - 1].c : NaN;
    lower = lower > prevLower || prevClose < prevLower ? lower : prevLower;
    upper = upper < prevUpper || prevClose > prevUpper ? upper : prevUpper;
    let d: number;
    if (i === 0 || isNa(atrArr[i - 1])) d = 1;
    else if (prevLine === prevUpper) d = bars[i].c > upper ? -1 : 1;
    else d = bars[i].c < lower ? 1 : -1;
    const st = d === -1 ? lower : upper;
    // warm-up (ATR chưa có): Pine giữ trạng thái 0 nội bộ nhưng không có đường để vẽ
    line[i] = isNa(atrArr[i]) ? NaN : st;
    dir[i] = isNa(atrArr[i]) ? NaN : d;
    prevLine = st;
    prevUpper = isNa(upper) ? 0 : upper;
    prevLower = isNa(lower) ? 0 : lower;
  }
  return [line, dir];
}
