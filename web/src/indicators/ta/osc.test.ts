import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { MA_TYPES, atr, cci, cum, dev, dmi, ema, fixnan, hma, ma, mfi, mom, obv, rma, roc, sar, sma, stoch, sum, supertrend, trueRange, vwma, williamsR, wma, type Num } from "./index";

const wave = (n: number): Num => Array.from({ length: n }, (_, i) => 100 + i * 0.3 + Math.sin(i / 3) * 4 + Math.cos(i * 1.7) * 1.5);
const bars = (n: number): Bar[] =>
  wave(n).map((c, i) => ({ t: 1000 + i * 60, o: c - 0.4, h: c + 1.2 + (i % 3) * 0.2, l: c - 1.1 - (i % 4) * 0.1, c, v: 100 + ((i * 37) % 50) }));

const same = (a: Num, b: Num, digits = 9) => {
  expect(a).toHaveLength(b.length);
  a.forEach((x, i) => {
    if (Number.isNaN(b[i])) expect(x, `index ${i}`).toBeNaN();
    else expect(x, `index ${i}`).toBeCloseTo(b[i], digits);
  });
};

describe("ma(type)", () => {
  const a = wave(80), v = a.map((_, i) => 10 + (i % 7));
  it("chọn đúng hàm theo loại; loại lạ = SMA", () => {
    same(ma("SMA", a, 10, v), sma(a, 10));
    same(ma("EMA", a, 10, v), ema(a, 10));
    same(ma("SMMA (RMA)", a, 10, v), rma(a, 10));
    same(ma("WMA", a, 10, v), wma(a, 10));
    same(ma("VWMA", a, 10, v), vwma(a, v, 10));
    same(ma("???", a, 10, v), sma(a, 10));
  });
  it("danh sách loại khớp TV", () => {
    expect([...MA_TYPES]).toEqual(["SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA"]);
  });
  it("hma khớp định nghĩa (đã test ở ta.test)", () => {
    expect(hma(a, 9)).toHaveLength(a.length);
  });
});

describe("fixnan / sum / cum / dev / stoch", () => {
  it("fixnan: na lấy giá trị trước, na đầu giữ nguyên", () => {
    expect(fixnan([NaN, NaN, 1, NaN, 3, NaN])).toEqual([NaN, NaN, 1, 1, 3, 3]);
  });
  it("sum = tổng n phần tử gần nhất", () => {
    expect(sum([1, 2, 3, 4], 2)).toEqual([NaN, 3, 5, 7]);
  });
  it("cum: tổng cộng dồn, na chỉ bỏ trống đúng nến đó", () => {
    expect(cum([1, 2, NaN, 3])).toEqual([1, 3, NaN, 6]);
  });
  it("dev = trung bình |x − sma| trong cửa sổ", () => {
    const a = wave(60);
    const out = dev(a, 7);
    for (let i = 6; i < a.length; i++) {
      const w = a.slice(i - 6, i + 1);
      const m = w.reduce((s, x) => s + x, 0) / 7;
      expect(out[i]).toBeCloseTo(w.reduce((s, x) => s + Math.abs(x - m), 0) / 7, 9);
    }
    expect(out[5]).toBeNaN();
  });
  it("stoch: 0..100, đóng ở đỉnh = 100, khoảng bằng 0 = na", () => {
    const b = bars(50);
    const out = stoch(b.map((x) => x.c), b.map((x) => x.h), b.map((x) => x.l), 14);
    out.slice(13).forEach((x) => { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); });
    expect(stoch([5, 5], [5, 5], [5, 5], 2)[1]).toBeNaN();
    expect(stoch([1, 2, 3], [1, 2, 3], [0, 0, 0], 3)[2]).toBe(100);
  });
});

describe("cci / mom / roc / williamsR", () => {
  it("cci = (x − sma)/(0.015·dev); dev = 0 thì na", () => {
    const a = wave(60);
    const out = cci(a, 20);
    const m = sma(a, 20), d = dev(a, 20);
    expect(out[40]).toBeCloseTo((a[40] - m[40]) / (0.015 * d[40]), 9);
    expect(cci(new Array(30).fill(7), 20)[29]).toBeNaN();
  });
  it("mom = x − x[n], roc = % đổi so với x[n]", () => {
    expect(mom([1, 2, 4, 7], 2)).toEqual([NaN, NaN, 3, 5]);
    expect(roc([100, 110, 99], 1)).toEqual([NaN, 10, -10]);
  });
  it("williamsR: 0 ở đỉnh n nến, −100 ở đáy, trong [−100, 0]", () => {
    expect(williamsR([5], [5], [5], 1)[0]).toBeNaN(); // high = low: không chia cho 0
    expect(williamsR([1, 2, 3], [1, 2, 3], [0, 0, 0], 3)[2]).toBe(0);
    expect(williamsR([3, 2, 0], [3, 3, 3], [0, 0, 0], 3)[2]).toBe(-100);
    const b = bars(60);
    williamsR(b.map((x) => x.c), b.map((x) => x.h), b.map((x) => x.l), 14).slice(13).forEach((x) => {
      expect(x).toBeLessThanOrEqual(0);
      expect(x).toBeGreaterThanOrEqual(-100);
    });
  });
});

describe("mfi / obv", () => {
  it("mfi khớp định nghĩa tính tay trên cửa sổ", () => {
    const b = bars(60);
    const src = b.map((x) => (x.h + x.l + x.c) / 3), vol = b.map((x) => x.v);
    const out = mfi(src, vol, 14);
    for (const i of [20, 35, 59]) {
      let up = 0, dn = 0;
      for (let j = i - 13; j <= i; j++) {
        const ch = src[j] - src[j - 1];
        if (ch > 0) up += vol[j] * src[j];
        else if (ch < 0) dn += vol[j] * src[j];
      }
      expect(out[i]).toBeCloseTo(100 - 100 / (1 + up / dn), 9);
    }
  });
  it("mfi: chỉ tăng = 100, đi ngang theo công thức Pine = 0..100", () => {
    const src = Array.from({ length: 30 }, (_, i) => 10 + i), vol = new Array(30).fill(5);
    expect(mfi(src, vol, 14)[29]).toBe(100);
  });
  it("obv cộng/trừ volume theo chiều đóng cửa, đi ngang giữ nguyên", () => {
    const mk = (c: number, v: number): Bar => ({ t: 0, o: c, h: c, l: c, c, v });
    expect(obv([mk(10, 5), mk(11, 7), mk(11, 9), mk(10, 4), mk(12, 3)])).toEqual([NaN, 7, 7, 3, 6]);
  });
});

describe("dmi / adx", () => {
  // h = i+2, l = i, c = i+1: tr = 2, +DM = 1, −DM = 0 mỗi nến
  const rising: Bar[] = Array.from({ length: 80 }, (_, i) => ({ t: i, o: i + 1, h: i + 2, l: i, c: i + 1, v: 1 }));

  it("xu hướng tăng đều: +DI = 50, −DI = 0, ADX = 100", () => {
    const [plus, minus, adx] = dmi(rising, 14, 14);
    expect(plus[60]).toBeCloseTo(50, 9);
    expect(minus[60]).toBeCloseTo(0, 9);
    expect(adx[60]).toBeCloseTo(100, 9);
  });
  it("xu hướng giảm đều: đảo vai trò", () => {
    const falling = rising.map((b, i) => ({ ...b, h: 200 - i, l: 198 - i, c: 199 - i, o: 199 - i }));
    const [plus, minus, adx] = dmi(falling, 14, 14);
    expect(plus[60]).toBeCloseTo(0, 9);
    expect(minus[60]).toBeCloseTo(50, 9);
    expect(adx[60]).toBeCloseTo(100, 9);
  });
  it("dữ liệu thật: DI và ADX nằm trong [0, 100]; nến đầu na; ADX trễ hơn DI", () => {
    const [plus, minus, adx] = dmi(bars(200), 14, 14);
    [plus, minus, adx].forEach((s) => s.forEach((x) => { if (!Number.isNaN(x)) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(100); } }));
    expect(plus[0]).toBeNaN();
    expect(plus.findIndex((x) => !Number.isNaN(x))).toBeLessThan(adx.findIndex((x) => !Number.isNaN(x)));
  });
});

describe("sar", () => {
  // l = i, h = i+1, c = i+0.5: tăng đều, SAR nằm dưới giá
  const up: Bar[] = Array.from({ length: 8 }, (_, i) => ({ t: i, o: i, h: i + 1, l: i, c: i + 0.5, v: 1 }));

  it("tính tay vài nến đầu của xu hướng tăng (gia tốc 0.02, 0.04, 0.06…)", () => {
    const s = sar(up, 0.02, 0.02, 0.2);
    expect(s[0]).toBeNaN();
    expect(s[1]).toBeCloseTo(0, 9); // bị kẹp bởi low nến đầu
    expect(s[2]).toBeCloseTo(0, 9); // bị kẹp bởi low[2 nến trước]
    expect(s[3]).toBeCloseTo(0.12, 9); // 0 + 0.04·(3 − 0)
    expect(s[4]).toBeCloseTo(0.12 + 0.06 * (4 - 0.12), 9);
  });
  it("giá rơi xuyên SAR thì đảo sang trên giá, bắt đầu từ cực trị", () => {
    const flip: Bar[] = [...up, { t: 8, o: 8, h: 8, l: 1, c: 2, v: 1 }];
    const s = sar(flip, 0.02, 0.02, 0.2);
    expect(s[8]).toBeGreaterThanOrEqual(flip[8].h); // đã nằm trên giá
    expect(s[8]).toBeCloseTo(8, 9); // max(high, cực trị trước đó) = 8
  });
  it("gia tốc không vượt max; SAR luôn dưới low trong xu hướng tăng dài", () => {
    const long: Bar[] = Array.from({ length: 200 }, (_, i) => ({ t: i, o: i, h: i + 1, l: i, c: i + 0.5, v: 1 }));
    const s = sar(long, 0.02, 0.02, 0.2);
    for (let i = 2; i < 200; i++) expect(s[i]).toBeLessThanOrEqual(long[i].l);
  });
});

describe("supertrend", () => {
  const b = bars(300);
  const hl2 = b.map((x) => (x.h + x.l) / 2);
  const atr10 = atr(b, 10);
  const [line, dir] = supertrend(b, hl2, atr10, 3);

  it("warm-up (chưa có ATR): không có đường", () => {
    for (let i = 0; i < 9; i++) { expect(line[i]).toBeNaN(); expect(dir[i]).toBeNaN(); }
    expect(line[9]).not.toBeNaN();
  });
  it("xu hướng tăng (−1): đường dưới giá đóng cửa; giảm (1): trên giá", () => {
    for (let i = 10; i < b.length; i++) {
      if (dir[i] === -1) expect(line[i]).toBeLessThanOrEqual(b[i].c);
      else expect(line[i]).toBeGreaterThanOrEqual(b[i].c);
    }
  });
  it("trong một xu hướng đường chỉ đi cùng chiều (tăng: không giảm, giảm: không tăng)", () => {
    for (let i = 11; i < b.length; i++) {
      if (dir[i] !== dir[i - 1]) continue;
      if (dir[i] === -1) expect(line[i]).toBeGreaterThanOrEqual(line[i - 1] - 1e-9);
      else expect(line[i]).toBeLessThanOrEqual(line[i - 1] + 1e-9);
    }
  });
  it("giá tăng vọt rồi đi ngang -> hướng chuyển sang tăng và giữ", () => {
    const rise: Bar[] = Array.from({ length: 80 }, (_, i) => {
      const c = i < 40 ? 100 : 100 + (i - 40) * 3;
      return { t: i, o: c, h: c + 1, l: c - 1, c, v: 1 };
    });
    const [, d] = supertrend(rise, rise.map((x) => (x.h + x.l) / 2), atr(rise, 10), 3);
    expect(d[79]).toBe(-1);
  });
  it("trueRange(handleNa = false): nến đầu na", () => {
    expect(trueRange(b, false)[0]).toBeNaN();
    expect(trueRange(b, true)[0]).toBe(b[0].h - b[0].l);
  });
});
