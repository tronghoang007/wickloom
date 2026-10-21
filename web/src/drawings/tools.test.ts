import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/api";
import { textBox, type Shape } from "./shapes";
import { computeProfile, encodeFibLevels, fibLevelsOf, fibPrice, fmtVol, gannGrid, posConstrain, positionStats, profileSource, regression, SPEC, tableCellAt, tableCells, volumeIn, type Ctx } from "./tools";
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

  it("giá chưa chạm entry: lệnh chưa mở, không đóng dù vượt target, PnL theo close nến cuối (TV)", () => {
    // Short entry 100 nhưng giá chỉ chạy dưới, dù đã thấp hơn target
    const s = positionStats([bar(0, 85, 86, 84, 85), bar(1, 85, 86, 80, 81), bar(2, 81, 83, 79, 82)], pos(100, 90, 105), false, opts);
    expect(s).toMatchObject({ closed: false, entryT: null, exitPrice: 82, pnlPts: 18 });
  });

  it("leverage giới hạn Qty; Amount / PL theo Qty chưa làm tròn (TV: leverage 1 → Qty 0, PnL 1.932)", () => {
    const p = pos(4140, 4148, 4132);
    const s = positionStats([], p, true, { account: 1000, lot: 1, risk: 250, riskMode: "money", leverage: 1 });
    expect(s.qty).toBe(0);
    expect(s.tpPL).toBeCloseTo(1.932, 3);
    expect(s.tpAmount).toBeCloseTo(1001.93, 2);
    expect(s.slAmount).toBeCloseTo(998.07, 2);
    expect(positionStats([], p, true, { account: 1000, lot: 1, risk: 250, riskMode: "money", leverage: 50 }).qty).toBe(12);
  });

  it("QTY precision: số lẻ làm tròn xuống", () => {
    const p = pos(4140, 4148, 4132);
    const o = { account: 1000, lot: 1, risk: 250, riskMode: "money", leverage: 1 };
    expect(positionStats([], p, true, { ...o, qtyPrecision: "2" }).qty).toBe(0.24);
    expect(positionStats([], p, true, { ...o, qtyPrecision: "0" }).qty).toBe(0);
  });

  it("lệnh mở ở nến chạm entry, rồi mới xét target/stop", () => {
    const s = positionStats(
      [bar(0, 85, 86, 84, 85), bar(1, 85, 92, 84, 91), bar(2, 91, 101, 93, 98), bar(3, 98, 99, 89, 89.5)],
      pos(100, 90, 105), false, opts,
    );
    expect(s).toMatchObject({ closed: true, entryT: T + 7200, exitT: T + 3 * 3600, exitPrice: 90 });
  });

  it("gap qua entry (so với giá đóng cửa nến trước) cũng tính là khớp", () => {
    const s = positionStats([bar(0, 98, 99, 97, 99), bar(1, 102, 104, 101, 103)], pos(100, 110, 95), true, opts);
    expect(s).toMatchObject({ entryT: T + 3600, exitPrice: 103 });
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

describe("computeProfile theo help của TV", () => {
  const bar = (l: number, h: number, v: number, o = l, c = h): Bar => ({ t: 0, o, h, l, c, v });

  it("Number of rows: ví dụ của TV (100 tick, 30 row) làm tròn xuống 3 tick/row => 34 row, row cuối chỉ 1 tick", () => {
    const vp = computeProfile([bar(0, 100, 1000)], 1, 30, 70)!;
    expect(vp.size).toBe(3);
    expect(vp.N).toBe(34);
  });

  it("Number of rows: chọn làm tròn lên khi tổng row gần số yêu cầu hơn", () => {
    // 100 tick, 24 row: 4.17 => 4 tick (25 row) gần 24 hơn 5 tick (20 row)
    const vp = computeProfile([bar(0, 100, 1000)], 1, 24, 70)!;
    expect(vp.size).toBe(4);
    expect(vp.N).toBe(25);
  });

  it("Ticks per row: Row Size là số tick mỗi row, số row tự tính", () => {
    const vp = computeProfile([bar(200, 300, 1000)], 0.01, 25, 70, "ticks")!;
    expect(vp.size).toBeCloseTo(0.25, 9);
    expect(vp.N).toBe(400);
  });

  it("Ticks per row quá nhỏ thì gộp lại để không quá 1000 row", () => {
    const vp = computeProfile([bar(0, 100, 1000)], 0.001, 1, 70, "ticks")!;
    expect(vp.N).toBeLessThanOrEqual(1000);
  });

  it("nến đóng > mở là up volume; đóng = mở (doji) và đóng < mở là down", () => {
    const vp = computeProfile([bar(0, 1, 10, 0, 1), bar(0, 1, 20, 1, 0), bar(0, 1, 40, 0.5, 0.5)], 1, 2, 70)!;
    expect(vp.up[0]).toBeCloseTo(10, 9);
    expect(vp.dn[0]).toBeCloseTo(60, 9);
  });
});

describe("profileSource: ghép nến khung nhỏ với nến chart", () => {
  const mk = (t: number, v = 1): Bar => ({ t, o: 1, h: 2, l: 1, c: 2, v });
  // nến chart 900s: 0, 900, 1800, 2700 (2700 là nến đang chạy); khung nhỏ 300s
  const chart = [mk(0), mk(900), mk(1800), mk(2700)];
  const base = (fine: Bar[]): Ctx =>
    ({ bars: chart, step: 900, profileBars: fine, profileStep: 300 }) as unknown as Ctx;
  const ts = (bs: Bar[]) => bs.map((b) => b.t);

  it("chưa có dữ liệu khung nhỏ thì dùng nến chart trong khoảng [from, to)", () => {
    expect(ts(profileSource({ ...base([]), profileStep: undefined } as Ctx, 900, 2700))).toEqual([900, 1800]);
  });

  it("nến đã đóng lấy từ khung nhỏ, nến đang chạy lấy từ chart", () => {
    const fine = [0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000].map((t) => mk(t));
    expect(ts(profileSource(base(fine), 0, 3600))).toEqual([0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700]);
    // 2700 ở đây là nến chart (đang chạy), không phải nến khung nhỏ 2700 và 3000
    expect(profileSource(base(fine), 0, 3600).filter((b) => b.t === 2700)).toHaveLength(1);
  });

  it("khung nhỏ chỉ phủ một phần: đầu và đuôi bù bằng nến chart", () => {
    const fine = [900, 1200, 1500].map((t) => mk(t));
    expect(ts(profileSource(base(fine), 0, 3600))).toEqual([0, 900, 1200, 1500, 1800, 2700]);
  });
});

describe("volume profile vẽ dạng thanh", () => {
  // 20 nến phủ giá 0..100, trục giá y = 500 - 4·price => mỗi row 10 giá = 40px
  const bars: Bar[] = Array.from({ length: 20 }, (_, i) => ({ t: i, o: 5 * i, h: 5 * i + 10, l: 5 * i, c: 5 * i + 10, v: 100 }));
  const ctx = (type: string, rows: number, k = 4): Ctx => ({
    d: { id: "x", type, points: [{ time: 0, price: 0 }, { time: 19, price: 100 }], color: "#2962ff", width: 1, locked: false, hidden: false, opts: { rows } },
    p: [{ x: 0, y: 500 }, { x: 190, y: 100 }],
    w: 400, h: 500, bars, tickSize: 1, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t * 10, Y: (price) => 500 - k * price, fp: (v) => v.toFixed(2), digits: 0,
  });
  // khoảng y [trên, dưới] của từng thanh nền (poly kín có fill), xếp từ trên xuống
  const bands = (shapes: Shape[]) =>
    shapes
      .filter((s): s is Extract<Shape, { k: "poly" }> => s.k === "poly" && !!s.fill)
      .map((s) => [Math.min(...s.pts.map((q) => q.y)), Math.max(...s.pts.map((q) => q.y))])
      .sort((a, b) => a[0] - b[0]);

  it("các row cách nhau 1px, không dính thành 1 khối", () => {
    const rows = bands(SPEC.frvp.build(ctx("frvp", 10)));
    expect(rows.length).toBeGreaterThanOrEqual(10);
    for (let i = 1; i < rows.length; i++) expect(rows[i][0] - rows[i - 1][1]).toBeCloseTo(1, 9);
  });

  it("đang vẽ / kéo chỉ có vạch dọc ở 2 mép khoảng, không có thanh", () => {
    const shapes = SPEC.frvp.build({ ...ctx("frvp", 10), dragging: true });
    expect(shapes).toHaveLength(2);
    for (const s of shapes) {
      expect(s.k).toBe("line");
      if (s.k === "line") {
        expect(s.a.x).toBe(s.b.x);
        expect([s.a.y, s.b.y]).toEqual([0, 500]);
      }
    }
    expect(shapes.map((s) => (s.k === "line" ? s.a.x : -1))).toEqual([0, 190]);
  });

  it("Anchored VP khi kéo chỉ có 1 vạch ở điểm neo", () => {
    expect(SPEC.avp.build({ ...ctx("avp", 10), dragging: true })).toHaveLength(1);
  });

  describe("Volume = Delta", () => {
    // row 0 có up 100 / down 0, row 1 có up 20 / down 60, row 2 có up 50 / down 50 (delta 0)
    const dbars: Bar[] = [
      { t: 0, o: 0, h: 10, l: 0, c: 10, v: 100 },
      { t: 1, o: 20, h: 20, l: 10, c: 10, v: 60 },
      { t: 2, o: 10, h: 20, l: 10, c: 20, v: 20 },
      { t: 3, o: 20, h: 30, l: 20, c: 30, v: 50 },
      { t: 4, o: 30, h: 30, l: 20, c: 20, v: 50 },
    ];
    const run = (volume: string, extra = {}) => {
      const c = ctx("frvp", 3);
      return SPEC.frvp.build({ ...c, bars: dbars, d: { ...c.d, opts: { rows: 3, volume, ...extra } } });
    };
    const rects = (shapes: Shape[]) =>
      shapes.filter((s): s is Extract<Shape, { k: "poly" }> => s.k === "poly" && !!s.fill)
        .map((s) => ({ w: Math.max(...s.pts.map((q) => q.x)) - Math.min(...s.pts.map((q) => q.x)), color: s.color }))
        .sort((a, b) => a.w - b.w);

    it("thanh dài theo |up − down|, row lệch nhất dài hết cỡ, delta 0 thì không có thanh", () => {
      const r = rects(run("delta"));
      expect(r).toHaveLength(2); // row delta 0 bị bỏ
      expect(r[1].w).toBeGreaterThan(r[0].w);
    });

    it("màu theo dấu: delta dương dùng màu Up, âm dùng màu Down", () => {
      const colors = new Set(rects(run("delta", { up: "#111111", down: "#222222", vaUp: "#111111", vaDown: "#222222" })).map((x) => x.color));
      expect(colors).toEqual(new Set(["#111111", "#222222"]));
    });

    it("nhãn Values hiện delta có dấu", () => {
      const labels = run("delta", { values: true }).filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text").map((s) => s.text);
      expect(labels).toContain("100");
      expect(labels.some((t) => t.startsWith("-"))).toBe(true);
    });
  });

  it("row thấp hơn 3px thì để liền, không chừa khe", () => {
    const rows = bands(SPEC.frvp.build(ctx("frvp", 50, 0.5))); // 50 row trong 50px => 1px/row
    for (let i = 1; i < rows.length; i++) expect(rows[i][0] - rows[i - 1][1]).toBeCloseTo(0, 9);
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

  it("Fib levels based on log scale: chỉ khi trục log (TV: 4110→4170, 0.5 = 4139.891)", () => {
    const pts = [{ time: 100, price: 4110 }, { time: 300, price: 4170 }];
    const label = (c: Ctx) => SPEC.fib.build(c).find((s) => s.k === "text" && s.text.startsWith("0.5 "));
    const text = (c: Ctx) => { const l = label(c); return l && l.k === "text" ? l.text : ""; };
    const withOpt = (log: boolean, on: boolean) => {
      const c = ctxFor("fib", pts);
      return { ...c, log, d: { ...c.d, opts: { logLevels: on } }, fp: (v: number) => v.toFixed(3) };
    };
    expect(text(withOpt(true, true))).toBe("0.5 (4139.891)");
    expect(text(withOpt(false, true))).toBe("0.5 (4140.000)");
    expect(text(withOpt(true, false))).toBe("0.5 (4140.000)");
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
    expect(t.price).toBe(4144.218); // đúng tick, không còn 4144.2179999…
    expect(s.price).toBe(4115.782);
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

  it("mức Fib mã hóa / đọc lại được, mặc định 11 mức bật như TV", () => {
    expect(fibLevelsOf({ type: "fib" } as never).filter((l) => l.on).map((l) => l.coeff)).toEqual([0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618, 3.618, 4.236]);
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
    // Info line: mọi mục Stats bật, định dạng như TV ("30.000 (0.73%), 3,000.0" / "16 bars (4h), distance: 421 px" / góc)
    expect(texts(SPEC.infoline.build(mk("infoline", pts)))[0].text).toBe("10.00 (10.00%), 1,000.0\n200 bars (3m), distance: 200 px\n2.86°");
    const down = [{ time: 100, price: 110 }, { time: 300, price: 100 }];
    expect(texts(SPEC.infoline.build(mk("infoline", down, { showBars: false, showDistance: false, showAngle: false })))[0].text).toBe("\u221210.00 (\u22129.09%), \u22121,000.0\n3m");
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

describe("Gann Square / Square Fixed (đo trên TV)", () => {
  const segs = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line");

  it("lưới 5×5 từ điểm 1, mức 0…5 đúng màu, fan 2×1 / 1×1 / 1×2 tới mép hộp", () => {
    const sh = gannGrid({ x: 0, y: 0 }, 10, -10, false);
    const lines = segs(sh);
    expect(lines.filter((l) => l.a.x === l.b.x).map((l) => l.a.x)).toEqual([0, 10, 20, 30, 40, 50]);
    expect(lines.find((l) => l.a.x === 10 && l.b.x === 10)?.color).toBe("#ff9800");
    const fans = lines.filter((l) => l.a.x === 0 && l.a.y === 0 && l.b.x !== 0 && l.b.y !== 0);
    expect(fans.map((l) => l.b)).toEqual([{ x: 50, y: -25 }, { x: 50, y: -50 }, { x: 25, y: -50 }]);
  });

  it("11 cung tâm điểm 1, bán kính theo điểm lưới (1,0) … (5,1); có nền thì tô giữa các cung", () => {
    const arcs = gannGrid({ x: 0, y: 0 }, 10, -10, false).filter((s): s is Extract<Shape, { k: "poly" }> => s.k === "poly");
    expect(arcs).toHaveLength(11);
    expect(arcs[0].pts[0].x).toBe(10);
    expect(arcs[0].pts[0].y).toBeCloseTo(0, 9);
    expect(Math.hypot(arcs[1].pts[0].x, arcs[1].pts[0].y)).toBeCloseTo(10 * Math.SQRT2, 9);
    const withBg = gannGrid({ x: 0, y: 0 }, 10, -10, true).filter((s) => s.k === "poly" && s.fill === 0.2);
    expect(withBg).toHaveLength(11);
  });

  const mk = (type: string, points: Anchor[], opts?: Record<string, number | string | boolean>): Ctx => ({
    d: { id: "x", type, points, color: "#fff", width: 1, locked: false, hidden: false, opts },
    // 1 nến = 900s = 6 px; 1 đơn vị giá = 6 px (y ngược)
    p: points.map((a) => ({ x: a.time / 150, y: 1000 - a.price * 6 })),
    w: 2000, h: 2000, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 900,
    barsBetween: (t0, t1) => Math.round((t1 - t0) / 900),
    X: (t) => t / 150, Y: (price) => 1000 - price * 6, fp: (v) => v.toFixed(3), digits: 3,
  });

  it("Gann Square Fixed: 1 ô = khoảng cách pixel giữa 2 điểm", () => {
    const pts = [{ time: 0, price: 100 }, { time: 900 * 30, price: 110 }]; // 180px ngang, 60px dọc
    const lines = segs(SPEC.gannsqfixed.build(mk("gannsqfixed", pts)));
    const u = Math.hypot(180, 60);
    expect(lines.filter((l) => l.a.x === l.b.x)[1].a.x).toBeCloseTo(u, 9);
  });

  it("Gann Square: lúc tạo chốt tỉ lệ giá/nến để vuông trên màn hình; nhãn giá / tỉ lệ / số nến", () => {
    const pts = [{ time: 0, price: 100 }, { time: 900 * 30, price: 110 }];
    const d = SPEC.gannsquare.init!(mk("gannsquare", pts).d, mk("gannsquare", pts));
    expect(d.opts?.scaleRatio).toBeCloseTo(1, 9); // 6px/nến ÷ 6px/giá
    expect(d.points[1].price).toBeCloseTo(130, 9); // 30 nến × 1
    const c = { ...mk("gannsquare", d.points, d.opts as Record<string, number>) };
    const texts = SPEC.gannsquare.build(c).filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text").map((t) => t.text);
    expect(texts).toEqual(["30.000", "1", "30"]);
    // zoom/đổi khung: tỉ lệ đã chốt, kéo điểm 2 sang 10 nến thì giá góc = 100 + 10
    const moved = mk("gannsquare", [d.points[0], { time: 9000, price: 999 }], d.opts as Record<string, number>);
    expect(SPEC.gannsquare.handles!(moved)[1].y).toBeCloseTo(1000 - 110 * 6, 9);
  });
});

describe("Gann Box / Gann Fan / Pitchfork (đo trên TV)", () => {
  const Y = (price: number) => 1000 - price;
  const mk = (type: string, points: Anchor[], opts?: Record<string, boolean>): Ctx => ({
    d: { id: "x", type, points, color: "#f23645", width: 1, locked: false, hidden: false, opts },
    p: points.map((a) => ({ x: a.time, y: Y(a.price) })),
    w: 1000, h: 1000, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2,
  });
  const lines = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line");
  const texts = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text");

  it("Gann Box: 7 mức theo giá và theo thời gian, màu từng mức, nhãn 4 cạnh, không có chéo", () => {
    const sh = SPEC.gannbox.build(mk("gannbox", [{ time: 100, price: 100 }, { time: 300, price: 200 }]));
    const ls = lines(sh);
    expect(ls).toHaveLength(14);
    expect(ls.every((l) => l.a.x === l.b.x || l.a.y === l.b.y)).toBe(true);
    expect(ls.find((l) => l.a.y === Y(125) && l.b.y === Y(125))?.color).toBe("#ff9800"); // 0.25 theo giá
    expect(ls.find((l) => l.a.x === 150 && l.b.x === 150)?.color).toBe("#ff9800"); // 0.25 theo thời gian
    expect(texts(sh).filter((t) => t.text === "0.382")).toHaveLength(4);
    expect(SPEC.gannbox.handles!(mk("gannbox", [{ time: 100, price: 100 }, { time: 300, price: 200 }]))).toHaveLength(4);
  });

  it("Gann Fan: tia 1/1 qua điểm 2, nhãn kiểu TV, tia dốc nhãn ở mức giá điểm 2", () => {
    const sh = SPEC.gannfan.build(mk("gannfan", [{ time: 100, price: 100 }, { time: 300, price: 200 }]));
    expect(texts(sh).map((t) => t.text)).toEqual(["1/8", "1/4", "1/3", "1/2", "1/1", "2/1", "3/1", "4/1", "8/1"]);
    const one = lines(sh).find((l) => l.color === "#00bcd4")!;
    expect(one.b).toEqual({ x: 300, y: Y(200) });
    const half = texts(sh).find((t) => t.text === "1/2")!;
    expect(half.at.x).toBeCloseTo(100 + 200 / 2 + 4, 9);
    expect(half.at.y).toBeCloseTo(Y(200), 9);
  });

  const P = [{ time: 0, price: 0 }, { time: 100, price: 100 }, { time: 200, price: 40 }];
  const median = (type: string) => lines(SPEC[type].build(mk(type, P))).find((l) => l.ext === "right" && !l.color)!;

  it("Pitchfork: median từ p0 qua trung điểm p1–p2; mức 0.5 và 1 (2 nhánh) bật sẵn", () => {
    const sh = SPEC.pitchfork.build(mk("pitchfork", P));
    expect(median("pitchfork").a).toEqual({ x: 0, y: Y(0) });
    expect(lines(sh).filter((l) => l.color === "#2962ff").map((l) => l.a)).toEqual([{ x: 100, y: Y(100) }, { x: 200, y: Y(40) }]);
    expect(lines(sh).filter((l) => l.color === "#089981")).toHaveLength(2);
  });

  it("Schiff / Modified Schiff: gốc median dời theo TV", () => {
    expect(median("schiff").a).toEqual({ x: 0, y: Y(50) });
    expect(median("mschiff").a).toEqual({ x: 50, y: Y(50) });
  });

  it("Inside: median bắt đầu ở trung điểm p1–p2, song song gốc (trung điểm p0–p1) → p2", () => {
    const m = median("insidefork");
    expect(m.a).toEqual({ x: 150, y: Y(70) });
    const dir = { x: m.b.x - m.a.x, y: m.b.y - m.a.y };
    const want = { x: 200 - 50, y: Y(40) - Y(50) };
    expect(dir.y / dir.x).toBeCloseTo(want.y / want.x, 9);
  });
});

describe("kênh và các tool Fib (đo trên TV)", () => {
  const Y = (price: number) => 1000 - price;
  const mk = (type: string, points: Anchor[], bars: Bar[] = []): Ctx => ({
    d: { id: "x", type, points, color: "#2962ff", width: 1, locked: false, hidden: false },
    p: points.map((a) => ({ x: a.time, y: Y(a.price) })),
    w: 1000, h: 800, bars, tickSize: 0.01, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2,
  });
  const lines = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line");
  const polys = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "poly" }> => s.k === "poly");
  const texts = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text");

  it("Disjoint channel: đường 2 dốc ngược, kết thúc ở (x điểm 2, giá p3); handle 3 ở đó", () => {
    const pts = [{ time: 100, price: 130 }, { time: 300, price: 150 }, { time: 200, price: 122 }];
    const ls = lines(SPEC.disjoint.build(mk("disjoint", pts)));
    expect(ls[1].a).toEqual({ x: 100, y: Y(142) });
    expect(ls[1].b).toEqual({ x: 300, y: Y(122) });
    expect(SPEC.disjoint.handles!(mk("disjoint", pts))[2]).toEqual({ x: 300, y: Y(122) });
    expect(SPEC.disjoint.moveHandle!(pts, 2, { time: 999, price: 120 })[2]).toEqual({ time: 300, price: 120 });
  });

  it("Parallel channel: 2 cạnh + giữa nét đứt, nền 20%", () => {
    const sh = SPEC.channel.build(mk("channel", [{ time: 100, price: 100 }, { time: 300, price: 120 }, { time: 200, price: 90 }]));
    expect(lines(sh)).toHaveLength(3);
    expect(lines(sh)[2].dash).toBe(1);
    expect(polys(sh)[0].fill).toBe(0.2);
  });

  it("Regression: Pearson R, dải trên xanh / dưới đỏ", () => {
    const r = regression([1, 2, 3, 4, 5]);
    expect(r.slope).toBeCloseTo(1, 9);
    expect(r.pearson).toBeCloseTo(1, 9);
    const bars = [10, 12, 11, 14, 13, 15].map((c, i) => ({ t: 100 + i * 10, o: c, h: c, l: c, c, v: 1 }));
    const sh = SPEC.regression.build(mk("regression", [{ time: 100, price: 10 }, { time: 150, price: 15 }], bars));
    expect(polys(sh).map((p) => p.color)).toEqual(["#2962ff", "#f23645"]);
    expect(Number(texts(sh)[0].text)).toBeCloseTo(regression(bars.map((b) => b.c)).pearson, 9);
  });

  it("Fib channel: đoạn song song p1–p2, mức 1 đi qua p3, nhãn hệ số (giá) ở đầu trái", () => {
    const sh = SPEC.fibchannel.build(mk("fibchannel", [{ time: 100, price: 100 }, { time: 300, price: 120 }, { time: 200, price: 90 }]));
    const one = lines(sh).find((l) => l.color === "#787b86" && l.a.y !== Y(100))!;
    expect(one.a).toEqual({ x: 100, y: Y(80) }); // lệch −20 (p3 = 90, đường tại t=200 là 110)
    expect(one.ext ?? "none").toBe("none");
    expect(texts(sh).map((t) => t.text)).toContain("1 (80.00)");
  });

  it("Fib time zone: mốc 0,1,2,3,5,8… theo khoảng thời gian 2 điểm, 0 xám còn lại xanh", () => {
    const ls = lines(SPEC.fibtimezone.build(mk("fibtimezone", [{ time: 100, price: 100 }, { time: 110, price: 100 }]))).filter((l) => l.a.x === l.b.x);
    expect(ls.slice(0, 6).map((l) => l.a.x)).toEqual([100, 110, 120, 130, 150, 180]);
    expect(ls[0].color).toBe("#787b86");
    expect(ls[1].color).toBe("#2962ff");
  });

  it("Fib circles: elip tâm trung điểm, mức 1 nội tiếp hộp 2 điểm", () => {
    const sh = SPEC.fibcircles.build(mk("fibcircles", [{ time: 100, price: 100 }, { time: 180, price: 160 }]));
    const one = polys(sh).find((p) => p.color === "#787b86" && !p.noStroke)!;
    const xs = one.pts.map((q) => q.x), ys = one.pts.map((q) => q.y);
    expect(Math.min(...xs)).toBeCloseTo(100, 6);
    expect(Math.max(...xs)).toBeCloseTo(180, 6);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(60, 6);
  });

  it("Fib speed resistance arcs: tâm điểm 1, mức 1 qua điểm 2, nửa vòng phía điểm 2", () => {
    const sh = SPEC.fibarcs.build(mk("fibarcs", [{ time: 100, price: 100 }, { time: 160, price: 180 }]));
    const one = polys(sh).find((p) => p.color === "#787b86" && !p.noStroke)!;
    for (const q of one.pts) expect(Math.hypot(q.x - 100, q.y - Y(100))).toBeCloseTo(100, 6);
    expect(Math.max(...one.pts.map((q) => q.y))).toBeLessThanOrEqual(Y(100) + 1e-6);
  });

  it("Fib wedge: mức tới 1, có nền", () => {
    const sh = SPEC.fibwedge.build(mk("fibwedge", [{ time: 100, price: 100 }, { time: 200, price: 150 }, { time: 200, price: 100 }]));
    expect(texts(sh).map((t) => t.text)).toEqual(["0.236", "0.382", "0.5", "0.618", "0.786", "1"]);
    expect(polys(sh).filter((p) => p.noStroke)).toHaveLength(6);
  });

  it("Pitchfan: median từ p0 qua trung điểm p1–p2, tia mức 1 qua p1 và p2", () => {
    const sh = SPEC.pitchfan.build(mk("pitchfan", [{ time: 0, price: 0 }, { time: 100, price: 100 }, { time: 200, price: 40 }]));
    const ls = lines(sh);
    expect(ls.filter((l) => l.color === "#2962ff").map((l) => l.b)).toEqual([{ x: 100, y: Y(100) }, { x: 200, y: Y(40) }]);
    expect(ls.find((l) => !l.color && l.ext === "right")!.b).toEqual({ x: 150, y: Y(70) });
  });

  it("Fib speed resistance fan: tia tới mép phải theo giá và mép trên theo thời gian, mức tính từ điểm 2", () => {
    const sh = SPEC.fibfan.build(mk("fibfan", [{ time: 100, price: 100 }, { time: 300, price: 200 }]));
    const ends = lines(sh).filter((l) => l.ext === "right").map((l) => l.b);
    expect(ends).toContainEqual({ x: 300, y: Y(175) }); // giá: 0.25 từ điểm 2
    expect(ends).toContainEqual({ x: 250, y: Y(200) }); // thời gian: 0.25 từ điểm 2
    expect(ends).toContainEqual({ x: 300, y: Y(100) }); // 1 = ngang
    expect(ends).toContainEqual({ x: 100, y: Y(200) }); // 1 = dọc
  });
});

describe("patterns, Elliott, cycles (đo trên TV)", () => {
  const Y = (price: number) => 1000 - price;
  const mk = (type: string, prices: number[], step = 10): Ctx => {
    const points = prices.map((price, i) => ({ time: 100 + i * step, price }));
    return {
      d: { id: "x", type, points, color: "#2962ff", width: 1, locked: false, hidden: false },
      p: points.map((a) => ({ x: a.time, y: Y(a.price) })),
      w: 600, h: 800, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 1,
      barsBetween: (t0, t1) => t1 - t0,
      X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2,
    };
  };
  const texts = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text").map((t) => t.text);
  const lines = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "line" }> => s.k === "line");
  const polys = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "poly" }> => s.k === "poly");

  it("XABCD: tỉ lệ như TV (0.6, 0.556, 2.4, 1.067) + chữ X A B C D", () => {
    const t = texts(SPEC.xabcd.build(mk("xabcd", [4130, 4160, 4142, 4152, 4128])));
    expect(t).toEqual(["0.6", "0.556", "2.4", "1.067", "X", "A", "B", "C", "D"]);
  });

  it("Cypher: A–C = XC/XA, X–D = CD/XC (TV: 1.167, 0.857)", () => {
    const t = texts(SPEC.cypher.build(mk("cypher", [4130, 4160, 4142, 4165, 4135])));
    expect(t.slice(0, 4)).toEqual(["0.6", "1.167", "1.304", "0.857"]);
  });

  it("ABCD: 0.6 và 1.278; Three drives: 2.43 và 1.89, không có chữ", () => {
    expect(texts(SPEC.abcd.build(mk("abcd", [4130, 4160, 4142, 4165]))).slice(0, 2)).toEqual(["0.6", "1.278"]);
    expect(texts(SPEC.threedrives.build(mk("threedrives", [4130, 4145, 4138, 4155, 4146, 4163, 4140])))).toEqual(["2.43", "1.89"]);
  });

  it("Head and shoulders: 3 vùng tô, đường cổ qua 2 đáy, nhãn có nền", () => {
    const sh = SPEC.headshoulders.build(mk("headshoulders", [4130, 4150, 4138, 4165, 4137, 4150, 4128]));
    expect(polys(sh).filter((p) => p.fill === 0.15)).toHaveLength(3);
    const neck = lines(sh)[0];
    expect(neck.dash).toBe(2);
    expect(neck.a.x).toBeLessThan(120); // chạm cạnh trái (giữa điểm 0 và 1)
    expect(neck.b.x).toBeGreaterThan(150); // chạm cạnh phải (giữa điểm 5 và 6)
    expect(texts(sh)).toEqual(["Left Shoulder", "Head", "Right Shoulder"]);
  });

  it("Triangle pattern: AC và BD gặp nhau ở đỉnh, tô tam giác từ đường dọc tại A", () => {
    const sh = SPEC.trianglepattern.build(mk("trianglepattern", [4130, 4160, 4138, 4152]));
    const fill = polys(sh).find((p) => p.fill === 0.15)!;
    expect(fill.pts[0]).toEqual({ x: 100, y: Y(4130) });
    expect(fill.pts[1].x).toBeCloseTo(100, 9);
    expect(fill.pts[2].x).toBeGreaterThan(130);
  });

  it("Elliott: nhãn trong ngoặc, điểm đầu không có nhãn, không nền", () => {
    const sh = SPEC.elliottimpulse.build(mk("elliottimpulse", [4130, 4145, 4138, 4162, 4150, 4168]));
    expect(texts(sh)).toEqual(["(1)", "(2)", "(3)", "(4)", "(5)"]);
    expect(sh.some((s) => s.k === "text" && s.bg)).toBe(false);
  });

  it("Cyclic lines chỉ lặp về bên phải điểm 1", () => {
    const xs = lines(SPEC.cyclic.build(mk("cyclic", [4160, 4160], 50))).filter((l) => l.a.x === l.b.x).map((l) => l.a.x);
    expect(Math.min(...xs)).toBe(100);
    expect(xs.slice(0, 3)).toEqual([100, 150, 200]);
  });

  it("Sine: qua điểm 1 và điểm 2 (đáy/đỉnh), nửa chu kỳ = khoảng 2 điểm", () => {
    const sh = SPEC.sine.build(mk("sine", [100, 200], 30));
    const pts = polys(sh)[0].pts;
    const at = (x: number) => pts.find((q) => Math.abs(q.x - x) < 1e-9)!.y;
    expect(at(99)).toBeCloseTo(Y(100) + (Y(100) - Y(150)) * (Math.cos(Math.PI * -1 / 30) - 1), 6);
    expect(at(129)).toBeCloseTo(Y(150) + (Y(100) - Y(150)) * Math.cos((Math.PI * 29) / 30), 6);
  });

  it("Time cycles: nửa đường tròn thật, cao = nửa khoảng 2 điểm", () => {
    const sh = SPEC.timecycles.build(mk("timecycles", [4130, 4130], 40));
    const arc = polys(sh).find((p) => !p.noStroke)!;
    expect(Math.min(...arc.pts.map((q) => q.y))).toBeCloseTo(Y(4130) - 20, 6);
  });
});

describe("measurers và Arc (đo trên TV)", () => {
  const Y = (price: number) => 5000 - price;
  const bars: Bar[] = Array.from({ length: 30 }, (_, i) => ({ t: 1000 + i * 900, o: 1, h: 1, l: 1, c: 1, v: 9254 }));
  const mk = (type: string, points: Anchor[]): Ctx => ({
    d: { id: "x", type, points, color: "#2962ff", width: 1, locked: false, hidden: false },
    p: points.map((a) => ({ x: (a.time - 1000) / 10, y: Y(a.price) })),
    w: 2000, h: 2000, bars, tickSize: 0.001, hovered: false, selected: false, step: 900,
    barsBetween: (t0, t1) => Math.round((t1 - t0) / 900),
    X: (t) => (t - 1000) / 10, Y, fp: (v) => v.toFixed(3), digits: 3,
  });
  const texts = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text");
  // 20 nến, +25 giá từ 4135 (TV: "25.000 (0.60%) 2,500.0 / 20 bars, 5h / Vol 185.08K")
  const pts = [{ time: 1000, price: 4135 }, { time: 1000 + 20 * 900, price: 4160 }];

  it("Date and price range: 3 dòng như TV, ô nền tối", () => {
    const t = texts(SPEC.daterangeprice.build(mk("daterangeprice", pts)))[0];
    expect(t.text).toBe("25.000 (0.60%) 2,500.0\n20 bars, 5h\nVol 194.33K");
    expect(t.bg).toBe("#2e2e2e");
  });

  it("Price range: '0.60%, 2,500.0' không nền; Date range: 'bars, thời gian' + Vol", () => {
    const pr = texts(SPEC.pricerange.build(mk("pricerange", pts)))[0];
    expect(pr.text).toBe("0.60%, 2,500.0");
    expect(pr.bg).toBeUndefined();
    expect(texts(SPEC.daterange.build(mk("daterange", pts)))[0].text).toBe("20 bars, 5h\nVol 194.33K");
  });

  it("volume và định dạng K/M", () => {
    expect(volumeIn(bars, 1000, 1000 + 20 * 900)).toBe(21 * 9254);
    expect(fmtVol(185080)).toBe("185.08K");
    expect(fmtVol(2_500_000)).toBe("2.50M");
    expect(fmtVol(950)).toBe("950");
  });

  it("Arc: nửa elip đáy p1–p2, đỉnh cao tới p3", () => {
    const sh = SPEC.arc.build(mk("arc", [{ time: 1000, price: 4135 }, { time: 1000 + 2000, price: 4135 }, { time: 1000 + 1000, price: 4155 }]));
    const arc = sh.filter((s): s is Extract<Shape, { k: "poly" }> => s.k === "poly" && !s.noStroke)[0];
    expect(arc.pts[0]).toEqual({ x: 0, y: Y(4135) });
    expect(arc.pts[64].x).toBeCloseTo(200, 9);
    expect(Math.min(...arc.pts.map((q) => q.y))).toBeCloseTo(Y(4155), 9);
  });
});

describe("annotation (đo trên TV)", () => {
  const Y = (price: number) => 1000 - price;
  const mk = (type: string, points: Anchor[], text?: string, extra: Partial<Ctx> = {}): Ctx => ({
    d: { id: "x", type, points, color: SPEC[type].style?.color ?? "#2962ff", width: 1, locked: false, hidden: false, text },
    p: points.map((a) => ({ x: a.time, y: Y(a.price) })),
    w: 1000, h: 1000, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2, ...extra,
  });
  const texts = (sh: Shape[]) => sh.filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text");

  it("Pin: chỉ ghim, chữ (ô tối) hiện khi hover / chọn", () => {
    const pts = [{ time: 100, price: 100 }];
    expect(texts(SPEC.pin.build(mk("pin", pts, "Hello")))).toHaveLength(0);
    const t = texts(SPEC.pin.build(mk("pin", pts, "Hello", { hovered: true })))[0];
    expect(t).toMatchObject({ text: "Hello", bg: "#2e2e2e", color: "#dbdbdb" });
  });

  it("Callout: ô teal chữ trắng, đuôi nhọn chạm điểm 1", () => {
    const sh = SPEC.callout.build(mk("callout", [{ time: 100, price: 100 }, { time: 200, price: 150 }], "Hello"));
    const tail = sh[0] as Extract<Shape, { k: "poly" }>;
    expect(tail.pts[1]).toEqual({ x: 100, y: Y(100) });
    expect(texts(sh)[0]).toMatchObject({ bg: "#0097a7", color: "#ffffff", size: 14 });
  });

  it("Comment cỡ 16 bo tròn; Signpost ô tối + cột xám xuống điểm neo", () => {
    expect(texts(SPEC.comment.build(mk("comment", [{ time: 100, price: 100 }], "Hi")))[0]).toMatchObject({ size: 16, radius: 16, color: "#ffffff" });
    const sp = SPEC.signpost.build(mk("signpost", [{ time: 100, price: 100 }], "S"));
    expect(sp[0]).toMatchObject({ k: "line", a: { x: 100, y: Y(100) }, color: "#787b86" });
    expect(texts(sp)[0]).toMatchObject({ bg: "#2e2e2e", color: "#dbdbdb" });
  });

  it("Price note: ô giá ở điểm 2 + chữ chạy dọc đường", () => {
    const t = texts(SPEC.pricenote.build(mk("pricenote", [{ time: 100, price: 100 }, { time: 200, price: 150 }], "Hello")));
    expect(t.map((x) => x.text)).toEqual(["100.00", "Hello"]);
    expect(t[1].angle).toBeCloseTo(Math.atan2(-50, 100), 9);
  });

  it("màu mặc định theo TV", () => {
    expect(SPEC.arrowdown.style?.color).toBe("#cc2f3c");
    expect(SPEC.arrowmarker.style?.color).toBe("#1e53e5");
    expect(SPEC.circle.style?.color).toBe("#ff9800");
    expect(SPEC.callout.style?.color).toBe("#0097a7");
  });
});

describe("Price label, Flag (đo trên TV)", () => {
  const mk = (type: string): Ctx => ({
    d: { id: "x", type, points: [{ time: 100, price: 4140 }], color: "#2962ff", width: 1, locked: false, hidden: false },
    p: [{ x: 100, y: 500 }], w: 1000, h: 1000, bars: [], tickSize: 0.001, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0, X: (t) => t, Y: () => 500, fp: (v) => v.toFixed(3), digits: 3,
  });
  it("Price label: giá chữ trắng đậm cỡ 14 phía trên-phải, góc nhọn chạm điểm", () => {
    const [tail, label] = SPEC.pricelabel.build(mk("pricelabel"));
    expect((tail as Extract<Shape, { k: "poly" }>).pts[0]).toEqual({ x: 100, y: 500 });
    expect(label).toMatchObject({ k: "text", text: "4140.000", bold: true, size: 14, color: "#ffffff" });
    expect((label as Extract<Shape, { k: "text" }>).at.y).toBeLessThan(500);
  });
  it("Flag: cán xám ngắn + lá cờ nhỏ", () => {
    const [pole, flag] = SPEC.flag.build(mk("flag"));
    expect(pole).toMatchObject({ k: "line", color: "#b2b5be", a: { x: 100, y: 500 }, b: { x: 100, y: 482 } });
    expect(Math.max(...(flag as Extract<Shape, { k: "poly" }>).pts.map((q) => q.x)) - 100).toBe(12);
  });
});

describe("nhãn Position không đè nhau", () => {
  it("target sát entry: nhãn Target đẩy ra ngoài nhãn PnL", () => {
    const Y = (price: number) => 1000 - price * 10;
    const points = [{ time: 100, price: 100 }, { time: 100, price: 100.5 }, { time: 300, price: 100 }, { time: 100, price: 90 }];
    const c: Ctx = {
      d: { id: "x", type: "longpos", points, color: "#fff", width: 1, locked: false, hidden: false },
      p: points.map((a) => ({ x: a.time, y: Y(a.price) })), w: 1000, h: 1000, bars: [], tickSize: 0.01, hovered: false, selected: true,
      step: 1, barsBetween: (a, b) => b - a, X: (t) => t, Y, fp: (v) => v.toFixed(2), digits: 2,
    };
    const t = SPEC.longpos.build(c).filter((s): s is Extract<Shape, { k: "text" }> => s.k === "text");
    const target = t.find((x) => x.text.startsWith("Target"))!, pnl = t.find((x) => x.text.includes("PnL"))!;
    const tb = textBox(target), pb = textBox(pnl);
    expect(tb.y + tb.h).toBeLessThanOrEqual(pb.y + 1e-6);
  });
});

describe("Table (như TV)", () => {
  const mk = (opts?: Record<string, string | number | boolean>): Ctx => ({
    d: { id: "t", type: "table", points: [{ time: 100, price: 1 }], color: "#575757", width: 1, locked: false, hidden: false, opts },
    p: [{ x: 100, y: 50 }],
    w: 1000, h: 800, bars: [], tickSize: 0.01, hovered: false, selected: false, step: 1,
    barsBetween: (t0, t1) => t1 - t0,
    X: (t) => t, Y: (p) => p, fp: (v) => v.toFixed(2), digits: 2,
  });

  it("mặc định 3×3 ô rỗng; cells hỏng thì coi như rỗng; thêm hàng giữ nội dung cũ", () => {
    expect(tableCells(mk().d)).toEqual([["", "", ""], ["", "", ""], ["", "", ""]]);
    expect(tableCells(mk({ cells: "{oops" }).d)[0]).toEqual(["", "", ""]);
    const d = mk({ rows: 4, cols: 2, cells: JSON.stringify([["a", "b", "c"]]) }).d;
    expect(tableCells(d)).toEqual([["a", "b"], ["", ""], ["", ""], ["", ""]]);
  });

  it("cột 120px, hàng 31px với chữ 14 (TV); ô dưới con trỏ", () => {
    const { d } = mk();
    expect(tableCellAt(d, { x: 100, y: 50 }, { x: 100 + 125, y: 50 + 40 })).toEqual([1, 1]);
    expect(tableCellAt(d, { x: 100, y: 50 }, { x: 100 + 361, y: 60 })).toBeNull();
    const sh = SPEC.table.build(mk({ cells: JSON.stringify([["Entry", "", "4140"]]) }));
    const texts = sh.filter((s) => s.k === "text");
    expect(texts.map((t) => t.k === "text" && [t.text, t.at.x, t.at.y])).toEqual([["Entry", 108, 65.5], ["4140", 348, 65.5]]);
    // nền + viền ngoài + 2 đường dọc + 2 đường ngang
    expect(sh.filter((s) => s.k === "line")).toHaveLength(4);
  });
});
