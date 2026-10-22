import { num, str, type IndicatorDef } from "../schema";
import * as ta from "../ta";
import { SRC, length, warm, withColors } from "./common";

export const rsi: IndicatorDef = {
  id: "rsi", name: "RSI", title: "Relative strength index", overlay: false,
  inputs: [length(14), SRC],
  plots: [{ id: "rsi", title: "RSI", type: "line", color: "#7e57c2" }],
  levels: [30, 70],
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
    { id: "hist", title: "Hist", type: "histogram", color: "#26a69a" },
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
  levels: [20, 80],
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
  plots: [{ id: "volume", title: "Volume", type: "histogram", color: "#26a69a" }],
  warmup: () => 0,
  compute: ({ bars }) => ({
    volume: withColors(bars.map((x) => x.v), bars.map((x) => (x.c >= x.o ? "#26a69a80" : "#ef535080"))),
  }),
};
