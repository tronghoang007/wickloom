import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/api";
import type { Shape } from "./shapes";
import { computeProfile, fibPrice, posConstrain, positionStats, SPEC, type Ctx } from "./tools";
import type { Anchor } from "./types";

const T = 1_000_000;
const pos = (entry: number, target: number, stop: number): Anchor[] => [
  { time: T, price: entry },
  { time: T, price: target },
  { time: T + 3600 * 20, price: entry },
  { time: T, price: stop },
];
const prices = (p: Anchor[]) => [p[0].price, p[1].price, p[3].price];

describe("posConstrain (lỗi #3)", () => {
  const tick = 0.01;

  it("Long: kéo target xuống dưới entry thì kẹp ở entry + 1 tick, vẫn là Long", () => {
    const p = pos(100, 110, 95);
    p[1].price = 90;
    posConstrain(1)(p, 1, tick);
    expect(p[1].price).toBeCloseTo(100.01, 9);
  });

  it("Long: kéo stop lên trên entry thì kẹp ở entry − 1 tick", () => {
    const p = pos(100, 110, 95);
    p[3].price = 120;
    posConstrain(1)(p, 3, tick);
    expect(p[3].price).toBeCloseTo(99.99, 9);
  });

  it("Short: ngược lại", () => {
    const p = pos(100, 90, 105);
    p[1].price = 130;
    posConstrain(-1)(p, 1, tick);
    expect(p[1].price).toBeCloseTo(99.99, 9);
    p[3].price = 50;
    posConstrain(-1)(p, 3, tick);
    expect(p[3].price).toBeCloseTo(100.01, 9);
  });

  it("kéo entry: kẹp giữa stop và target, mép phải theo giá entry", () => {
    const p = pos(100, 110, 95);
    p[0] = { time: T + 3600, price: 200 };
    posConstrain(1)(p, 0, tick);
    expect(p[0].price).toBeCloseTo(109.99, 9);
    expect(p[2].price).toBe(p[0].price);
    expect(p[1].time).toBe(T + 3600);
    expect(p[3].time).toBe(T + 3600);
  });

  it("kéo đúng phía thì không đổi", () => {
    const p = pos(100, 110, 95);
    p[1].price = 130;
    posConstrain(1)(p, 1, tick);
    expect(prices(p)).toEqual([100, 130, 95]);
  });

  it("không có tick (đang gõ giá trong Settings) thì không kẹp", () => {
    const p = pos(100, 110, 95);
    p[1].price = 9;
    posConstrain(1)(p, 1);
    expect(p[1].price).toBe(9);
  });
});

describe("positionStats", () => {
  const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ t: T + i * 3600, o, h, l, c, v: 1 });
  const opts = { account: 1000, lot: 1, risk: 2 };

  it("Long chạm target", () => {
    const s = positionStats([bar(0, 100, 100, 100, 100), bar(1, 100, 104, 99, 103), bar(2, 103, 111, 102, 110)], pos(100, 110, 95), true, opts);
    expect(s).toMatchObject({ closed: true, exitPrice: 110, exitT: T + 7200, riskAmt: 20, qty: 4 });
    expect(s.pnl).toBe(40);
  });

  it("cùng 1 nến chạm cả stop lẫn target thì tính stop", () => {
    const s = positionStats([bar(1, 100, 111, 94, 100)], pos(100, 110, 95), true, opts);
    expect(s).toMatchObject({ closed: true, exitPrice: 95 });
    expect(s.pnl).toBe(-20);
  });

  it("chưa chạm thì Open P&L theo giá đóng cửa nến cuối trong khối", () => {
    const s = positionStats([bar(1, 100, 102, 99, 101), bar(2, 101, 103, 100, 102.5)], pos(100, 110, 95), true, opts);
    expect(s.closed).toBe(false);
    expect(s.exitPrice).toBe(102.5);
    expect(s.pnl).toBe(10);
  });

  it("Short: lời khi giá giảm", () => {
    const s = positionStats([bar(1, 100, 101, 89, 90)], pos(100, 90, 105), false, opts);
    expect(s).toMatchObject({ closed: true, exitPrice: 90 });
    expect(s.pnl).toBe(40);
  });

  it("nến ngoài khối (sau mép phải) không tính", () => {
    const s = positionStats([bar(25, 100, 200, 100, 150)], pos(100, 110, 95), true, opts);
    expect(s.closed).toBe(false);
    expect(s.exitT).toBeNull();
  });
});

describe("computeProfile", () => {
  const b = (l: number, h: number, v: number, up = true): Bar => ({ t: 0, o: up ? l : h, h, l, c: up ? h : l, v });

  it("không có nến hoặc không có volume thì null", () => {
    expect(computeProfile([], 1, 10, 70)).toBeNull();
    expect(computeProfile([b(0, 10, 0)], 1, 10, 70)).toBeNull();
  });

  it("chia volume theo phần giá nến chồng lên mỗi row, tổng volume giữ nguyên", () => {
    const vp = computeProfile([b(0, 10, 100), b(4, 6, 50, false)], 1, 10, 70)!;
    expect(vp.N).toBe(10);
    expect(vp.size).toBe(1);
    expect(vp.total.reduce((s, v) => s + v, 0)).toBeCloseTo(150, 9);
    expect(vp.up[0]).toBeCloseTo(10, 9);
    expect(vp.dn[4]).toBeCloseTo(25, 9);
  });

  it("POC là row volume lớn nhất, Value Area chứa POC và không vượt quá % yêu cầu", () => {
    const vp = computeProfile([b(0, 10, 100), b(4, 6, 50, false)], 1, 10, 70)!;
    expect([4, 5]).toContain(vp.poc);
    expect(vp.vl).toBeLessThanOrEqual(vp.poc);
    expect(vp.vh).toBeGreaterThanOrEqual(vp.poc);
    const inVa = vp.total.slice(vp.vl, vp.vh + 1).reduce((s, v) => s + v, 0);
    expect(inVa).toBeLessThanOrEqual(150 * 0.7 + 1e-9);
  });
});

// Ctx giả với trục giá log: y = 1000 - 100·ln(price)
describe("mức theo giá trên trục log (lỗi #6)", () => {
  const Y = (price: number) => 1000 - 100 * Math.log(price);
  const ctxFor = (type: string, points: Anchor[]): Ctx => ({
    d: { id: "x", type, points, color: "#fff", width: 1, locked: false, hidden: false },
    p: points.map((a) => ({ x: a.time, y: Y(a.price) })),
    w: 1000, h: 1000, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2,
  });
  const horizontalYs = (shapes: Shape[]) =>
    shapes.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line" && s.a.y === s.b.y).map((s) => s.a.y);

  it("Fib retracement: đường mức 0.5 nằm đúng giá ghi trên nhãn", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 400 }];
    const shapes = SPEC.fib.build(ctxFor("fib", pts));
    const half = fibPrice(100, 400, 0.5); // 250
    expect(horizontalYs(shapes)).toContainEqual(Y(half));
    const pixelMid = (Y(100) + Y(400)) / 2; // cách cũ: ~ giá 200, nhãn vẫn ghi 250
    expect(horizontalYs(shapes).some((y) => Math.abs(y - pixelMid) < 1e-6)).toBe(false);
    const label = shapes.find((s) => s.k === "text" && s.text.startsWith("0.5 "));
    expect(label && label.k === "text" && label.text).toBe("0.5 (250.00)");
  });

  it("Gann box: đường ngang theo giá", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 400 }];
    const ys = horizontalYs(SPEC.gannbox.build(ctxFor("gannbox", pts)));
    expect(ys).toContainEqual(Y(100 + 300 * 0.5));
  });

  it("Gann fan: tia 1x2 đi qua giá giữa tại thời điểm điểm 2", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 400 }];
    const shapes = SPEC.gannfan.build(ctxFor("gannfan", pts));
    const ends = shapes.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line").map((s) => s.b);
    expect(ends).toContainEqual({ x: 300, y: Y(250) });
  });
});
