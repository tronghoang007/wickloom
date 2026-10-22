import { TF_SECONDS, fetchBars, fetchBrokerOffset, type Bar } from "@/lib/api";
import type { IChartApi, IPriceLine, ISeriesApi, SeriesType, UTCTimestamp } from "lightweight-charts";
import { byId } from "./catalog";
import { BarHistory, CalendarFeed, HISTORY_BARS } from "./data";
import { planUpdate, type Snap } from "./diff";
import { computeInstance, futureTimes, historyTarget, trimPlot } from "./engine";
import { instanceShown, plotColor, showsPriceLabel, type IndicatorInstance } from "./instance";
import { FillPrimitive, type FillEdge } from "./render/fill";
import { LWC_LINE_STYLE, addAnchorSeries, addPlotSeries, plotOptions } from "./render/series";
import type { IndicatorDef, PlotData } from "./schema";
import { fillShown, fillStyle, levelStyle, plotStyle } from "./style";

type Live = {
  inst: IndicatorInstance;
  def: IndicatorDef;
  series: ISeriesApi<SeriesType>[]; // một series mỗi plot
  anchor: ISeriesApi<SeriesType> | null; // giữ levels + fills
  lines: IPriceLine[]; // theo def.levels
  fills: FillPrimitive[]; // theo def.fills
  snaps: (Snap | null)[];
  data: PlotData[]; // giá trị đã tính (đã cắt theo nến chart) cho legend
  styleKey: string;
  anchorKey: string; // dữ liệu series neo đang giữ (nến đầu + số nến)
};

export type FeedKey = { symbol: string; tf: string };

/** Giá trị 1 plot ở một nến, cho legend. */
export type PlotValue = { id: string; title: string; value: number; color: string };

const DEFAULT_FORMAT = { type: "price" as const, precision: 2, minMove: 0.01 };

// vị trí của `t` trong mảng thời gian tăng dần (-1 nếu không có)
function indexOfTime(times: number[], t: number): number {
  let lo = 0;
  let hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] < t) lo = mid + 1;
    else hi = mid;
  }
  return times[lo] === t ? lo : -1;
}

/** Khoá "cấu trúc" của một instance: đổi khoá = phải dựng lại series (thêm/gỡ indicator, đổi kiểu plot). */
const structKey = (inst: IndicatorInstance): string =>
  `${inst.uid}:${inst.id}:${byId(inst.id).plots.map((p) => plotStyle(inst, p).type).join("/")}`;

export class IndicatorManager {
  private live: Live[] = [];
  private sig = "";
  private bars: Bar[] = [];
  private times: number[] = [];
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

  /** `onSync`: báo sau mỗi lần tính lại để legend đọc giá trị mới. */
  constructor(private chart: IChartApi, private onSync: () => void = () => {}) {}

  // Tính lại tối đa ~4 lần/giây để realtime không tốn CPU
  update(list: IndicatorInstance[], bars: Bar[], feed: FeedKey) {
    this.list = list;
    this.bars = bars;
    this.feed = feed;
    this.schedule();
  }

  /** Giá trị các plot của indicator `uid` ở nến có thời gian `t` (undefined nếu chưa tính / không có nến đó). */
  valuesAt(uid: string, t: number): PlotValue[] | undefined {
    const l = this.live.find((x) => x.inst.uid === uid);
    if (!l) return undefined;
    const i = indexOfTime(this.times, t);
    if (i < 0 || l.data.length === 0) return undefined;
    return l.def.plots.map((p, k) => ({
      id: p.id,
      title: p.title,
      value: l.data[k].values[i] ?? NaN,
      color: l.data[k].colors?.[i] || plotColor(l.inst, l.def, p.id),
    }));
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
    for (const l of this.live) for (const s of [...l.series, ...(l.anchor ? [l.anchor] : [])]) {
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
      const series = def.plots.map((p, k) => addPlotSeries(this.chart, plotStyle(inst, p).type, paneIndex, k === 0 ? def.name : ""));
      const hasAnchor = !!(def.levels?.length || def.fills?.length);
      const anchor = hasAnchor ? addAnchorSeries(this.chart, paneIndex) : null;
      const lines = (def.levels ?? []).map((l) =>
        anchor!.createPriceLine({ price: l.value, color: l.color, lineStyle: LWC_LINE_STYLE[l.lineStyle ?? "dashed"], lineWidth: 1, axisLabelVisible: false, title: "" }),
      );
      const fills = (def.fills ?? []).map(() => {
        const prim = new FillPrimitive();
        anchor!.attachPrimitive(prim);
        return prim;
      });
      this.live.push({ inst, def, series, anchor, lines, fills, snaps: def.plots.map(() => null), data: [], styleKey: "", anchorKey: "" });
    }
  }

  // Phần hiển thị (màu, nét, độ dày, ẩn, nhãn, số chữ số, levels) đổi bằng applyOptions: series giữ nguyên nên xem trước trong Settings không nháy
  private applyStyle(l: Live) {
    const { inst, def } = l;
    const shown = instanceShown(inst, this.feed.tf);
    const plots = def.plots.map((p) => plotStyle(inst, p));
    const levels = (def.levels ?? []).map((lv) => levelStyle(inst, lv));
    const key = JSON.stringify([shown, plots, levels, showsPriceLabel(inst, def), inst.precision ?? null]);
    if (key === l.styleKey) return;
    l.styleKey = key;
    def.plots.forEach((p, k) => {
      const st = plots[k];
      const opts: Record<string, unknown> = { ...plotOptions(st), visible: shown && st.visible, lastValueVisible: showsPriceLabel(inst, def) };
      if (st.type !== "histogram")
        opts.priceFormat = inst.precision === undefined ? DEFAULT_FORMAT : { type: "price", precision: inst.precision, minMove: 10 ** -inst.precision };
      l.series[k].applyOptions(opts);
    });
    l.anchor?.applyOptions({ visible: shown });
    l.lines.forEach((line, k) => {
      const st = levels[k];
      line.applyOptions({ price: st.value, color: st.color, lineWidth: st.width as 1 | 2 | 3 | 4, lineStyle: LWC_LINE_STYLE[st.lineStyle], lineVisible: st.visible });
    });
  }

  private applyFills(l: Live) {
    const { inst, def } = l;
    (def.fills ?? []).forEach((f, k) => {
      if (!fillShown(inst, def, f)) return l.fills[k].set(null);
      const edge = (r: (typeof f.between)[number]): FillEdge => {
        if ("plot" in r) return l.data[def.plots.findIndex((p) => p.id === r.plot)]?.values ?? [];
        const lv = def.levels?.find((x) => x.id === r.level);
        return lv ? levelStyle(inst, lv).value : NaN;
      };
      l.fills[k].set({ a: edge(f.between[0]), b: edge(f.between[1]), color: fillStyle(inst, f).color });
    });
  }

  private point(time: number, d: PlotData, i: number) {
    const v = d.values[i];
    const t = time as UTCTimestamp;
    if (v === undefined || Number.isNaN(v)) return { time: t };
    return d.colors?.[i] ? { time: t, value: v, color: d.colors[i] } : { time: t, value: v };
  }

  private sync() {
    const sig = this.list.map(structKey).join(",");
    if (sig !== this.sig) {
      this.sig = sig;
      this.build();
    }
    if (this.live.length === 0 || this.bars.length === 0) {
      this.onSync();
      return;
    }
    for (const l of this.live) l.inst = this.list.find((i) => i.uid === l.inst.uid) ?? l.inst;

    const { symbol, tf } = this.feed;
    const { all, cut } = this.history.merge(`${symbol}|${tf}`, this.bars);
    this.history.ensure(symbol, tf, this.bars, historyTarget(this.live.map((l) => l.def), this.list, this.bars.length, HISTORY_BARS));
    const cal = this.live.some((l) => l.def.needsCalendar) ? this.calendar.get(symbol) : { offset: 0 };
    const times = this.bars.map((b) => b.t);
    this.times = times;
    const step = TF_SECONDS[tf] ?? 60;

    for (const l of this.live) {
      this.applyStyle(l);
      if (l.def.needsCalendar && !cal) continue; // chưa biết ranh giới phiên: chờ thay vì vẽ sai
      const out = computeInstance(l.def, l.inst, all, cal ?? { offset: 0 });
      l.data = l.def.plots.map((p, k) => {
        const d = trimPlot(out[p.id], cut);
        // offset dương: plot dài hơn nến chart, phần thừa nằm ở vùng tương lai (mốc thời gian suy ra theo khung)
        const ts = d.values.length > times.length ? times.concat(futureTimes(times[times.length - 1], d.values.length - times.length, step)) : times;
        const next: Snap = { times: ts, values: d.values, colors: d.colors };
        const patch = planUpdate(l.snaps[k], next);
        l.snaps[k] = next;
        const s = l.series[k];
        if (patch.kind === "all") s.setData(ts.map((t, i) => this.point(t, d, i)) as never);
        else if (patch.kind === "tail")
          for (let i = patch.from; i < ts.length; i++) s.update(this.point(ts[i], d, i) as never);
        return d;
      });
      // LWC chỉ đổi giá ra toạ độ (price line, priceToCoordinate của fill) khi series có dữ liệu trong vùng đang nhìn:
      // series neo phủ mọi nến với giá trị 0 (không ảnh hưởng thang giá nhờ autoscaleInfoProvider)
      const anchorKey = `${times[0]}:${times.length}`;
      if (l.anchor && l.anchorKey !== anchorKey) {
        l.anchor.setData(times.map((t) => ({ time: t as UTCTimestamp, value: 0 })) as never);
        l.anchorKey = anchorKey;
      }
      this.applyFills(l);
    }
    this.onSync();
  }
}
