import { num, str, type IndicatorDef, type Inputs } from "../schema";
import * as ta from "../ta";
import { SRC, length, sourceInput, warm, withColors } from "./common";

export const rsi: IndicatorDef = {
  id: "rsi", name: "RSI", title: "Relative strength index", overlay: false,
  inputs: [length(14), SRC],
  plots: [{ id: "rsi", title: "RSI", type: "line", color: "#7e57c2" }],
  levels: [
    { id: "upper", title: "Upper Band", value: 70, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: 50, color: "#787b8680" },
    { id: "lower", title: "Lower Band", value: 30, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#7e57c21a" }],
  warmup: (i) => warm(10, num(i, "length")),
  compute: ({ inputs, src }) => ({ rsi: ta.rsi(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const macd: IndicatorDef = {
  id: "macd", name: "MACD", title: "Moving average convergence divergence", overlay: false,
  inputs: [
    length(12, "fast", "Fast"),
    length(26, "slow", "Slow"),
    length(9, "signal", "Signal"),
    SRC,
  ],
  plots: [
    { id: "macd", title: "MACD", type: "line", color: "#2962ff" },
    { id: "signal", title: "Signal", type: "line", color: "#ff6d00" },
    { id: "hist", title: "Hist", type: "histogram", color: "#26a69a", perBar: true },
  ],
  warmup: (i) => warm(4, num(i, "fast"), num(i, "slow")) + warm(4, num(i, "signal")),
  compute: ({ inputs, src }) => {
    const s = src(str(inputs, "src"));
    const line = ta.sub(ta.ema(s, num(inputs, "fast")), ta.ema(s, num(inputs, "slow")));
    const signal = ta.ema(line, num(inputs, "signal"));
    const hist = ta.sub(line, signal);
    return { macd: line, signal, hist: withColors(hist, hist.map((x) => (x >= 0 ? "#26a69a" : "#ef5350"))) };
  },
};

export const stoch: IndicatorDef = {
  id: "stoch", name: "Stochastic", title: "Stochastic", overlay: false,
  inputs: [length(14, "k", "%K"), length(3, "d", "%D"), length(3, "smooth", "Smooth")],
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
  inputs: [length(14)],
  plots: [{ id: "atr", title: "ATR", type: "line", color: "#b71c1c" }],
  warmup: (i) => warm(10, num(i, "length")),
  compute: ({ bars, inputs }) => ({ atr: ta.atr(bars, num(inputs, "length")) }),
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
    SRC,
  ],
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
  plots: [{ id: "adx", title: "ADX", type: "line", color: "#f50057" }],
  warmup: dmiWarmup,
  compute: ({ bars, inputs }) => ({ adx: ta.dmi(bars, num(inputs, "diLength"), num(inputs, "adxSmoothing"))[2] }),
};

export const dmi: IndicatorDef = {
  id: "dmi", name: "DMI", title: "Directional movement index", overlay: false,
  inputs: dmiInputs,
  plots: [
    { id: "plus", title: "+DI", type: "line", color: "#2962ff" },
    { id: "minus", title: "-DI", type: "line", color: "#ff6d00" },
    { id: "adx", title: "ADX", type: "line", color: "#f23645" },
  ],
  warmup: dmiWarmup,
  compute: ({ bars, inputs }) => {
    const [plus, minus, adxLine] = ta.dmi(bars, num(inputs, "diLength"), num(inputs, "adxSmoothing"));
    return { plus, minus, adx: adxLine };
  },
};

export const cci: IndicatorDef = {
  id: "cci", name: "CCI", title: "Commodity channel index", overlay: false,
  inputs: [length(20), sourceInput("hlc3")],
  plots: [{ id: "cci", title: "CCI", type: "line", color: "#2962ff" }],
  levels: [
    { id: "upper", title: "Upper Band", value: 100, color: "#787b86" },
    { id: "lower", title: "Lower Band", value: -100, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#2196f31a" }],
  warmup: (i) => num(i, "length"),
  compute: ({ inputs, src }) => ({ cci: ta.cci(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const willr: IndicatorDef = {
  id: "willr", name: "%R", title: "Williams %R", overlay: false,
  inputs: [length(14), SRC],
  plots: [{ id: "r", title: "%R", type: "line", color: "#7e57c2" }],
  levels: [
    { id: "upper", title: "Upper Band", value: -20, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: -50, color: "#787b8680" },
    { id: "lower", title: "Lower Band", value: -80, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#7e57c21a" }],
  warmup: (i) => num(i, "length"),
  compute: ({ bars, inputs, src }) => ({ r: ta.williamsR(src(str(inputs, "src")), bars.map((b) => b.h), bars.map((b) => b.l), num(inputs, "length")) }),
};

export const ao: IndicatorDef = {
  id: "ao", name: "AO", title: "Awesome oscillator", overlay: false,
  inputs: [],
  plots: [{ id: "ao", title: "AO", type: "histogram", color: "#089981", perBar: true }],
  warmup: () => 34,
  compute: ({ src }) => {
    const hl2 = src("hl2");
    const v = ta.sub(ta.sma(hl2, 5), ta.sma(hl2, 34));
    // xanh khi AO tăng so với nến trước, đỏ khi không tăng (kể cả nến đầu chưa có nến trước)
    return { ao: withColors(v, v.map((x, i) => (i > 0 && x > v[i - 1] ? "#089981" : "#f23645"))) };
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
  inputs: [length(9), SRC],
  plots: [{ id: "roc", title: "ROC", type: "line", color: "#2962ff" }],
  levels: [{ id: "zero", title: "Zero Line", value: 0, color: "#787b86" }],
  warmup: (i) => num(i, "length"),
  compute: ({ inputs, src }) => ({ roc: ta.roc(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const mfi: IndicatorDef = {
  id: "mfi", name: "MFI", title: "Money flow index", overlay: false,
  inputs: [length(14), sourceInput("hlc3")],
  plots: [{ id: "mfi", title: "MF", type: "line", color: "#7e57c2" }],
  levels: [
    { id: "upper", title: "Overbought", value: 80, color: "#787b86" },
    { id: "middle", title: "Middle Band", value: 50, color: "#787b8680" },
    { id: "lower", title: "Oversold", value: 20, color: "#787b86" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ level: "upper" }, { level: "lower" }], color: "#7e57c21a" }],
  warmup: (i) => num(i, "length"),
  compute: ({ bars, inputs, src }) => ({ mfi: ta.mfi(src(str(inputs, "src")), bars.map((b) => b.v), num(inputs, "length")) }),
};

/** OBV cộng dồn từ nến đầu của lịch sử đã nạp nên giá trị tuyệt đối lệch TV (TV cộng từ nến đầu của cả mã); dáng đường giống. */
export const obv: IndicatorDef = {
  id: "obv", name: "OBV", title: "On balance volume", overlay: false, format: "volume",
  inputs: [],
  plots: [{ id: "obv", title: "OnBalanceVolume", type: "line", color: "#2962ff" }],
  warmup: () => 0,
  compute: ({ bars }) => ({ obv: ta.obv(bars) }),
};
