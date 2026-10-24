import { periodKeys, type Period } from "../calendar";
import { num, str, type FillRef, type IndicatorDef, type InputDef, type Inputs, type PlotDef } from "../schema";
import * as ta from "../ta";
import type { Num } from "../ta";
import { SRC, length, maTypeInput, maWarmup, offsetInput, sessionInputs, sourceInput, warm, withSession } from "./common";
import { barStep } from "./pivots";

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

export const smma: IndicatorDef = {
  id: "smma", name: "SMMA", title: "Smoothed moving average", overlay: true,
  inputs: [length(7), SRC, offsetInput()],
  plots: [{ id: "smma", title: "SMMA", type: "line", color: "#673ab7", offset: "offset" }],
  warmup: (i) => warm(10, num(i, "length")),
  compute: ({ inputs, src }) => ({ smma: ta.rma(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const vwma: IndicatorDef = {
  id: "vwma", name: "VWMA", title: "Volume weighted moving average", overlay: true,
  inputs: [length(20), SRC, offsetInput()],
  plots: [{ id: "vwma", title: "VWMA", type: "line", color: "#2962ff", offset: "offset" }],
  warmup: (i) => num(i, "length"),
  compute: ({ bars, inputs, src }) => ({ vwma: ta.vwma(src(str(inputs, "src")), bars.map((b) => b.v), num(inputs, "length")) }),
};

export const hma: IndicatorDef = {
  id: "hma", name: "HMA", title: "Hull moving average", overlay: true,
  inputs: [length(9), SRC, offsetInput()],
  plots: [{ id: "hma", title: "HMA", type: "line", color: "#2962ff", offset: "offset" }],
  warmup: (i) => num(i, "length") + Math.ceil(Math.sqrt(num(i, "length"))),
  compute: ({ inputs, src }) => ({ hma: ta.hma(src(str(inputs, "src")), num(inputs, "length")) }),
};

export const bb: IndicatorDef = {
  id: "bb", name: "Bollinger Bands", title: "Bollinger Bands", overlay: true,
  inputs: [length(20), maTypeInput("maType", "Basis MA Type"), SRC, { key: "mult", label: "StdDev", type: "float", default: 2, min: 0.001, step: 0.1 }, offsetInput()],
  plots: [
    { id: "basis", title: "Basis", type: "line", color: "#ff6d00", offset: "offset" },
    { id: "upper", title: "Upper", type: "line", color: "#2962ff", offset: "offset" },
    { id: "lower", title: "Lower", type: "line", color: "#2962ff", offset: "offset" },
  ],
  fills: [{ id: "band", title: "Background", between: [{ plot: "upper" }, { plot: "lower" }], color: "#2196f31a" }],
  warmup: (i) => maWarmup(str(i, "maType"), num(i, "length")),
  compute: ({ bars, inputs, src }) => {
    const s = src(str(inputs, "src")), n = num(inputs, "length"), k = num(inputs, "mult");
    const basis = ta.ma(str(inputs, "maType"), s, n, bars.map((b) => b.v)), dev = ta.stdev(s, n);
    return { basis, upper: basis.map((x, j) => x + k * dev[j]), lower: basis.map((x, j) => x - k * dev[j]) };
  },
};

const ANCHORS: Record<string, Period> = { Session: "day", Week: "week", Month: "month", Quarter: "quarter", Year: "year", Decade: "decade", Century: "century" };
const BAND_COLORS = ["#4caf50", "#808000", "#00897b"]; // green, olive, teal của Pine (nền 5% đục)
const BANDS = [1, 2, 3];
const bandOn = (n: number) => (i: Inputs) => !!i[`showBand${n}`];

/** VWAP như indicator có sẵn của TV: cộng dồn Σ(giá·vol)/Σvol, reset khi sang kỳ Anchor theo giờ broker (hoặc mốc Session start). Dải trên / dưới = VWAP ± hệ số × độ lệch chuẩn
 *  có trọng số volume (hoặc % của VWAP). Volume = 0 -> na (không còn `v || 1`). */
export const vwap: IndicatorDef = {
  id: "vwap", name: "VWAP", title: "Volume-weighted average price", overlay: true,
  inputs: [
    { key: "hideDWM", label: "Hide VWAP on 1D or Above", type: "bool", default: false, group: "VWAP Settings" },
    { key: "anchor", label: "Anchor Period", type: "select", default: "Session", options: Object.keys(ANCHORS), group: "VWAP Settings" },
    { ...sourceInput("hlc3"), group: "VWAP Settings" },
    { ...offsetInput(), group: "VWAP Settings" },
    ...sessionInputs(),
    {
      key: "bandsMode", label: "Bands Calculation Mode", type: "select", default: "Standard Deviation", options: ["Standard Deviation", "Percentage"], group: "Bands Settings", hideInLegend: true,
      tooltip: "Determines the units used to calculate the distance of the bands. When \"Percentage\" is selected, a multiplier of 1 corresponds to 1% of the VWAP value.",
    },
    ...BANDS.flatMap((n): InputDef[] => [
      { key: `showBand${n}`, label: `Show Band #${n}`, type: "bool", default: n === 1, group: "Bands Settings" },
      { key: `bandMult${n}`, label: `Bands Multiplier #${n}`, type: "float", default: n, min: 0, step: 0.5, group: "Bands Settings", hideInLegend: true, enabledIf: bandOn(n) },
    ]),
  ],
  plots: [
    { id: "vwap", title: "VWAP", type: "line", color: "#2962ff", offset: "offset" },
    ...BANDS.flatMap((n): PlotDef[] => [
      { id: `upper${n}`, title: `Upper Band #${n}`, type: "line", color: BAND_COLORS[n - 1], offset: "offset", showIf: bandOn(n) },
      { id: `lower${n}`, title: `Lower Band #${n}`, type: "line", color: BAND_COLORS[n - 1], offset: "offset", showIf: bandOn(n) },
    ]),
  ],
  fills: BANDS.map((n) => ({ id: `fill${n}`, title: `Bands Fill #${n}`, between: [{ plot: `upper${n}` }, { plot: `lower${n}` }] as [FillRef, FillRef], color: `${BAND_COLORS[n - 1]}0d`, showIf: bandOn(n) })),
  needsCalendar: true,
  warmup: () => 0,
  compute: ({ bars, inputs, src, calendar }) => {
    const s = src(str(inputs, "src"));
    const keys = periodKeys(bars.map((b) => b.t), ANCHORS[str(inputs, "anchor")] ?? "day", withSession(calendar, inputs));
    const n = bars.length;
    const out: Record<string, Num> = { vwap: ta.nan(n) };
    for (const k of BANDS) { out[`upper${k}`] = ta.nan(n); out[`lower${k}`] = ta.nan(n); }
    if (inputs.hideDWM && barStep(bars) >= 86400) return out; // D1 trở lên: như TV, không vẽ
    const pct = str(inputs, "bandsMode") === "Percentage";
    let pv = 0, pv2 = 0, vv = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0 && keys[i] !== keys[i - 1]) { pv = 0; pv2 = 0; vv = 0; }
      pv += s[i] * bars[i].v;
      pv2 += s[i] * s[i] * bars[i].v;
      vv += bars[i].v;
      if (vv <= 0) continue;
      const w = pv / vv;
      out.vwap[i] = w;
      const basis = pct ? w * 0.01 : Math.sqrt(Math.max(0, pv2 / vv - w * w));
      for (const k of BANDS) {
        const d = basis * num(inputs, `bandMult${k}`);
        out[`upper${k}`][i] = w + d;
        out[`lower${k}`][i] = w - d;
      }
    }
    return out;
  },
};
