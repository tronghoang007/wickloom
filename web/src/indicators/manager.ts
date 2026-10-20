import type { Bar } from "@/lib/api";
import {
    HistogramSeries,
    LineSeries,
    LineStyle,
    type IChartApi,
    type ISeriesApi,
    type SeriesType,
    type UTCTimestamp,
} from "lightweight-charts";
import { byId, type PlotOut } from "./registry";
import type { IndicatorInstance } from "./store";

type Live = { inst: IndicatorInstance; series: ISeriesApi<SeriesType>[] };

export class IndicatorManager {
  private live: Live[] = [];
  private sig = "";
  private bars: Bar[] = [];
  private list: IndicatorInstance[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private chart: IChartApi) {}

  // Tính lại tối đa ~4 lần/giây để realtime không tốn CPU
  update(list: IndicatorInstance[], bars: Bar[]) {
    this.list = list;
    this.bars = bars;
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sync();
    }, 250);
  }

  destroy() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clear() {
    for (const l of this.live) for (const s of l.series) {
      try { this.chart.removeSeries(s); } catch { /* chart đã bị huỷ */ }
    }
    this.live = [];
  }

  private points(p: PlotOut) {
    return this.bars.map((b, i) => {
      const v = p.values[i];
      const time = b.t as UTCTimestamp;
      if (v === undefined || Number.isNaN(v)) return { time };
      return p.barColors ? { time, value: v, color: p.barColors[i] } : { time, value: v };
    });
  }

  private sync() {
    const sig = JSON.stringify(this.list);
    if (sig !== this.sig) {
      this.sig = sig;
      this.clear();
      let pane = 0;
      for (const inst of this.list) {
        const def = byId(inst.id);
        const paneIndex = def.overlay ? 0 : ++pane;
        const plots = def.compute(this.bars, inst.inputs);
        const series = plots.map((p, k) => {
          const color = inst.colors[k] ?? def.colors[k] ?? "#888";
          const common = { priceLineVisible: false, title: k === 0 ? def.name : "" };
          const s = p.type === "histogram"
            ? this.chart.addSeries(HistogramSeries, { ...common, color, priceFormat: { type: "volume" } }, paneIndex)
            : this.chart.addSeries(LineSeries, { ...common, color, lineWidth: 1, lastValueVisible: !def.overlay }, paneIndex);
          return s as ISeriesApi<SeriesType>;
        });
        def.levels?.forEach((price) =>
          series[0]?.createPriceLine({ price, color: "#787b86", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" }),
        );
        this.live.push({ inst, series });
      }
    }
    for (const l of this.live) {
      const plots = byId(l.inst.id).compute(this.bars, l.inst.inputs);
      plots.forEach((p, k) => l.series[k]?.setData(this.points(p) as never));
    }
  }
}
