import type { Bar } from "@/lib/api";

// NaN đại diện cho na của Pine
export type Num = number[];

export const nan = (n: number): Num => new Array<number>(n).fill(NaN);
export const isNa = (x: number | undefined): boolean => x === undefined || Number.isNaN(x);

export const SOURCES = ["open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4"] as const;
export type SourceName = (typeof SOURCES)[number];

export function source(bars: Bar[], src: string): Num {
  return bars.map((b) => {
    switch (src) {
      case "open": return b.o;
      case "high": return b.h;
      case "low": return b.l;
      case "hl2": return (b.h + b.l) / 2;
      case "hlc3": return (b.h + b.l + b.c) / 3;
      case "ohlc4": return (b.o + b.h + b.l + b.c) / 4;
      case "hlcc4": return (b.h + b.l + 2 * b.c) / 4;
      default: return b.c;
    }
  });
}

export const sub = (a: Num, b: Num): Num => a.map((x, i) => x - b[i]);
