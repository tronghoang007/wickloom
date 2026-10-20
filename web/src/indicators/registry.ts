import type { Bar } from "@/lib/api";
import * as m from "./math";

export type InputDef =
  | { key: string; label: string; type: "number"; default: number; min?: number; step?: number }
  | { key: string; label: string; type: "select"; default: string; options: string[] };

export type PlotOut = {
  title: string;
  type: "line" | "histogram";
  values: m.Num;
  barColors?: string[]; // màu theo từng bar (histogram)
};

export type IndicatorDef = {
  id: string;
  name: string;
  overlay: boolean;
  inputs: InputDef[];
  colors: string[]; // màu mặc định theo plot
  levels?: number[];
  compute: (bars: Bar[], inp: Record<string, number | string>) => PlotOut[];
};

const SRC: InputDef = { key: "src", label: "Source", type: "select", default: "close", options: ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4"] };
const len = (d: number): InputDef => ({ key: "length", label: "Length", type: "number", default: d, min: 1 });
const L = (title: string, values: m.Num): PlotOut => ({ title, type: "line", values });

export const INDICATORS: IndicatorDef[] = [
  {
    id: "sma", name: "SMA", overlay: true, inputs: [len(20), SRC], colors: ["#2962ff"],
    compute: (b, i) => [L("SMA", m.sma(m.source(b, i.src as string), i.length as number))],
  },
  {
    id: "ema", name: "EMA", overlay: true, inputs: [len(20), SRC], colors: ["#ff9800"],
    compute: (b, i) => [L("EMA", m.ema(m.source(b, i.src as string), i.length as number))],
  },
  {
    id: "wma", name: "WMA", overlay: true, inputs: [len(20), SRC], colors: ["#e91e63"],
    compute: (b, i) => [L("WMA", m.wma(m.source(b, i.src as string), i.length as number))],
  },
  {
    id: "bb", name: "Bollinger Bands", overlay: true,
    inputs: [len(20), { key: "mult", label: "StdDev", type: "number", default: 2, min: 0.1, step: 0.1 }, SRC],
    colors: ["#ff6d00", "#2962ff", "#2962ff"],
    compute: (b, i) => {
      const s = m.source(b, i.src as string), n = i.length as number, k = i.mult as number;
      const basis = m.sma(s, n), dev = m.stdev(s, n);
      return [
        L("Basis", basis),
        L("Upper", basis.map((x, j) => x + k * dev[j])),
        L("Lower", basis.map((x, j) => x - k * dev[j])),
      ];
    },
  },
  {
    id: "vwap", name: "VWAP", overlay: true, inputs: [], colors: ["#9c27b0"],
    compute: (b) => {
      const out: m.Num = [];
      let pv = 0, vv = 0, day = -1;
      for (const x of b) {
        const d = Math.floor(x.t / 86400);
        if (d !== day) { day = d; pv = 0; vv = 0; }
        const vol = x.v || 1;
        pv += ((x.h + x.l + x.c) / 3) * vol;
        vv += vol;
        out.push(pv / vv);
      }
      return [L("VWAP", out)];
    },
  },
  {
    id: "volume", name: "Volume", overlay: false, inputs: [], colors: ["#26a69a"],
    compute: (b) => [{
      title: "Volume", type: "histogram", values: b.map((x) => x.v),
      barColors: b.map((x) => (x.c >= x.o ? "#26a69a80" : "#ef535080")),
    }],
  },
  {
    id: "rsi", name: "RSI", overlay: false, inputs: [len(14), SRC], colors: ["#7e57c2"], levels: [30, 70],
    compute: (b, i) => [L("RSI", m.rsi(m.source(b, i.src as string), i.length as number))],
  },
  {
    id: "macd", name: "MACD", overlay: false,
    inputs: [
      { key: "fast", label: "Fast", type: "number", default: 12, min: 1 },
      { key: "slow", label: "Slow", type: "number", default: 26, min: 1 },
      { key: "signal", label: "Signal", type: "number", default: 9, min: 1 },
      SRC,
    ],
    colors: ["#2962ff", "#ff6d00", "#26a69a"],
    compute: (b, i) => {
      const s = m.source(b, i.src as string);
      const line = m.sub(m.ema(s, i.fast as number), m.ema(s, i.slow as number));
      const sig = m.ema(line, i.signal as number);
      const hist = m.sub(line, sig);
      return [
        L("MACD", line), L("Signal", sig),
        { title: "Hist", type: "histogram", values: hist, barColors: hist.map((x) => (x >= 0 ? "#26a69a" : "#ef5350")) },
      ];
    },
  },
  {
    id: "stoch", name: "Stochastic", overlay: false,
    inputs: [
      { key: "k", label: "%K", type: "number", default: 14, min: 1 },
      { key: "d", label: "%D", type: "number", default: 3, min: 1 },
      { key: "smooth", label: "Smooth", type: "number", default: 3, min: 1 },
    ],
    colors: ["#2962ff", "#ff6d00"], levels: [20, 80],
    compute: (b, i) => {
      const hh = m.highest(b.map((x) => x.h), i.k as number), ll = m.lowest(b.map((x) => x.l), i.k as number);
      const raw = b.map((x, j) => (hh[j] === ll[j] ? NaN : (100 * (x.c - ll[j])) / (hh[j] - ll[j])));
      const k = m.sma(raw, i.smooth as number);
      return [L("%K", k), L("%D", m.sma(k, i.d as number))];
    },
  },
  {
    id: "atr", name: "ATR", overlay: false, inputs: [len(14)], colors: ["#b71c1c"],
    compute: (b, i) => [L("ATR", m.atr(b, i.length as number))],
  },
];

export const byId = (id: string) => INDICATORS.find((d) => d.id === id)!;
