import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { atr, change, ema, highest, hma, lowest, nan, rma, rsi, sma, source, stdev, trueRange, vwma, wma, type Num } from "./index";

// Chuỗi giả lập có xu hướng + nhiễu (xác định, không random)
const wave = (n: number): Num => Array.from({ length: n }, (_, i) => 100 + i * 0.3 + Math.sin(i / 3) * 4 + Math.cos(i * 1.7) * 1.5);
const bars = (n: number): Bar[] =>
  wave(n).map((c, i) => ({ t: 1000 + i * 60, o: c - 0.4, h: c + 1.2 + (i % 3) * 0.2, l: c - 1.1 - (i % 4) * 0.1, c, v: 100 + ((i * 37) % 50) }));

const close = (a: Num, b: Num, eps = 1e-9) => {
  expect(a).toHaveLength(b.length);
  a.forEach((x, i) => {
    if (Number.isNaN(b[i])) expect(x, `index ${i}`).toBeNaN();
    else expect(x, `index ${i}`).toBeCloseTo(b[i], -Math.log10(eps));
  });
};

// Bản tham chiếu ngây thơ O(n·w): kiểm tra bản O(n)
const naive = (a: Num, n: number, fn: (w: Num) => number): Num =>
  a.map((_, i) => {
    if (i < n - 1) return NaN;
    const w = a.slice(i - n + 1, i + 1);
    return w.some(Number.isNaN) ? NaN : fn(w);
  });

describe("sma / wma / stdev / highest / lowest khớp bản ngây thơ", () => {
  const a = wave(200);
  for (const n of [1, 2, 5, 20, 50]) {
    it(`n=${n}`, () => {
      close(sma(a, n), naive(a, n, (w) => w.reduce((s, x) => s + x, 0) / n));
      close(wma(a, n), naive(a, n, (w) => w.reduce((s, x, i) => s + x * (i + 1), 0) / ((n * (n + 1)) / 2)));
      close(stdev(a, n), naive(a, n, (w) => { const m = w.reduce((s, x) => s + x, 0) / n; return Math.sqrt(w.reduce((s, x) => s + (x - m) ** 2, 0) / n); }));
      close(highest(a, n), naive(a, n, (w) => Math.max(...w)));
      close(lowest(a, n), naive(a, n, (w) => Math.min(...w)));
    });
  }

  it("na trong cửa sổ -> na, hồi phục sau khi na ra khỏi cửa sổ", () => {
    const b = wave(30);
    b[10] = NaN;
    b[11] = NaN;
    for (const f of [sma, wma, stdev]) {
      const out = f(b, 4);
      for (let i = 10; i <= 14; i++) expect(out[i], `${f.name} ${i}`).toBeNaN();
      expect(out[15]).not.toBeNaN();
    }
    close(sma(b, 4), naive(b, 4, (w) => w.reduce((s, x) => s + x, 0) / 4));
    close(wma(b, 4), naive(b, 4, (w) => w.reduce((s, x, i) => s + x * (i + 1), 0) / 10));
  });

  it("highest / lowest bỏ qua na, cửa sổ lớn không vỡ", () => {
    expect(highest([1, NaN, 3, 2], 3)).toEqual([NaN, NaN, 3, 3]);
    expect(lowest([5, NaN, 3, 4], 3)).toEqual([NaN, NaN, 3, 3]);
    const big = Array.from({ length: 300000 }, (_, i) => i);
    expect(highest(big, 200000)[299999]).toBe(299999);
  });

  it("dữ liệu ngắn hơn cửa sổ -> toàn na", () => {
    expect(sma([1, 2], 5)).toEqual(nan(2));
    expect(wma([1, 2], 5)).toEqual(nan(2));
    expect(rma([1, 2], 5)).toEqual(nan(2));
  });
});

describe("ema / rma theo Pine", () => {
  it("ema bắt đầu từ giá trị đầu tiên, alpha = 2/(n+1)", () => {
    const out = ema([10, 20, 30], 3);
    expect(out[0]).toBe(10);
    expect(out[1]).toBeCloseTo(0.5 * 20 + 0.5 * 10);
    expect(out[2]).toBeCloseTo(0.5 * 30 + 0.5 * 15);
  });

  it("ema: na làm đứt chuỗi rồi seed lại", () => {
    const out = ema([10, NaN, 30, 50], 3);
    expect(out[0]).toBe(10);
    expect(out[1]).toBeNaN();
    expect(out[2]).toBe(30);
    expect(out[3]).toBeCloseTo(40);
  });

  it("rma seed bằng SMA(n) rồi alpha = 1/n", () => {
    const out = rma([1, 2, 3, 4, 5, 6], 3);
    expect(out.slice(0, 2)).toEqual([NaN, NaN]);
    expect(out[2]).toBeCloseTo(2);
    expect(out[3]).toBeCloseTo((4 + 2 * 2) / 3);
    expect(out[4]).toBeCloseTo((5 + 2 * out[3]) / 3);
  });

  it("rma: seed lại sau na (cần đủ n giá trị liên tiếp)", () => {
    const out = rma([1, 2, 3, NaN, 5, 6, 7, 8], 3);
    expect(out[3]).toBeNaN();
    expect(out[4]).toBeNaN();
    expect(out[5]).toBeNaN();
    expect(out[6]).toBeCloseTo(6);
    expect(out[7]).toBeCloseTo((8 + 2 * 6) / 3);
  });
});

describe("vwma / hma", () => {
  it("vwma = sma(giá·vol)/sma(vol)", () => {
    const p = [10, 11, 12, 13], v = [1, 2, 3, 4];
    const out = vwma(p, v, 2);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeCloseTo((10 * 1 + 11 * 2) / 3);
    expect(out[3]).toBeCloseTo((12 * 3 + 13 * 4) / 7);
  });

  it("hma = wma(2·wma(n/2) − wma(n), round(√n))", () => {
    const a = wave(120);
    for (const n of [9, 16, 21]) {
      const half = wma(a, Math.floor(n / 2)), full = wma(a, n);
      close(hma(a, n), wma(half.map((x, i) => 2 * x - full[i]), Math.round(Math.sqrt(n))));
    }
  });
});

describe("tr / atr / rsi / change", () => {
  it("trueRange: bar đầu = high − low, sau đó gồm cả gap so với close trước", () => {
    const b: Bar[] = [
      { t: 0, o: 10, h: 12, l: 9, c: 11, v: 1 },
      { t: 1, o: 15, h: 16, l: 14, c: 15, v: 1 }, // gap lên: |16 − 11| = 5
      { t: 2, o: 15, h: 15.5, l: 14.5, c: 15, v: 1 },
    ];
    expect(trueRange(b)).toEqual([3, 5, 1]);
  });

  it("atr = rma(tr)", () => {
    const b = bars(60);
    close(atr(b, 14), rma(trueRange(b), 14));
  });

  it("rsi: chuỗi chỉ tăng = 100, chỉ giảm = 0, đi ngang = 100", () => {
    const up = rsi(Array.from({ length: 30 }, (_, i) => 100 + i), 14);
    expect(up[13]).toBeNaN();
    expect(up[14]).toBe(100);
    expect(rsi(Array.from({ length: 30 }, (_, i) => 100 - i), 14)[29]).toBe(0);
    expect(rsi(new Array(30).fill(5), 14)[29]).toBe(100);
  });

  it("rsi khớp công thức Wilder tính tay", () => {
    const p = [44, 44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.1, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
    // 14 thay đổi đầu: lãi TB / lỗ TB (SMA) rồi làm mịn Wilder
    const ch = p.slice(1).map((x, i) => x - p[i]);
    let g = ch.slice(0, 14).reduce((s, x) => s + Math.max(x, 0), 0) / 14;
    let l = ch.slice(0, 14).reduce((s, x) => s + Math.max(-x, 0), 0) / 14;
    const out = rsi(p, 14);
    expect(out[14]).toBeCloseTo(100 - 100 / (1 + g / l), 9);
    g = (g * 13 + Math.max(ch[14], 0)) / 14;
    l = (l * 13 + Math.max(-ch[14], 0)) / 14;
    expect(out[15]).toBeCloseTo(100 - 100 / (1 + g / l), 9);
  });

  it("change", () => {
    expect(change([1, 4, 2])).toEqual([NaN, 3, -2]);
  });
});

describe("source", () => {
  const b: Bar[] = [{ t: 0, o: 1, h: 4, l: 0, c: 3, v: 1 }];
  it("các nguồn giá", () => {
    expect(source(b, "close")).toEqual([3]);
    expect(source(b, "hl2")).toEqual([2]);
    expect(source(b, "hlc3")).toEqual([7 / 3]);
    expect(source(b, "ohlc4")).toEqual([2]);
    expect(source(b, "hlcc4")).toEqual([2.5]);
  });
});
