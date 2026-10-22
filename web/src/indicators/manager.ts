import { fetchBars, fetchBrokerOffset, type Bar } from "@/lib/api";
import {
    HistogramSeries,
    LineSeries,
    LineStyle,
    type IChartApi,
    type ISeriesApi,
    type SeriesType,
    type UTCTimestamp,
} from "lightweight-charts";
import { byId } from "./catalog";
import { BarHistory, CalendarFeed, HISTORY_BARS } from "./data";
import { planUpdate, type Snap } from "./diff";
import { computeInstance, historyTarget, trimPlot } from "./engine";
import { plotColor, type IndicatorInstance } from "./instance";
import type { IndicatorDef, PlotData } from "./schema";

type Live = { inst: IndicatorInstance; def: IndicatorDef; series: ISeriesApi<SeriesType>[]; snaps: (Snap | null)[] };

export type FeedKey = { symbol: string; tf: string };

export class IndicatorManager {
  private live: Live[] = [];
  private sig = "";
  private bars: Bar[] = [];
  private list: IndicatorInstance[] = [];
  private feed: FeedKey = { symbol: "", tf: "" };
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private history = new BarHistory((symbol, tf, to, limit) => fetchBars(symbol, tf, to, limit), () => this.schedule());
  private calendar = new CalendarFeed(
    {
      offset: fetchBrokerOffset,
      dayOpens: async (symbol) => (await fetchBars(symbol, "D1", undefined, 5000)).map((b) => b.t),
    },
    () => this.schedule(),
  );

  constructor(private chart: IChartApi) {}

  // Tính lại tối đa ~4 lần/giây để realtime không tốn CPU
  update(list: IndicatorInstance[], bars: Bar[], feed: FeedKey) {
    this.list = list;
    this.bars = bars;
    this.feed = feed;
    this.schedule();
  }

  private schedule() {
    if (this.timer || this.destroyed) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.sync();
    }, 250);
  }

  destroy() {
    this.destroyed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private clear() {
    for (const l of this.live) for (const s of l.series) {
      try { this.chart.removeSeries(s); } catch { /* chart đã bị huỷ */ }
    }
    this.live = [];
  }

  private build() {
    this.clear();
    let pane = 0;
    for (const inst of this.list) {
      const def = byId(inst.id);
      const paneIndex = def.overlay ? 0 : ++pane;
      const series = def.plots.map((p, k) => {
        const color = plotColor(inst, def, p.id);
        const common = { priceLineVisible: false, title: k === 0 ? def.name : "" };
        const s = p.type === "histogram"
          ? this.chart.addSeries(HistogramSeries, { ...common, color, priceFormat: { type: "volume" } }, paneIndex)
          : this.chart.addSeries(LineSeries, { ...common, color, lineWidth: 1, lastValueVisible: !def.overlay }, paneIndex);
        return s as ISeriesApi<SeriesType>;
      });
      def.levels?.forEach((price) =>
        series[0]?.createPriceLine({ price, color: "#787b86", lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" }),
      );
      this.live.push({ inst, def, series, snaps: def.plots.map(() => null) });
    }
  }

  private point(time: number, d: PlotData, i: number) {
    const v = d.values[i];
    const t = time as UTCTimestamp;
    if (v === undefined || Number.isNaN(v)) return { time: t };
    return d.colors ? { time: t, value: v, color: d.colors[i] } : { time: t, value: v };
  }

  private sync() {
    const sig = JSON.stringify(this.list);
    if (sig !== this.sig) {
      this.sig = sig;
      this.build();
    }
    if (this.live.length === 0 || this.bars.length === 0) return;

    const { symbol, tf } = this.feed;
    const { all, cut } = this.history.merge(`${symbol}|${tf}`, this.bars);
    this.history.ensure(symbol, tf, this.bars, historyTarget(this.live.map((l) => l.def), this.list, this.bars.length, HISTORY_BARS));
    const cal = this.live.some((l) => l.def.needsCalendar) ? this.calendar.get(symbol) : { offset: 0 };
    const times = this.bars.map((b) => b.t);

    for (const l of this.live) {
      if (l.def.needsCalendar && !cal) continue; // chưa biết ranh giới phiên: chờ thay vì vẽ sai
      const out = computeInstance(l.def, l.inst, all, cal ?? { offset: 0 });
      l.def.plots.forEach((p, k) => {
        const d = trimPlot(out[p.id], cut);
        const next: Snap = { times, values: d.values, colors: d.colors };
        const patch = planUpdate(l.snaps[k], next);
        l.snaps[k] = next;
        const s = l.series[k];
        if (patch.kind === "all") s.setData(times.map((t, i) => this.point(t, d, i)) as never);
        else if (patch.kind === "tail")
          for (let i = patch.from; i < times.length; i++) s.update(this.point(times[i], d, i) as never);
      });
    }
  }
}
