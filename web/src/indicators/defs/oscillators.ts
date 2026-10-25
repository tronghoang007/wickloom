import { num, str, type IndicatorDef, type Inputs } from "../schema";
import * as ta from "../ta";
import { SRC, length, maWarmup, smoothing, smoothingFills, smoothingInputs, smoothingPlots, smoothWarmup, sourceInput, warm, withColors } from "./common";

// Mặc định đo trên TV (2026-10-25): RSI Length 14, Source close, nhóm Smoothing bật SMA 14 (đường vàng "RSI-based MA").
// Chưa làm: Calculate Divergence và vùng tô gradient quá mua / quá bán.
export const rsi: IndicatorDef = {
  id: "rsi", name: "RSI", title: "Relative strength index", overlay: false,
  inputs: [{ ...length(14, "length", "RSI Length"), group: "RSI Settings" }, { ...SRC, group: "RSI Settings" }, ...smoothingInputs("SMA")],
  plots: [{ id: "rsi", title: "RSI", type: "line", color: "#7e57c2" }, ...smoothingPlots("RSI")],
  levels: [
    { id: "upper", title: "Upper Band", value: 70, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: 50, color: "#787b8680" },
    { id: "lower", title: "Lower Band", value: 30, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#7e57c21a" }, ...smoothingFills],
  warmup: (i) => warm(10, num(i, "length")) + smoothWarmup(i),
  compute: ({ bars, inputs, src }) => {
    const r = ta.rsi(src(str(inputs, "src")), num(inputs, "length"));
    return { rsi: r, ...smoothing(inputs, r, bars.map((b) => b.v)) };
  },
};

// TV: Source, Fast length 12, Slow length 26, Signal length 9, Oscillator MA type EMA, Signal MA type EMA; thứ tự plot Histogram, MACD, Signal;
// histogram 4 màu (trên 0 tăng #26a69a / giảm #b2dfdb, dưới 0 tăng #ffcdd2 / giảm #ff5252); đường 0 nét đứt.
const MACD_MA = ["EMA", "SMA"];
const macdMa = (type: string, s: number[], n: number) => (type === "SMA" ? ta.sma(s, n) : ta.ema(s, n));
export const macd: IndicatorDef = {
  id: "macd", name: "MACD", title: "Moving average convergence divergence", overlay: false,
  inputs: [
    SRC,
    length(12, "fast", "Fast length"),
    length(26, "slow", "Slow length"),
    length(9, "signal", "Signal length"),
    { key: "oscMa", label: "Oscillator MA type", type: "select", default: "EMA", options: MACD_MA },
    { key: "signalMa", label: "Signal MA type", type: "select", default: "EMA", options: MACD_MA },
  ],
  plots: [
    { id: "hist", title: "Histogram", type: "histogram", color: "#26a69a", perBar: true },
    { id: "macd", title: "MACD", type: "line", color: "#2962ff" },
    { id: "signal", title: "Signal", type: "line", color: "#ff6d00" },
  ],
  levels: [{ id: "zero", title: "Zero Line", value: 0, color: "#787b8680" }],
  warmup: (i) => maWarmup(str(i, "oscMa"), Math.max(num(i, "fast"), num(i, "slow"))) + maWarmup(str(i, "signalMa"), num(i, "signal")),
  compute: ({ inputs, src }) => {
    const s = src(str(inputs, "src"));
    const line = ta.sub(macdMa(str(inputs, "oscMa"), s, num(inputs, "fast")), macdMa(str(inputs, "oscMa"), s, num(inputs, "slow")));
    const signal = macdMa(str(inputs, "signalMa"), line, num(inputs, "signal"));
    const hist = ta.sub(line, signal);
    const colors = hist.map((x, i) => {
      const rising = i > 0 && hist[i - 1] < x;
      return x >= 0 ? (rising ? "#26a69a" : "#b2dfdb") : rising ? "#ffcdd2" : "#ff5252";
    });
    return { macd: line, signal, hist: withColors(hist, colors) };
  },
};

export const stoch: IndicatorDef = {
  id: "stoch", name: "Stochastic", title: "Stochastic", overlay: false,
  inputs: [length(14, "k", "%K Length"), length(1, "smooth", "%K Smoothing"), length(3, "d", "%D Smoothing")],
  plots: [
    { id: "k", title: "%K", type: "line", color: "#2962ff" },
    { id: "d", title: "%D", type: "line", color: "#ff6d00" },
  ],
  levels: [
    { id: "upper", title: "Upper Band", value: 80, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: 50, color: "#787b8680" },
    { id: "lower", title: "Lower Band", value: 20, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#2196f31a" }],
  warmup: (i) => num(i, "k") + num(i, "smooth") + num(i, "d"),
  compute: ({ bars, inputs }) => {
    const hh = ta.highest(bars.map((x) => x.h), num(inputs, "k")), ll = ta.lowest(bars.map((x) => x.l), num(inputs, "k"));
    const raw = bars.map((x, j) => (hh[j] === ll[j] ? NaN : (100 * (x.c - ll[j])) / (hh[j] - ll[j])));
    const k = ta.sma(raw, num(inputs, "smooth"));
    return { k, d: ta.sma(k, num(inputs, "d")) };
  },
};

export const atr: IndicatorDef = {
  id: "atr", name: "ATR", title: "Average true range", overlay: false,
  inputs: [length(14), { key: "smoothing", label: "Smoothing", type: "select", default: "RMA", options: ["RMA", "SMA", "EMA", "WMA"] }],
  plots: [{ id: "atr", title: "ATR", type: "line", color: "#b71c1c" }],
  warmup: (i) => (str(i, "smoothing") === "RMA" ? warm(10, num(i, "length")) : str(i, "smoothing") === "EMA" ? warm(4, num(i, "length")) : num(i, "length")),
  compute: ({ bars, inputs }) => {
    const n = num(inputs, "length"), type = str(inputs, "smoothing");
    return { atr: type === "RMA" ? ta.atr(bars, n) : ta.ma(type, ta.trueRange(bars), n, []) };
  },
};

/** Volume có store + legend riêng (Phase 5 mới gộp vào đây): def này chỉ để hiện trong dialog Indicators, dialog chặn việc thêm instance. */
export const volume: IndicatorDef = {
  id: "volume", name: "Volume", title: "Volume", overlay: false,
  inputs: [],
  plots: [{ id: "volume", title: "Volume", type: "histogram", color: "#26a69a", perBar: true }],
  warmup: () => 0,
  compute: ({ bars }) => ({
    volume: withColors(bars.map((x) => x.v), bars.map((x) => (x.c >= x.o ? "#26a69a80" : "#ef535080"))),
  }),
};

export const stochrsi: IndicatorDef = {
  id: "stochrsi", name: "Stoch RSI", title: "Stochastic RSI", overlay: false,
  inputs: [
    length(3, "smoothK", "K"),
    length(3, "smoothD", "D"),
    length(14, "rsiLength", "RSI Length"),
    length(14, "stochLength", "Stochastic Length"),
    { ...SRC, label: "RSI Source" },
  ],
  plots: [
    { id: "k", title: "K", type: "line", color: "#2962ff" },
    { id: "d", title: "D", type: "line", color: "#ff6d00" },
  ],
  levels: [
    { id: "upper", title: "Upper Band", value: 80, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: 50, color: "#787b8680" },
    { id: "lower", title: "Lower Band", value: 20, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#2196f31a" }],
  warmup: (i) => warm(10, num(i, "rsiLength")) + num(i, "stochLength") + num(i, "smoothK") + num(i, "smoothD"),
  compute: ({ inputs, src }) => {
    const r = ta.rsi(src(str(inputs, "src")), num(inputs, "rsiLength"));
    const k = ta.sma(ta.stoch(r, r, r, num(inputs, "stochLength")), num(inputs, "smoothK"));
    return { k, d: ta.sma(k, num(inputs, "smoothD")) };
  },
};

const dmiInputs = [length(14, "adxSmoothing", "ADX Smoothing"), length(14, "diLength", "DI Length")];
const dmiWarmup = (i: Inputs) => warm(10, num(i, "diLength")) + warm(10, num(i, "adxSmoothing"));

export const adx: IndicatorDef = {
  id: "adx", name: "ADX", title: "Average directional index", overlay: false,
  inputs: dmiInputs,
  plots: [{ id: "adx", title: "ADX", type: "line", color: "#f23645" }],
  warmup: dmiWarmup,
  compute: ({ bars, inputs }) => ({ adx: ta.dmi(bars, num(inputs, "diLength"), num(inputs, "adxSmoothing"))[2] }),
};

export const dmi: IndicatorDef = {
  id: "dmi", name: "DMI", title: "Directional movement index", overlay: false,
  inputs: dmiInputs,
  plots: [
    { id: "adx", title: "ADX", type: "line", color: "#f50057" },
    { id: "plus", title: "+DI", type: "line", color: "#2962ff" },
    { id: "minus", title: "-DI", type: "line", color: "#ff6d00" },
  ],
  warmup: dmiWarmup,
  compute: ({ bars, inputs }) => {
    const [plus, minus, adxLine] = ta.dmi(bars, num(inputs, "diLength"), num(inputs, "adxSmoothing"));
    return { plus, minus, adx: adxLine };
  },
};

export const cci: IndicatorDef = {
  id: "cci", name: "CCI", title: "Commodity channel index", overlay: false,
  inputs: [length(20, "length", "length"), sourceInput("hlc3"), ...smoothingInputs("SMA")],
  plots: [{ id: "cci", title: "CCI", type: "line", color: "#2962ff" }, ...smoothingPlots("CCI")],
  levels: [
    { id: "upper", title: "Upper Band", value: 100, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: 0, color: "#787b8680" },
    { id: "lower", title: "Lower Band", value: -100, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#2196f31a" }, ...smoothingFills],
  warmup: (i) => num(i, "length") + smoothWarmup(i),
  compute: ({ bars, inputs, src }) => {
    const c = ta.cci(src(str(inputs, "src")), num(inputs, "length"));
    return { cci: c, ...smoothing(inputs, c, bars.map((b) => b.v)) };
  },
};

export const willr: IndicatorDef = {
  id: "willr", name: "%R", title: "Williams %R", overlay: false,
  inputs: [length(14), SRC],
  plots: [{ id: "r", title: "%R", type: "line", color: "#7e57c2" }],
  levels: [
    { id: "upper", title: "Upper Band", value: -20, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: -50, color: "#787b86", lineStyle: "dotted" },
    { id: "lower", title: "Lower Band", value: -80, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#7e57c21a" }],
  warmup: (i) => num(i, "length"),
  compute: ({ bars, inputs, src }) => ({ r: ta.williamsR(src(str(inputs, "src")), bars.map((b) => b.h), bars.map((b) => b.l), num(inputs, "length")) }),
};

export const ao: IndicatorDef = {
  id: "ao", name: "AO", title: "Awesome oscillator", overlay: false,
  inputs: [],
  plots: [{ id: "ao", title: "AO", type: "histogram", color: "#009688", perBar: true }],
  warmup: () => 34,
  compute: ({ src }) => {
    const hl2 = src("hl2");
    const v = ta.sub(ta.sma(hl2, 5), ta.sma(hl2, 34));
    // xanh khi AO tăng so với nến trước, đỏ khi không tăng (kể cả nến đầu chưa có nến trước)
    return { ao: withColors(v, v.map((x, i) => (i > 0 && x > v[i - 1] ? "#009688" : "#f44336"))) };
  },
};

export const mom: IndicatorDef = {
  id: "mom", name: "Mom", title: "Momentum", overlay: false,
  inputs: [length(10), SRC],
  plots: [{ id: "mom", title: "MOM", type: "line", color: "#2962ff" }],
  warmup: (i) => num(i, "length"),
  compute: ({ inputs, src }) => ({ mom: ta.mom(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const roc: IndicatorDef = {
  id: "roc", name: "ROC", title: "Rate of change", overlay: false,
  inputs: [length(9, "length", "length"), SRC],
  plots: [{ id: "roc", title: "ROC", type: "line", color: "#2962ff" }],
  levels: [{ id: "zero", title: "Zero Line", value: 0, color: "#787b86" }],
  warmup: (i) => num(i, "length"),
  compute: ({ inputs, src }) => ({ roc: ta.roc(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const mfi: IndicatorDef = {
  id: "mfi", name: "MFI", title: "Money flow index", overlay: false,
  inputs: [length(14)],
  plots: [{ id: "mfi", title: "MF", type: "line", color: "#7e57c2" }],
  levels: [
    { id: "upper", title: "Overbought", value: 80, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: 50, color: "#787b8680" },
    { id: "lower", title: "Oversold", value: 20, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#7e57c21a" }],
  warmup: (i) => num(i, "length"),
  compute: ({ bars, inputs, src }) => ({ mfi: ta.mfi(src("hlc3"), bars.map((b) => b.v), num(inputs, "length")) }),
};

/** OBV cộng dồn từ nến đầu của lịch sử đã nạp nên giá trị tuyệt đối lệch TV (TV cộng từ nến đầu của cả mã); dáng đường giống. */
export const obv: IndicatorDef = {
  id: "obv", name: "OBV", title: "On balance volume", overlay: false, format: "volume",
  inputs: smoothingInputs(),
  plots: [{ id: "obv", title: "OnBalanceVolume", type: "line", color: "#2962ff" }, ...smoothingPlots("OBV")],
  fills: smoothingFills,
  warmup: (i) => smoothWarmup(i),
  compute: ({ bars, inputs }) => {
    const o = ta.obv(bars);
    return { obv: o, ...smoothing(inputs, o, bars.map((b) => b.v)) };
  },
};
