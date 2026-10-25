import { num, type IndicatorDef, type Inputs } from "../schema";
import * as ta from "../ta";
import { length, warm } from "./common";

/** Dịch của Leading Span (Pine: displacement − 1) và của Lagging Span (−displacement + 1). */
const lead = (i: Inputs) => num(i, "displacement") - 1;

export const ichimoku: IndicatorDef = {
  id: "ichimoku", name: "Ichimoku Cloud", title: "Ichimoku Cloud", overlay: true,
  inputs: [
    length(9, "conversion", "Conversion Line Length"),
    length(26, "base", "Base Line Length"),
    length(52, "span", "Leading Span B Length"),
    length(26, "displacement", "Lagging Span"),
  ],
  plots: [
    { id: "conversion", title: "Conversion Line", type: "line", color: "#2962ff" },
    { id: "base", title: "Base Line", type: "line", color: "#b71c1c" },
    { id: "lagging", title: "Lagging Span", type: "line", color: "#43a047", offset: (i) => -lead(i) },
    { id: "leadA", title: "Leading Span A", type: "line", color: "#a5d6a7", offset: lead },
    { id: "leadB", title: "Leading Span B", type: "line", color: "#ef9a9a", offset: lead },
  ],
  fills: [{ id: "cloud", title: "Background", between: [{ plot: "leadA" }, { plot: "leadB" }], color: "#43a0471a", colorDown: "#f443361a" }],
  warmup: (i) => Math.max(num(i, "conversion"), num(i, "base"), num(i, "span")),
  compute: ({ bars, inputs }) => {
    const hi = bars.map((b) => b.h), lo = bars.map((b) => b.l);
    const donchian = (n: number) => {
      const h = ta.highest(hi, n), l = ta.lowest(lo, n);
      return h.map((x, i) => (x + l[i]) / 2);
    };
    const conversion = donchian(num(inputs, "conversion")), base = donchian(num(inputs, "base"));
    return {
      conversion,
      base,
      lagging: bars.map((b) => b.c),
      leadA: conversion.map((x, i) => (x + base[i]) / 2),
      leadB: donchian(num(inputs, "span")),
    };
  },
};

export const psar: IndicatorDef = {
  id: "psar", name: "PSAR", title: "Parabolic SAR", overlay: true,
  inputs: [
    { key: "start", label: "start", type: "float", default: 0.02, min: 0.001, step: 0.01 },
    { key: "increment", label: "increment", type: "float", default: 0.02, min: 0.001, step: 0.01 },
    { key: "max", label: "Max value", type: "float", default: 0.2, min: 0.01, step: 0.01 },
  ],
  plots: [{ id: "sar", title: "ParabolicSAR", type: "cross", color: "#2962ff" }],
  warmup: () => 100,
  compute: ({ bars, inputs }) => ({ sar: ta.sar(bars, num(inputs, "start"), num(inputs, "increment"), num(inputs, "max")) }),
};

export const supertrend: IndicatorDef = {
  id: "supertrend", name: "Supertrend", title: "Supertrend", overlay: true,
  inputs: [length(10, "atrLength", "ATR Length"), { key: "factor", label: "Factor", type: "float", default: 3, min: 0.01, step: 0.01 }],
  plots: [
    { id: "up", title: "Up Trend", type: "linebr", color: "#4caf50" },
    { id: "down", title: "Down Trend", type: "linebr", color: "#f23645" },
    { id: "body", title: "Body Middle", type: "line", color: "#787b86", hidden: true },
  ],
  fills: [
    { id: "upFill", title: "Uptrend Background", between: [{ plot: "body" }, { plot: "up" }], color: "#4caf501a" },
    { id: "downFill", title: "Downtrend Background", between: [{ plot: "body" }, { plot: "down" }], color: "#f236451a" },
  ],
  warmup: (i) => warm(10, num(i, "atrLength")) + 10,
  compute: ({ bars, inputs }) => {
    const [line, dir] = ta.supertrend(bars, ta.source(bars, "hl2"), ta.atr(bars, num(inputs, "atrLength")), num(inputs, "factor"));
    return {
      up: line.map((x, i) => (dir[i] < 0 ? x : NaN)),
      down: line.map((x, i) => (dir[i] > 0 ? x : NaN)),
      body: bars.map((b) => (b.o + b.c) / 2),
    };
  },
};
