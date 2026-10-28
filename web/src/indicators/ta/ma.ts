import { isNa, nan, type Num } from "./core";

// Quy ước như Pine ta.*: cửa sổ chứa na thì kết quả na; bar chưa đủ `n` giá trị thì na.

/** Tổng trượt: O(n). */
export function sma(a: Num, n: number): Num {
  const out = nan(a.length);
  let sum = 0;
  let bad = 0; // số na trong cửa sổ
  for (let i = 0; i < a.length; i++) {
    if (isNa(a[i])) bad++;
    else sum += a[i];
    if (i >= n) {
      if (isNa(a[i - n])) bad--;
      else sum -= a[i - n];
    }
    if (i >= n - 1 && bad === 0) out[i] = sum / n;
  }
  return out;
}

/** Trọng số 1..n (mới nhất nặng nhất): O(n) nhờ w' = w − s + n·x. */
export function wma(a: Num, n: number): Num {
  const out = nan(a.length);
  const den = (n * (n + 1)) / 2;
  let s = 0; // tổng cửa sổ (na tính là 0)
  let w = 0; // tổng x·trọng số
  let bad = 0;
  for (let i = 0; i < a.length; i++) {
    const x = isNa(a[i]) ? 0 : a[i];
    if (isNa(a[i])) bad++;
    if (i < n) {
      w += (i + 1) * x;
      s += x;
    } else {
      const old = isNa(a[i - n]) ? 0 : a[i - n];
      if (isNa(a[i - n])) bad--;
      w = w - s + n * x;
      s = s - old + x;
    }
    if (i >= n - 1 && bad === 0) out[i] = w / den;
  }
  return out;
}

/** Pine ta.ema: bắt đầu từ chính giá trị đầu tiên (không seed bằng SMA), na làm chuỗi đứt rồi seed lại. */
export function ema(a: Num, n: number): Num {
  const out = nan(a.length);
  const alpha = 2 / (n + 1);
  let prev = NaN;
  for (let i = 0; i < a.length; i++) {
    if (isNa(a[i])) { prev = NaN; continue; }
    prev = isNa(prev) ? a[i] : alpha * a[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

/** Pine ta.rma (Wilder): seed bằng SMA(n) đầu tiên rồi alpha = 1/n. Dùng cho RSI, ATR, ADX. */
export function rma(a: Num, n: number): Num {
  const out = nan(a.length);
  const seed = sma(a, n);
  const alpha = 1 / n;
  let prev = NaN;
  for (let i = 0; i < a.length; i++) {
    if (isNa(a[i])) { prev = NaN; continue; }
    prev = isNa(prev) ? seed[i] : alpha * a[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export function vwma(a: Num, vol: Num, n: number): Num {
  const pv = sma(a.map((x, i) => x * vol[i]), n);
  const v = sma(vol, n);
  return pv.map((x, i) => x / v[i]);
}

/** Hull MA như script "Hull Moving Average" của TV: WMA(2·WMA(n/2) − WMA(n), floor(√n)). */
export function hma(a: Num, n: number): Num {
  const half = wma(a, Math.max(1, Math.floor(n / 2)));
  const full = wma(a, n);
  return wma(half.map((x, i) => 2 * x - full[i]), Math.max(1, Math.floor(Math.sqrt(n))));
}

/** Các loại MA chọn được trong Settings (tên như TV). */
export const MA_TYPES = ["SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"] as const;
export type MaType = (typeof MA_TYPES)[number];

/** MA theo loại; VWMA cần volume. Loại lạ thì SMA. */
export function ma(type: string, a: Num, n: number, vol: Num): Num {
  switch (type) {
    case "EMA": return ema(a, n);
    case "SMMA (RMA)": return rma(a, n);
    case "WMA": return wma(a, n);
    case "VWMA": return vwma(a, vol, n);
    default: return sma(a, n);
  }
}
