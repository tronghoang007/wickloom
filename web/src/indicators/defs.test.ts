import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { INDICATORS, byId } from "./catalog";
import { computeInstance } from "./engine";
import { newInstance, resolveInputs, type IndicatorInstance } from "./instance";
import * as ta from "./ta";

// Chuỗi M15 xác định: xu hướng + sóng + nhiễu, có volume khác nhau
const mk = (n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 2000 + Math.sin(i / 6) * 12 + Math.cos(i * 1.3) * 2 + i * 0.15;
    return { t: 1_700_000_000 + i * 900, o: c - 0.6 + (i % 3) * 0.3, h: c + 1.2 + (i % 4) * 0.4, l: c - 1.1 - (i % 3) * 0.3, c, v: 50 + ((i * 29) % 41) };
  });
const bars = mk(400);
const close = bars.map((b) => b.c), high = bars.map((b) => b.h), low = bars.map((b) => b.l), vol = bars.map((b) => b.v);

const run = (id: string, inputs: IndicatorInstance["inputs"] = {}, b: Bar[] = bars) =>
  computeInstance(byId(id), { ...newInstance(id), inputs }, b, { offset: 0 });

const same = (a: number[], b: number[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((x, i) => (Number.isNaN(b[i]) ? expect(x, `index ${i}`).toBeNaN() : expect(x, `index ${i}`).toBeCloseTo(b[i], 9)));
};

describe("catalog toàn vẹn", () => {
  it("id indicator, plot, level, fill, input không trùng", () => {
    expect(new Set(INDICATORS.map((d) => d.id)).size).toBe(INDICATORS.length);
    for (const d of INDICATORS) {
      for (const list of [d.plots.map((p) => p.id), (d.levels ?? []).map((l) => l.id), (d.fills ?? []).map((f) => f.id), (d.items ?? []).map((i) => i.id), d.inputs.map((i) => i.key)])
        expect(new Set(list).size, d.id).toBe(list.length);
    }
  });

  it("fill trỏ đúng plot / level; offset trỏ đúng input", () => {
    for (const d of INDICATORS) {
      for (const f of d.fills ?? [])
        for (const r of f.between) {
          if ("plot" in r) expect(d.plots.some((p) => p.id === r.plot), `${d.id}.${f.id}`).toBe(true);
          else expect(d.levels?.some((l) => l.id === r.level), `${d.id}.${f.id}`).toBe(true);
        }
      for (const p of d.plots) if (typeof p.offset === "string") expect(d.inputs.some((i) => i.key === p.offset), `${d.id}.${p.id}`).toBe(true);
    }
  });

  it("màu hợp lệ; mặc định của select nằm trong options; có ít nhất 1 plot hiện", () => {
    const hex = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
    for (const d of INDICATORS) {
      for (const p of d.plots) {
        expect(p.color, `${d.id}.${p.id}`).toMatch(hex);
        if (p.colorDown) expect(p.colorDown).toMatch(hex);
      }
      for (const l of d.levels ?? []) expect(l.color, `${d.id}.${l.id}`).toMatch(hex);
      for (const it of d.items ?? []) expect(it.color, `${d.id}.${it.id}`).toMatch(hex);
      for (const f of d.fills ?? []) {
        expect(f.color, `${d.id}.${f.id}`).toMatch(hex);
        if (f.colorDown) expect(f.colorDown).toMatch(hex);
      }
      for (const i of d.inputs) if (i.type === "select") expect(i.options, `${d.id}.${i.key}`).toContain(i.default);
      expect(d.plots.some((p) => !p.hidden) || !!d.objects || !!d.profiles || !!d.footprints, d.id).toBe(true); // vẽ bằng plot, object, profile hoặc footprint
    }
  });

  it("ít nến / không nến: không ném lỗi, mỗi plot vẫn đúng độ dài", () => {
    for (const n of [0, 1, 2, 5, 30]) {
      for (const d of INDICATORS) {
        const out = computeInstance(d, newInstance(d.id), mk(n), { offset: 0 });
        const inputs = resolveInputs(d, {});
        for (const p of d.plots) {
          const off = (typeof p.offset === "function" ? p.offset(inputs) : p.offset ? Number(inputs[p.offset]) : 0) || 0;
          expect(out[p.id].values, `${d.id}.${p.id} n=${n}`).toHaveLength(n + Math.max(0, off));
        }
      }
    }
  });
});

describe("MA mới và Bollinger", () => {
  it("SMMA = rma, VWMA = vwma theo volume, HMA = hma", () => {
    same(run("smma").smma.values, ta.rma(close, 7));
    same(run("vwma").vwma.values, ta.vwma(close, vol, 20));
    same(run("hma", { length: 16 }).hma.values, ta.hma(close, 16));
  });

  it("Bollinger: loại MA nền đổi basis nhưng độ lệch vẫn theo SMA-stdev của giá", () => {
    const out = run("bb", { maType: "EMA", mult: 1.5 });
    const basis = ta.ema(close, 20), dev = ta.stdev(close, 20);
    same(out.basis.values, basis);
    same(out.upper.values, basis.map((x, i) => x + 1.5 * dev[i]));
  });

  it("Bollinger: offset dịch cả ba đường", () => {
    const out = run("bb", { offset: 3 });
    expect(out.basis.values).toHaveLength(403);
    expect(out.upper.values[3 + 30]).toBeCloseTo(run("bb").upper.values[30], 9);
  });
});

describe("Keltner / Donchian", () => {
  it("KC mặc định: EMA ± 2·ATR(10)", () => {
    const out = run("kc");
    const basis = ta.ema(close, 20), a = ta.atr(bars, 10);
    same(out.basis.values, basis);
    same(out.upper.values, basis.map((x, i) => x + 2 * a[i]));
    same(out.lower.values, basis.map((x, i) => x - 2 * a[i]));
  });
  it("KC: tắt EMA = SMA; True Range và Range đổi độ rộng", () => {
    same(run("kc", { ema: false }).basis.values, ta.sma(close, 20));
    const tr = ta.trueRange(bars);
    same(run("kc", { style: "True Range", mult: 1 }).upper.values, ta.ema(close, 20).map((x, i) => x + tr[i]));
    const rng = ta.rma(bars.map((b) => b.h - b.l), 20);
    same(run("kc", { style: "Range", mult: 1 }).upper.values, ta.ema(close, 20).map((x, i) => x + rng[i]));
  });
  it("Donchian: cao nhất / thấp nhất n nến, basis ở giữa", () => {
    const out = run("dc", { length: 10 });
    same(out.upper.values, ta.highest(high, 10));
    same(out.lower.values, ta.lowest(low, 10));
    out.basis.values.forEach((x, i) => { if (i >= 9) expect(x).toBeCloseTo((out.upper.values[i] + out.lower.values[i]) / 2, 9); });
  });
});

describe("Ichimoku", () => {
  const out = run("ichimoku");
  const donchian = (n: number) => ta.highest(high, n).map((h, i) => (h + ta.lowest(low, n)[i]) / 2);
  const conv = donchian(9), base = donchian(26);

  it("conversion / base là trung điểm Donchian 9 / 26", () => {
    same(out.conversion.values, conv);
    same(out.base.values, base);
  });
  it("Leading Span A/B dịch sang phải 25 nến (vùng tương lai dài thêm 25)", () => {
    expect(out.leadA.values).toHaveLength(425);
    expect(out.leadA.values.slice(0, 25).every(Number.isNaN)).toBe(true);
    for (const i of [60, 200, 399]) {
      expect(out.leadA.values[i + 25]).toBeCloseTo((conv[i] + base[i]) / 2, 9);
      expect(out.leadB.values[i + 25]).toBeCloseTo(donchian(52)[i], 9);
    }
  });
  it("Lagging Span = giá đóng cửa dịch sang trái 25 nến, đuôi na", () => {
    expect(out.lagging.values).toHaveLength(400);
    expect(out.lagging.values[10]).toBe(close[35]);
    expect(out.lagging.values.slice(-25).every(Number.isNaN)).toBe(true);
  });
  it("đổi Lagging Span Periods đổi độ dịch (displacement − 1)", () => {
    expect(run("ichimoku", { displacement: 10 }).leadA.values).toHaveLength(409);
  });
  it("mây có hai màu theo nến (fill colorDown)", () => {
    const f = byId("ichimoku").fills![0];
    expect(f.color).not.toBe(f.colorDown);
  });
});

describe("PSAR / Supertrend", () => {
  it("PSAR dùng ta.sar với input", () => {
    same(run("psar").sar.values, ta.sar(bars, 0.02, 0.02, 0.2));
    same(run("psar", { start: 0.03, increment: 0.01, max: 0.1 }).sar.values, ta.sar(bars, 0.03, 0.01, 0.1));
  });
  it("Supertrend: mỗi nến chỉ thuộc một phía, up dưới giá, down trên giá, body = (O+C)/2", () => {
    const out = run("supertrend");
    for (let i = 0; i < bars.length; i++) {
      const u = out.up.values[i], d = out.down.values[i];
      expect(Number.isNaN(u) && Number.isNaN(d) ? true : Number.isNaN(u) !== Number.isNaN(d), `bar ${i}`).toBe(true);
      if (!Number.isNaN(u)) expect(u).toBeLessThanOrEqual(bars[i].c);
      if (!Number.isNaN(d)) expect(d).toBeGreaterThanOrEqual(bars[i].c);
      expect(out.body.values[i]).toBeCloseTo((bars[i].o + bars[i].c) / 2, 9);
    }
    expect(out.up.values.some((x) => !Number.isNaN(x)) && out.down.values.some((x) => !Number.isNaN(x))).toBe(true);
  });
  it("Supertrend: plot body ẩn, hai fill nối body với đường xu hướng", () => {
    const d = byId("supertrend");
    expect(d.plots.find((p) => p.id === "body")?.hidden).toBe(true);
    expect(d.fills!.map((f) => f.between.map((r) => ("plot" in r ? r.plot : "")))).toEqual([["body", "up"], ["body", "down"]]);
  });
});

describe("dao động mới", () => {
  it("Stoch RSI = SMA của stoch(RSI), %D = SMA(%K)", () => {
    const out = run("stochrsi");
    const r = ta.rsi(close, 14);
    const k = ta.sma(ta.stoch(r, r, r, 14), 3);
    same(out.k.values, k);
    same(out.d.values, ta.sma(k, 3));
    out.k.values.forEach((x) => { if (!Number.isNaN(x)) { expect(x).toBeGreaterThanOrEqual(-1e-9); expect(x).toBeLessThanOrEqual(100 + 1e-9); } });
  });
  it("ADX = thành phần thứ ba của DMI; DMI trả +DI, −DI, ADX", () => {
    const [plus, minus, adx] = ta.dmi(bars, 14, 14);
    same(run("adx").adx.values, adx);
    const d = run("dmi");
    same(d.plus.values, plus);
    same(d.minus.values, minus);
    same(d.adx.values, adx);
  });
  it("ADX Smoothing và DI Length là hai input độc lập", () => {
    same(run("adx", { adxSmoothing: 7, diLength: 20 }).adx.values, ta.dmi(bars, 20, 7)[2]);
  });
  it("CCI mặc định trên hlc3, Williams %R trên close", () => {
    same(run("cci").cci.values, ta.cci(ta.source(bars, "hlc3"), 20));
    same(run("willr").r.values, ta.williamsR(close, high, low, 14));
  });
  it("AO = SMA5 − SMA34 của hl2; xanh khi tăng, đỏ khi không", () => {
    const out = run("ao").ao;
    const hl2 = ta.source(bars, "hl2");
    same(out.values, ta.sub(ta.sma(hl2, 5), ta.sma(hl2, 34)));
    for (const i of [50, 120, 300]) expect(out.colors![i]).toBe(out.values[i] > out.values[i - 1] ? "#009688" : "#f44336"); // palette AO của TV: tăng #009688, giảm #f44336
  });
  it("Momentum và ROC", () => {
    same(run("mom").mom.values, ta.mom(close, 10));
    same(run("roc").roc.values, ta.roc(close, 9));
  });
  it("MFI trên hlc3 × volume, OBV cộng dồn", () => {
    same(run("mfi").mfi.values, ta.mfi(ta.source(bars, "hlc3"), vol, 14));
    same(run("obv").obv.values, ta.obv(bars));
    expect(byId("obv").format).toBe("volume");
  });
  it("RSI, Stochastic có đường giữa 50 mờ", () => {
    for (const id of ["rsi", "stoch", "stochrsi", "mfi"]) expect(byId(id).levels!.find((l) => l.id === "middle")?.value, id).toBe(50);
  });
});

describe("mặc định đo trên TV (2026-10-25)", () => {
  const def = (id: string) => Object.fromEntries(byId(id).inputs.map((i) => [i.key, i.default]));
  const colors = (id: string) => Object.fromEntries(byId(id).plots.map((p) => [p.id, p.color]));

  it("MA: length 9 (SMMA 7, VWMA 20), màu #2962ff; SMMA và HMA không có Offset", () => {
    expect(def("sma")).toMatchObject({ length: 9, src: "close", offset: 0, smoothType: "None", smoothLength: 14, smoothMult: 2 });
    expect(def("ema").length).toBe(9);
    expect(def("wma").length).toBe(9);
    expect(def("smma").length).toBe(7);
    expect(def("vwma").length).toBe(20);
    expect(colors("ema").ema).toBe("#2962ff");
    expect(colors("wma").wma).toBe("#2962ff");
    expect("offset" in def("smma")).toBe(false);
    expect("offset" in def("hma")).toBe(false);
  });

  it("Bollinger: basis xanh, upper đỏ, lower xanh lá; nền 5%", () => {
    expect(colors("bb")).toEqual({ basis: "#2962ff", upper: "#f23645", lower: "#089981" });
    expect(byId("bb").fills![0].color).toBe("#2196f30d");
  });

  it("Nhóm Smoothing: RSI và CCI bật SMA 14, OBV / SMA / EMA là None; SMA + Bollinger Bands thêm 2 dải", () => {
    expect(def("rsi")).toMatchObject({ length: 14, smoothType: "SMA", smoothLength: 14, smoothMult: 2 });
    expect(def("cci").smoothType).toBe("SMA");
    expect(def("obv").smoothType).toBe("None");
    const rsi = run("rsi");
    expect(rsi.sm.values[100]).toBeCloseTo(ta.sma(rsi.rsi.values, 14)[100], 9);
    expect(run("rsi", { smoothType: "None" }).sm.values.every(Number.isNaN)).toBe(true);
    const bb = run("rsi", { smoothType: "SMA + Bollinger Bands", smoothLength: 20, smoothMult: 2 });
    const sd = ta.stdev(bb.rsi.values, 20);
    expect(bb.smUpper.values[150]).toBeCloseTo(bb.sm.values[150] + 2 * sd[150], 9);
    expect(bb.smLower.values[150]).toBeCloseTo(bb.sm.values[150] - 2 * sd[150], 9);
    const ema = run("rsi", { smoothType: "EMA", smoothLength: 9 });
    same(ema.sm.values, ta.ema(ema.rsi.values, 9));
  });

  it("Stochastic: %K Length 14, %K Smoothing 1, %D Smoothing 3 -> %K là stoch thô", () => {
    expect(def("stoch")).toMatchObject({ k: 14, smooth: 1, d: 3 });
    const hh = ta.highest(high, 14), ll = ta.lowest(low, 14);
    const raw = bars.map((b, i) => (100 * (b.c - ll[i])) / (hh[i] - ll[i]));
    same(run("stoch").k.values, raw);
  });

  it("MACD: thứ tự input / plot như TV, đổi loại MA", () => {
    expect(byId("macd").inputs.map((i) => i.label)).toEqual(["Source", "Fast length", "Slow length", "Signal length", "Oscillator MA type", "Signal MA type"]);
    expect(byId("macd").plots.map((p) => p.title)).toEqual(["Histogram", "MACD", "Signal"]);
    const sma = run("macd", { oscMa: "SMA", signalMa: "SMA" });
    const line = ta.sub(ta.sma(close, 12), ta.sma(close, 26));
    same(sma.macd.values, line);
    same(sma.signal.values, ta.sma(line, 9));
  });

  it("ATR: Smoothing RMA / SMA / EMA / WMA; MFI không có Source; ADX #f23645, DMI ADX #f50057", () => {
    same(run("atr").atr.values, ta.atr(bars, 14));
    same(run("atr", { smoothing: "SMA" }).atr.values, ta.sma(ta.trueRange(bars), 14));
    same(run("atr", { smoothing: "WMA", length: 10 }).atr.values, ta.wma(ta.trueRange(bars), 10));
    expect(byId("mfi").inputs.map((i) => i.key)).toEqual(["length"]);
    expect(colors("adx").adx).toBe("#f23645");
    expect(colors("dmi")).toEqual({ adx: "#f50057", plus: "#2962ff", minus: "#ff6d00" });
  });

  it("Supertrend / Pivots / VWAP: màu và danh sách khung như TV", () => {
    expect(colors("supertrend").down).toBe("#f23645");
    expect(byId("ichimoku").plots.find((p) => p.id === "leadB")?.color).toBe("#ef9a9a");
    expect(byId("pivots").items!.every((i) => i.color === "#fb8c00")).toBe(true);
    const frames = byId("pivots").inputs.find((i) => i.key === "frame");
    expect(frames && "options" in frames && frames.options).toEqual(["Auto", "Daily", "Weekly", "Monthly", "Quarterly", "Yearly", "Biyearly", "Triyearly", "Quinquennially", "Decennially"]);
    expect(colors("vwap").upper3).toBe("#089981");
  });
});
