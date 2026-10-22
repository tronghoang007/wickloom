import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { INDICATORS, byId } from "./catalog";
import { computeInstance, futureTimes, historyTarget, shiftBy, trimPlot } from "./engine";
import { newInstance, type IndicatorInstance } from "./instance";
import type { IndicatorDef } from "./schema";
import { plotStyle } from "./style";
import * as ta from "./ta";

const utc = (iso: string) => Date.parse(iso + "Z") / 1000;

// 3 ngày M30 với offset broker +2 (nến đầu ngày broker = 22:00 UTC), có volume khác nhau
const mk = (n: number, t0 = utc("2026-03-09T22:00:00"), step = 1800): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 2000 + Math.sin(i / 5) * 10 + i * 0.2;
    return { t: t0 + i * step, o: c - 0.5, h: c + 1 + (i % 3), l: c - 1 - (i % 2), c, v: 10 + ((i * 7) % 13) };
  });

const run = (id: string, inputs: IndicatorInstance["inputs"], bars: Bar[], calendar = { offset: 2 * 3600 }) =>
  computeInstance(byId(id), { ...newInstance(id), inputs }, bars, calendar);

describe("computeInstance", () => {
  const bars = mk(300);
  const close = bars.map((b) => b.c);

  it("mọi def trả đủ plot, đúng độ dài, không ném lỗi", () => {
    for (const def of INDICATORS) {
      const out = computeInstance(def, newInstance(def.id), bars, { offset: 0 });
      expect(Object.keys(out).sort(), def.id).toEqual(def.plots.map((p) => p.id).sort());
      for (const p of def.plots) expect(out[p.id].values, `${def.id}.${p.id}`).toHaveLength(bars.length);
    }
  });

  it("sma / ema / wma dùng đúng hàm ta với input đã lưu", () => {
    expect(run("sma", { length: 7 }, bars).sma.values).toEqual(ta.sma(close, 7));
    expect(run("ema", { length: 7, src: "high" }, bars).ema.values).toEqual(ta.ema(bars.map((b) => b.h), 7));
    expect(run("wma", {}, bars).wma.values).toEqual(ta.wma(close, 20));
  });

  it("Bollinger: basis = sma, band = basis ± mult·stdev tổng thể", () => {
    const o = run("bb", { length: 10, mult: 1.5 }, bars);
    const sd = ta.stdev(close, 10);
    expect(o.upper.values[50]).toBeCloseTo(o.basis.values[50] + 1.5 * sd[50], 9);
    expect(o.lower.values[50]).toBeCloseTo(o.basis.values[50] - 1.5 * sd[50], 9);
  });

  it("MACD: hist = macd − signal, màu theo dấu", () => {
    const o = run("macd", {}, bars);
    const i = 120;
    expect(o.hist.values[i]).toBeCloseTo(o.macd.values[i] - o.signal.values[i], 9);
    expect(o.hist.colors?.[i]).toBe(o.hist.values[i] >= 0 ? "#26a69a" : "#ef5350");
  });

  it("Stochastic: %K nằm trong [0,100], %D = sma(%K)", () => {
    const o = run("stoch", {}, bars);
    for (const v of o.k.values.filter((x) => !Number.isNaN(x))) expect(v >= 0 && v <= 100).toBe(true);
    expect(o.d.values[100]).toBeCloseTo(ta.sma(o.k.values, 3)[100], 9);
  });

  it("RSI nằm trong [0,100]; ATR dương", () => {
    for (const v of run("rsi", {}, bars).rsi.values.filter((x) => !Number.isNaN(x))) expect(v >= 0 && v <= 100).toBe(true);
    expect(run("atr", {}, bars).atr.values[100]).toBeGreaterThan(0);
  });
});

describe("VWAP theo giờ broker", () => {
  // 48 nến M30 = đúng 1 ngày broker (22:00 UTC → 22:00 UTC hôm sau), rồi sang ngày mới
  const bars = mk(120);
  const hlc3 = ta.source(bars, "hlc3");

  it("reset ở 00:00 broker (22:00 UTC), không phải 00:00 UTC", () => {
    const v = run("vwap", {}, bars).vwap.values;
    // nến đầu mỗi ngày broker: VWAP = hlc3 của chính nó
    expect(v[0]).toBeCloseTo(hlc3[0], 9);
    expect(v[48]).toBeCloseTo(hlc3[48], 9);
    expect(v[96]).toBeCloseTo(hlc3[96], 9);
    // 00:00 UTC (nến thứ 4 của ngày broker) không reset
    expect(v[4]).not.toBeCloseTo(hlc3[4], 3);
  });

  it("cộng dồn trong phiên: VWAP = Σ(giá·vol)/Σvol", () => {
    const v = run("vwap", {}, bars).vwap.values;
    let pv = 0, vv = 0;
    for (let i = 48; i <= 60; i++) { pv += hlc3[i] * bars[i].v; vv += bars[i].v; }
    expect(v[60]).toBeCloseTo(pv / vv, 9);
  });

  it("anchor Week gộp nhiều ngày; volume = 0 -> na thay vì chia cho 1", () => {
    const wk = run("vwap", { anchor: "Week" }, bars).vwap.values;
    const day = run("vwap", {}, bars).vwap.values;
    expect(wk[48]).not.toBeCloseTo(day[48], 6);
    const flat = bars.map((b) => ({ ...b, v: 0 }));
    expect(run("vwap", {}, flat).vwap.values.every(Number.isNaN)).toBe(true);
  });

  it("ranh giới ngày đúng qua DST khi có dayOpens", () => {
    // offset hiện tại +3 nhưng ngày mùa đông mở 22:00 UTC (= +2): chỉ đúng nếu dùng mốc D1 thật
    const opens = [0, 1, 2].map((d) => utc("2026-03-09T22:00:00") + d * 86400);
    const v = run("vwap", {}, bars, { offset: 3 * 3600, dayOpens: opens } as never).vwap.values;
    expect(v[48]).toBeCloseTo(hlc3[48], 9);
    const naive = run("vwap", {}, bars, { offset: 3 * 3600 }).vwap.values;
    expect(naive[48]).not.toBeCloseTo(hlc3[48], 6);
  });
});

describe("trimPlot / historyTarget", () => {
  it("cắt phần lịch sử ngầm, kể cả màu", () => {
    const d = { values: [1, 2, 3, 4], colors: ["a", "b", "c", "d"] };
    expect(trimPlot(d, 0)).toBe(d);
    expect(trimPlot(d, 2)).toEqual({ values: [3, 4], colors: ["c", "d"] });
    expect(trimPlot({ values: [1, 2, 3] }, 1)).toEqual({ values: [2, 3] });
  });

  it("tối thiểu 5000; warmup lớn thì tăng theo", () => {
    const defs = INDICATORS;
    const a = { ...newInstance("sma") };
    expect(historyTarget(defs, [a], 500, 5000)).toBe(5000);
    const big = { ...newInstance("rsi"), inputs: { length: 900 } };
    expect(historyTarget(defs, [a, big], 500, 5000)).toBe(900 * 10 + 500);
    expect(historyTarget(defs, [], 500, 5000)).toBe(5000);
  });
});

describe("offset", () => {
  it("shiftBy: dương = sang phải và dài thêm, âm = sang trái giữ độ dài", () => {
    expect(shiftBy([1, 2, 3], 0, NaN)).toEqual([1, 2, 3]);
    expect(shiftBy([1, 2, 3], 2, NaN)).toEqual([NaN, NaN, 1, 2, 3]);
    expect(shiftBy([1, 2, 3], -1, NaN)).toEqual([2, 3, NaN]);
    expect(shiftBy(["a", "b"], 1, "")).toEqual(["", "a", "b"]);
    expect(shiftBy([1, 2], -5, NaN)).toEqual([NaN, NaN]);
  });

  it("futureTimes nối tiếp theo bước khung", () => {
    expect(futureTimes(1000, 3, 900)).toEqual([1900, 2800, 3700]);
    expect(futureTimes(1000, 0, 900)).toEqual([]);
  });

  const bars = mk(60);
  it("MA có offset: dài thêm offset nến, giá trị trễ đúng số nến", () => {
    const base = run("sma", { length: 5 }, bars).sma.values;
    const off = run("sma", { length: 5, offset: 3 }, bars).sma.values;
    expect(off).toHaveLength(63);
    expect(off[10 + 3]).toBeCloseTo(base[10], 9);
    expect(off[62]).toBeCloseTo(base[59], 9);
    expect(off[2]).toBeNaN();
  });

  it("offset âm: dịch sang trái, đuôi là na", () => {
    const base = run("sma", { length: 5 }, bars).sma.values;
    const off = run("sma", { length: 5, offset: -2 }, bars).sma.values;
    expect(off).toHaveLength(60);
    expect(off[10]).toBeCloseTo(base[12], 9);
    expect(off[59]).toBeNaN();
    expect(off[58]).toBeNaN();
  });

  it("trimPlot sau offset giữ phần tương lai", () => {
    const off = run("ema", { length: 5, offset: 4 }, bars).ema;
    expect(trimPlot(off, 20).values).toHaveLength(44);
  });
});

describe("plot candles", () => {
  // Delta tích luỹ theo nến chart (def thử, không nằm trong catalog): open = tích luỹ trước nến, close = sau nến
  const candleDef: IndicatorDef = {
    id: "ctest", name: "CT", title: "CT", overlay: false, format: "volume", inputs: [],
    plots: [{ id: "cvd", title: "CVD", type: "candles", color: "#089981", colorDown: "#f23645" }],
    warmup: () => 0,
    compute: ({ bars }) => {
      const o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [];
      let cum = 0;
      for (const b of bars) {
        const d = b.c >= b.o ? b.v : -b.v;
        o.push(cum); cum += d; c.push(cum);
        h.push(Math.max(o[o.length - 1], cum) + 1); l.push(Math.min(o[o.length - 1], cum) - 1);
      }
      return { cvd: { values: c, candle: { o, h, l } } };
    },
  };
  const bars = mk(30);
  const inst = { ...newInstance("ctest") };

  it("trả đủ open/high/low/close và nối tiếp nhau", () => {
    const d = computeInstance(candleDef, inst, bars, { offset: 0 }).cvd;
    expect(d.candle!.o).toHaveLength(30);
    expect(d.candle!.o[1]).toBe(d.values[0]);
    expect(d.candle!.h[5]).toBeGreaterThanOrEqual(Math.max(d.candle!.o[5], d.values[5]));
  });

  it("compute thiếu candle -> plot na (không ném lỗi)", () => {
    const bad: IndicatorDef = { ...candleDef, compute: ({ bars: b }) => ({ cvd: { values: b.map((x) => x.c) } }) };
    const d = computeInstance(bad, inst, bars, { offset: 0 }).cvd;
    expect(d.values.every(Number.isNaN)).toBe(true);
    expect(d.candle!.o.every(Number.isNaN)).toBe(true);
  });

  it("trimPlot cắt cả open/high/low", () => {
    const d = trimPlot(computeInstance(candleDef, inst, bars, { offset: 0 }).cvd, 10);
    expect(d.values).toHaveLength(20);
    expect(d.candle!.l).toHaveLength(20);
  });

  it("kiểu candles cố định; có màu lên/xuống; volume format", () => {
    expect(plotStyle({ ...inst, style: { plots: { cvd: { type: "line" } } } }, candleDef.plots[0])).toMatchObject({ type: "candles", color: "#089981", colorDown: "#f23645" });
    expect(plotStyle(inst, { ...candleDef.plots[0], colorDown: undefined }).colorDown).toBe("#089981");
  });
});
