import { periodKeys, type Period } from "../calendar";
import { num, str, type IndicatorDef } from "../schema";
import * as ta from "../ta";
import { SRC, length, offsetInput, sourceInput, warm } from "./common";

export const sma: IndicatorDef = {
  id: "sma", name: "SMA", title: "Simple moving average", overlay: true,
  inputs: [length(20), SRC, offsetInput()],
  plots: [{ id: "sma", title: "SMA", type: "line", color: "#2962ff", offset: "offset" }],
  warmup: (i) => num(i, "length"),
  compute: ({ inputs, src }) => ({ sma: ta.sma(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const ema: IndicatorDef = {
  id: "ema", name: "EMA", title: "Exponential moving average", overlay: true,
  inputs: [length(20), SRC, offsetInput()],
  plots: [{ id: "ema", title: "EMA", type: "line", color: "#ff9800", offset: "offset" }],
  warmup: (i) => warm(4, num(i, "length")),
  compute: ({ inputs, src }) => ({ ema: ta.ema(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const wma: IndicatorDef = {
  id: "wma", name: "WMA", title: "Weighted moving average", overlay: true,
  inputs: [length(20), SRC, offsetInput()],
  plots: [{ id: "wma", title: "WMA", type: "line", color: "#e91e63", offset: "offset" }],
  warmup: (i) => num(i, "length"),
  compute: ({ inputs, src }) => ({ wma: ta.wma(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const bb: IndicatorDef = {
  id: "bb", name: "Bollinger Bands", title: "Bollinger Bands", overlay: true,
  inputs: [length(20), { key: "mult", label: "StdDev", type: "float", default: 2, min: 0.001, step: 0.1 }, SRC],
  plots: [
    { id: "basis", title: "Basis", type: "line", color: "#ff6d00" },
    { id: "upper", title: "Upper", type: "line", color: "#2962ff" },
    { id: "lower", title: "Lower", type: "line", color: "#2962ff" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ plot: "upper" }, { plot: "lower" }], color: "#2196f31a" }],
  warmup: (i) => num(i, "length"),
  compute: ({ inputs, src }) => {
    const s = src(str(inputs, "src")), n = num(inputs, "length"), k = num(inputs, "mult");
    const basis = ta.sma(s, n), dev = ta.stdev(s, n);
    return { basis, upper: basis.map((x, j) => x + k * dev[j]), lower: basis.map((x, j) => x - k * dev[j]) };
  },
};

const ANCHORS: Record<string, Period> = { Session: "day", Week: "week", Month: "month", Year: "year" };

/** VWAP cộng dồn, reset khi sang kỳ mới theo giờ broker (không còn reset theo ngày UTC). Volume = 0 -> na (không còn `v || 1`). */
export const vwap: IndicatorDef = {
  id: "vwap", name: "VWAP", title: "Volume-weighted average price", overlay: true,
  inputs: [
    { key: "anchor", label: "Anchor Period", type: "select", default: "Session", options: Object.keys(ANCHORS) },
    sourceInput("hlc3"),
  ],
  plots: [{ id: "vwap", title: "VWAP", type: "line", color: "#9c27b0" }],
  needsCalendar: true,
  warmup: () => 0,
  compute: ({ bars, inputs, src, calendar }) => {
    const s = src(str(inputs, "src"));
    const keys = periodKeys(bars.map((b) => b.t), ANCHORS[str(inputs, "anchor")] ?? "day", calendar);
    const out = ta.nan(bars.length);
    let pv = 0, vv = 0;
    for (let i = 0; i < bars.length; i++) {
      if (i > 0 && keys[i] !== keys[i - 1]) { pv = 0; vv = 0; }
      pv += s[i] * bars[i].v;
      vv += bars[i].v;
      if (vv > 0) out[i] = pv / vv;
    }
    return { vwap: out };
  },
};
