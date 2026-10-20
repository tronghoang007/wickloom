import type { Bar } from "@/lib/api";

// NaN đại diện cho na
export type Num = number[];

const nan = (n: number): Num => new Array(n).fill(NaN);

export function source(bars: Bar[], src: string): Num {
  return bars.map((b) => {
    switch (src) {
      case "open": return b.o;
      case "high": return b.h;
      case "low": return b.l;
      case "hl2": return (b.h + b.l) / 2;
      case "hlc3": return (b.h + b.l + b.c) / 3;
      case "ohlc4": return (b.o + b.h + b.l + b.c) / 4;
      default: return b.c;
    }
  });
}

const firstValid = (a: Num) => a.findIndex((x) => !Number.isNaN(x));

function windowed(a: Num, n: number, fn: (w: Num) => number): Num {
  const out = nan(a.length);
  for (let i = n - 1; i < a.length; i++) {
    const w = a.slice(i - n + 1, i + 1);
    if (w.some(Number.isNaN)) continue;
    out[i] = fn(w);
  }
  return out;
}

export const sma = (a: Num, n: number) => windowed(a, n, (w) => w.reduce((s, x) => s + x, 0) / n);

export const wma = (a: Num, n: number) => {
  const den = (n * (n + 1)) / 2;
  return windowed(a, n, (w) => w.reduce((s, x, i) => s + x * (i + 1), 0) / den);
};

export const stdev = (a: Num, n: number) =>
  windowed(a, n, (w) => {
    const m = w.reduce((s, x) => s + x, 0) / n;
    return Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / n);
  });

export const highest = (a: Num, n: number) => windowed(a, n, (w) => Math.max(...w));
export const lowest = (a: Num, n: number) => windowed(a, n, (w) => Math.min(...w));

function recursive(a: Num, n: number, alpha: number): Num {
  const out = nan(a.length);
  const s = firstValid(a);
  if (s < 0 || s + n > a.length) return out;
  let prev = 0;
  for (let i = s; i < s + n; i++) prev += a[i];
  prev /= n;
  out[s + n - 1] = prev;
  for (let i = s + n; i < a.length; i++) {
    prev = Number.isNaN(a[i]) ? prev : alpha * a[i] + (1 - alpha) * prev;
    out[i] = prev;
  }
  return out;
}

export const ema = (a: Num, n: number) => recursive(a, n, 2 / (n + 1));
export const rma = (a: Num, n: number) => recursive(a, n, 1 / n);

export function trueRange(bars: Bar[]): Num {
  return bars.map((b, i) =>
    i === 0 ? b.h - b.l : Math.max(b.h - b.l, Math.abs(b.h - bars[i - 1].c), Math.abs(b.l - bars[i - 1].c)),
  );
}

export const atr = (bars: Bar[], n: number) => rma(trueRange(bars), n);

export function rsi(a: Num, n: number): Num {
  const up = nan(a.length), dn = nan(a.length);
  for (let i = 1; i < a.length; i++) {
    const d = a[i] - a[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const u = rma(up, n), d = rma(dn, n);
  return u.map((x, i) => (Number.isNaN(x) ? NaN : d[i] === 0 ? 100 : 100 - 100 / (1 + x / d[i])));
}

export const sub = (a: Num, b: Num) => a.map((x, i) => x - b[i]);
