import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/api";
import type { Shape } from "./shapes";
import { computeProfile, encodeFibLevels, fibLevelsOf, fibPrice, posConstrain, positionStats, SPEC, type Ctx } from "./tools";
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

  it("kéo entry: target và stop dịch theo (như TV), mép phải theo giá entry", () => {
    const prev = pos(100, 110, 95);
    const p = prev.map((q) => ({ ...q }));
    p[0] = { time: T + 3600, price: 200 };
    posConstrain(1)(p, 0, tick, prev);
    expect(prices(p)).toEqual([200, 210, 195]);
    expect(p[2].price).toBe(200);
    expect(p[1].time).toBe(T + 3600);
    expect(p[3].time).toBe(T + 3600);
  });

  it("làm tròn giá theo tick khi kéo trên chart", () => {
    const prev = pos(100, 110, 95);
    const p = prev.map((q) => ({ ...q }));
    p[1].price = 112.34567;
    posConstrain(1)(p, 1, 0.001, prev);
    expect(p[1].price).toBe(112.346);
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
  it("như TV: Qty làm tròn xuống, Amount = tài khoản ± rủi ro × R, P&L theo giá", () => {
    // TV XAUUSD: rủi ro 250 / stop 14.172 = 17.64 → Qty 17; R:R 2 → Amount 1500 / 750
    const p = pos(4130, 4130 + 28.344, 4130 - 14.172);
    const s = positionStats([], p, true, { account: 1000, lot: 1, risk: 25 });
    expect(s.qty).toBe(17);
    expect(s.rr).toBeCloseTo(2, 9);
    expect(s.tpAmount).toBeCloseTo(1500, 9);
    expect(s.slAmount).toBe(750);
  });

  const bar = (i: number, o: number, h: number, l: number, c: number): Bar => ({ t: T + i * 3600, o, h, l, c, v: 1 });
  const opts = { account: 1000, lot: 1, risk: 2 };

  it("Long chạm target", () => {
    const s = positionStats([bar(0, 100, 100, 100, 100), bar(1, 100, 104, 99, 103), bar(2, 103, 111, 102, 110)], pos(100, 110, 95), true, opts);
    expect(s).toMatchObject({ closed: true, exitPrice: 110, exitT: T + 7200, riskAmt: 20, qty: 4, pnlPts: 10 });
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

describe("Position tạo bằng 1 click (kích thước như TV)", () => {
  it("stop/target = 20% biên độ nến đang thấy, rộng 1/7 số nến, làm tròn tick", () => {
    const v = { span: 73, hiLo: 71.092, visibleBars: 193, tick: 0.001, addBars: (t: number, n: number) => t + n * 900 };
    const [e, t, r, s] = SPEC.longpos.oneClick!({ time: T, price: 4130.0004 }, v);
    expect(e.price).toBe(4130);
    expect(t.price).toBeCloseTo(4130 + 14.218, 9);
    expect(s.price).toBeCloseTo(4130 - 14.218, 9);
    expect((r.time - T) / 900).toBe(28);
    const [, ts, , ss] = SPEC.shortpos.oneClick!({ time: T, price: 4130 }, v);
    expect(ts.price).toBeLessThan(4130);
    expect(ss.price).toBeGreaterThan(4130);
  });
});

describe("Rectangle 8 handle (như TV)", () => {
  const A = { time: 100, price: 10 }, B = { time: 200, price: 20 };
  const move = SPEC.rect.moveHandle!;
  it("góc phụ đổi 1 thời gian + 1 giá của 2 điểm neo", () => {
    expect(move([A, B], 2, { time: 90, price: 25 })).toEqual([{ time: 90, price: 10 }, { time: 200, price: 25 }]);
    expect(move([A, B], 3, { time: 210, price: 5 })).toEqual([{ time: 100, price: 5 }, { time: 210, price: 20 }]);
  });
  it("giữa cạnh chỉ đổi 1 chiều", () => {
    expect(move([A, B], 4, { time: 50, price: 99 })).toEqual([{ time: 50, price: 10 }, B]);
    expect(move([A, B], 7, { time: 50, price: 30 })).toEqual([A, { time: 200, price: 30 }]);
  });
  it("8 handle: 4 góc + 4 giữa cạnh", () => {
    const c = { p: [{ x: 0, y: 0 }, { x: 100, y: 50 }] } as unknown as Ctx;
    expect(SPEC.rect.handles!(c)).toEqual([
      { x: 0, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }, { x: 100, y: 0 },
      { x: 0, y: 25 }, { x: 100, y: 25 }, { x: 50, y: 0 }, { x: 50, y: 50 },
    ]);
  });
});

describe("tùy chọn từng tool (mục 6)", () => {
  const Y = (price: number) => 1000 - price;
  const mk = (type: string, points: Anchor[], opts?: Record<string, string | number | boolean>): Ctx => ({
    d: { id: "x", type, points, color: "#2962ff", width: 1, locked: false, hidden: false, opts },
    p: points.map((a) => ({ x: a.time, y: Y(a.price) })),
    w: 1000, h: 1000, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2,
  });
  const lines = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line");
  const texts = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text");

  it("mức Fib mã hóa / đọc lại được, mặc định 8 mức bật", () => {
    expect(fibLevelsOf({ type: "fib" } as never).filter((l) => l.on).map((l) => l.coeff)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618]);
    const lv = [{ coeff: 0, color: "#ff9800", on: true }, { coeff: 0.705, color: "#2962ff", on: false }];
    expect(fibLevelsOf({ type: "fib", opts: { levels: encodeFibLevels(lv) } } as never)).toEqual(lv);
  });

  it("Fib: chỉ vẽ mức bật; Reverse đảo đầu; tắt Prices thì nhãn chỉ còn hệ số; nhãn phải", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 200 }];
    const levels = encodeFibLevels([{ coeff: 0, color: "#fff", on: true }, { coeff: 0.25, color: "#fff", on: true }, { coeff: 1, color: "#fff", on: false }]);
    const base = SPEC.fib.build(mk("fib", pts, { levels }));
    expect(texts(base).map((t) => t.text)).toEqual(["0 (200.00)", "0.25 (175.00)"]);
    const rev = SPEC.fib.build(mk("fib", pts, { levels, reverse: true, showPrices: false, labels: "right" }));
    expect(texts(rev).map((t) => t.text)).toEqual(["0", "0.25"]);
    expect(lines(rev).map((l) => l.a.y)).toContain(Y(100)); // mức 0 giờ ở điểm 1
    expect(texts(rev)[0].at.x).toBe(304);
  });

  it("Fib Extend right: đường mức chạy tới mép phải", () => {
    const sh = SPEC.fib.build(mk("fib", [{ time: 100, price: 100 }, { time: 300, price: 200 }], { extend: "right" }));
    expect(lines(sh)[0].b.x).toBe(1000);
  });

  it("Trend line: Extend left theo màn hình (đầu có x nhỏ), default của Ray/Extended", () => {
    const pts = [{ time: 300, price: 100 }, { time: 100, price: 200 }]; // vẽ từ phải sang trái
    const l = lines(SPEC.trendline.build(mk("trendline", pts, { extend: "left" })))[0];
    expect(l.a.x).toBe(100);
    expect(l.ext).toBe("left");
    expect(lines(SPEC.ray.build(mk("ray", pts)))[0].ext).toBe("right");
    expect(lines(SPEC.extended.build(mk("extended", pts)))[0].ext).toBe("both");
  });

  it("Trend line: Price labels, Middle point, Stats (Info line bật sẵn)", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 110 }];
    expect(texts(SPEC.trendline.build(mk("trendline", pts)))).toEqual([]);
    expect(texts(SPEC.trendline.build(mk("trendline", pts, { priceLabels: true }))).map((t) => t.text)).toEqual(["100.00", "110.00"]);
    // Info line: mọi mục Stats bật như TV (giá, %, pip / số nến, thời gian / góc)
    expect(texts(SPEC.infoline.build(mk("infoline", pts)))[0].text).toBe("10.00 (10.00%) 1,000 pips\n200 bars, 3m\n2.86°");
    expect(SPEC.trendline.build(mk("trendline", pts, { middlePoint: true })).some((s) => s.k === "poly")).toBe(true);
  });

  it("Horizontal line/ray: Price label luôn hiện trên trục, tắt được", () => {
    const pts = [{ time: 100, price: 150 }];
    const ax = SPEC.hray.build(mk("hray", pts)).find((s) => s.k === "axis");
    expect(ax).toMatchObject({ text: "150.00", always: true, bg: "#2962ff" });
    expect(SPEC.hline.build(mk("hline", pts, { showPrice: false })).some((s) => s.k === "axis")).toBe(false);
  });

  it("Rectangle: Extend, Middle line, tắt Background", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 200 }];
    const sh = SPEC.rect.build(mk("rect", pts, { extend: "both", middleLine: true, background: false }));
    const polys = sh.filter((s): s is Extract<Shape, { k: "poly" }> => s.k === "poly");
    expect(polys).toHaveLength(1); // chỉ còn viền
    expect(polys[0].pts.map((p) => p.x)).toEqual([0, 1000, 1000, 0]);
    expect(polys[0].fill).toBeUndefined();
    expect(lines(sh)[0].a.y).toBe(Y(150));
    const filled = SPEC.rect.build(mk("rect", pts, { backgroundColor: "#ff0000" }));
    expect(filled[0]).toMatchObject({ k: "poly", fill: 0.15, noStroke: true, color: "#ff0000" });
  });
});

describe("tab Text, Stats, đầu mũi tên, rủi ro theo tiền", () => {
  const Y = (price: number) => 1000 - price;
  const mk = (type: string, points: Anchor[], opts?: Record<string, string | number | boolean>, text?: string): Ctx => ({
    d: { id: "x", type, points, color: "#2962ff", width: 1, locked: false, hidden: false, opts, text },
    p: points.map((a) => ({ x: a.time, y: Y(a.price) })),
    w: 1000, h: 1000, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2,
  });
  const texts = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text");

  it("chữ của trend line chạy dọc đường, mặc định phía trên, giữa, cỡ 14", () => {
    const sh = SPEC.trendline.build(mk("trendline", [{ time: 100, price: 100 }, { time: 300, price: 300 }], undefined, "Breakout"));
    const t = texts(sh)[0];
    expect(t).toMatchObject({ text: "Breakout", size: 14, align: "center" });
    expect(t.angle).toBeCloseTo(-Math.PI / 4, 9);
    // phía trên đường: lệch về phía y nhỏ hơn so với trung điểm (200, 800)
    expect(t.at.y).toBeLessThan(800);
    expect(t.at.x).toBeLessThan(200);
  });

  it("chữ đậm/nghiêng/cỡ và căn trái theo đầu trái màn hình", () => {
    const sh = SPEC.trendline.build(mk("trendline", [{ time: 300, price: 100 }, { time: 100, price: 100 }], { bold: true, italic: true, fontSize: 20, hAlign: "left", vAlign: "middle" }, "x"));
    expect(texts(sh)[0]).toMatchObject({ bold: true, italic: true, size: 20, align: "left", at: { x: 100, y: Y(100) } });
  });

  it("Horizontal ray: chữ mặc định phía dưới đường (TV: Bottom / Center)", () => {
    const t = texts(SPEC.hray.build(mk("hray", [{ time: 100, price: 100 }], undefined, "R1")))[0];
    expect(t.at.y).toBeGreaterThan(Y(100));
  });

  it("Rectangle: chữ trong hộp theo căn lề", () => {
    const t = texts(SPEC.rect.build(mk("rect", [{ time: 100, price: 100 }, { time: 300, price: 200 }], { vAlign: "top", hAlign: "right" }, "Zone")))[0];
    expect(t.align).toBe("right");
    expect(t.at.x).toBe(294);
    expect(t.at.y).toBeLessThan(Y(150));
  });

  it("Arrow: mũi tên ở đầu phải (default), bật thêm đầu trái", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 100 }];
    const heads = (sh: Shape[]) => sh.filter((s) => s.k === "poly" && s.fill === 1);
    expect(heads(SPEC.arrow.build(mk("arrow", pts)))).toHaveLength(1);
    expect(heads(SPEC.arrow.build(mk("arrow", pts, { leftEnd: "arrow" })))).toHaveLength(2);
    expect(heads(SPEC.trendline.build(mk("trendline", pts)))).toHaveLength(0);
  });

  it("Stats của trend line: tắt sẵn; bật vài mục thì chỉ hiện khi chọn, trừ khi Always show stats", () => {
    const pts = [{ time: 100, price: 100 }, { time: 300, price: 110 }];
    expect(texts(SPEC.trendline.build(mk("trendline", pts)))).toHaveLength(0);
    const opts = { showBars: true, showAngle: true };
    expect(texts(SPEC.trendline.build(mk("trendline", pts, opts)))).toHaveLength(0);
    const sel = { ...mk("trendline", pts, opts), selected: true };
    expect(texts(SPEC.trendline.build(sel))[0].text).toBe("200 bars\n2.86°");
    expect(texts(SPEC.trendline.build(mk("trendline", pts, { ...opts, alwaysShowStats: true })))).toHaveLength(1);
  });

  it("Position: rủi ro theo số tiền", () => {
    const p = pos(100, 110, 95);
    expect(positionStats([], p, true, { account: 1000, lot: 1, risk: 50, riskMode: "money" }).riskAmt).toBe(50);
    expect(positionStats([], p, true, { account: 1000, lot: 1, risk: 5 }).riskAmt).toBe(50);
  });
});
