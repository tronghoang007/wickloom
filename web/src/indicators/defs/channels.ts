import { num, str, type IndicatorDef } from "../schema";
import * as ta from "../ta";
import { SRC, length, offsetInput, warm } from "./common";

const KC_STYLES = ["Average True Range", "True Range", "Range"];

export const kc: IndicatorDef = {
  id: "kc", name: "KC", title: "Keltner Channels", overlay: true,
  inputs: [
    length(20),
    { key: "mult", label: "Multiplier", type: "float", default: 2, min: 0.001, step: 0.1 },
    SRC,
    { key: "ema", label: "Use Exponential MA", type: "bool", default: true },
    { key: "style", label: "Bands Style", type: "select", default: KC_STYLES[0], options: KC_STYLES },
    length(10, "atrLength", "ATR Length"),
  ],
  plots: [
    { id: "upper", title: "Upper", type: "line", color: "#2962ff" },
    { id: "basis", title: "Basis", type: "line", color: "#2962ff" },
    { id: "lower", title: "Lower", type: "line", color: "#2962ff" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ plot: "upper" }, { plot: "lower" }], color: "#2196f30d" }],
  warmup: (i) => Math.max(i.ema ? warm(4, num(i, "length")) : num(i, "length"), str(i, "style") === "Average True Range" ? warm(10, num(i, "atrLength")) : num(i, "length")),
  compute: ({ bars, inputs, src }) => {
    const n = num(inputs, "length"), k = num(inputs, "mult");
    const s = src(str(inputs, "src"));
    const basis = inputs.ema ? ta.ema(s, n) : ta.sma(s, n);
    const style = str(inputs, "style");
    const range =
      style === "True Range" ? ta.trueRange(bars) : style === "Average True Range" ? ta.atr(bars, num(inputs, "atrLength")) : ta.rma(bars.map((b) => b.h - b.l), n);
    return { upper: basis.map((x, i) => x + range[i] * k), basis, lower: basis.map((x, i) => x - range[i] * k) };
  },
};

export const dc: IndicatorDef = {
  id: "dc", name: "DC", title: "Donchian Channels", overlay: true,
  inputs: [length(20), offsetInput()],
  plots: [
    { id: "basis", title: "Basis", type: "line", color: "#ff6d00", offset: "offset" },
    { id: "upper", title: "Upper", type: "line", color: "#2962ff", offset: "offset" },
    { id: "lower", title: "Lower", type: "line", color: "#2962ff", offset: "offset" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ plot: "upper" }, { plot: "lower" }], color: "#2196f30d" }],
  warmup: (i) => num(i, "length"),
  compute: ({ bars, inputs }) => {
    const n = num(inputs, "length");
    const upper = ta.highest(bars.map((b) => b.h), n), lower = ta.lowest(bars.map((b) => b.l), n);
    return { basis: upper.map((x, i) => (x + lower[i]) / 2), upper, lower };
  },
};
