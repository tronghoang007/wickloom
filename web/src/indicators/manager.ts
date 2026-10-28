import { TF_SECONDS, fetchBars, fetchBrokerOffset, fetchTickBig, fetchTickFp, fetchTickProfile, fetchTickStat, type Bar } from "@/lib/api";
import type { IChartApi, IPaneApi, IPriceLine, ISeriesApi, SeriesType, Time, UTCTimestamp } from "lightweight-charts";
import { byId } from "./catalog";
import { mergeCandleColors, planCandleColors } from "./candleColors";
import { BarHistory, CalendarFeed, HISTORY_BARS } from "./data";
import { planUpdate, type Snap } from "./diff";
import { computeExtras, computeInstance, futureTimes, historyTarget, trimPlot } from "./engine";
import { instanceShown, plotColor, resolveInputs, showsPriceLabel, type IndicatorInstance } from "./instance";
import { clampSlot, effectiveScale, otherPaneKeys, paneIndices, paneKeyOf } from "./layout";
import { LowerFeed, TICK_TF, capBars, eaBackfill } from "./lower";
import { trimFootprints, trimObjects, trimProfiles } from "./objects";
import { FillPrimitive, type FillEdge } from "./render/fill";
import { FootprintPrimitive } from "./render/footprint";
import { ObjectsPrimitive } from "./render/objects";
import { ProfilePrimitive } from "./render/profile";
import { LWC_LINE_STYLE, addAnchorSeries, addPlotSeries, plotOptions, scaleId } from "./render/series";
import type { IndicatorDef, PlotData, TickSource } from "./schema";
import { fillShown, fillStyle, levelStyle, plotStyle } from "./style";
import { TickBigFeed, TickFpFeed, TickProfileFeed, TickStatFeed, appendLive, coverSig, coversFrom, liveCut, liveFrom, liveHist, mergeLiveBig, mergeLiveFp, type LiveMinute } from "./tickProfile";

type Live = {
  inst: IndicatorInstance;
  def: IndicatorDef;
  series: ISeriesApi<SeriesType>[]; // một series mỗi plot
  anchor: ISeriesApi<SeriesType> | null; // giữ levels + fills
  lines: IPriceLine[]; // theo def.levels
  fills: FillPrimitive[]; // theo def.fills
  objects: ObjectsPrimitive | null; // line/label/box của def.objects
  profiles: ProfilePrimitive | null; // volume profile của def.profiles
  footprints: FootprintPrimitive | null; // footprint của def.footprints
  candleColors: string[] | null; // màu ghi đè nến chart chính (đã cắt theo nến chart), null = không tô
  lastNa: boolean[]; // theo plot: giá trị ở nến cuối là na (không hiện nhãn giá cuối, như TV)
  snaps: (Snap | null)[];
  data: PlotData[]; // giá trị đã tính (đã cắt theo nến chart) cho legend
  styleKey: string;
  anchorKey: string; // dữ liệu series neo đang giữ (nến đầu + số nến)
  memo: Record<string, unknown>; // chỗ indicator nhớ giữa các lần tính (Ctx.memo)
};

/** `end`: Replay đang chạy thì là mốc con trỏ (nến cuối có thể mới chạy dở tới đó): tick / nến khung nhỏ sau mốc này là tương lai, không được tính. */
export type FeedKey = { symbol: string; tf: string; end?: number };

/** Màu ghi đè nến chart chính theo thời gian nến ("" / vắng = màu mặc định) và, nếu chỉ đổi phần cuối, nến đầu tiên cần vẽ lại; `from` null = vẽ lại tất cả. */
export type CandleColorSink = (colors: Map<number, string> | null, from: number | null) => void;

/** Giá trị 1 plot ở một nến, cho legend. Plot candles cho 4 giá trị (O, H, L, C), cùng `plot` = id plot. */
export type PlotValue = { id: string; plot: string; title: string; value: number; color: string };

/** Báo chart chính có indicator footprint đang hiện không (có thì ẩn nến chính đi, footprint tự vẽ nến). */
export type FootprintSink = (on: boolean) => void;

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

/** Khoá "cấu trúc" của cả danh sách: đổi khoá = phải dựng lại series (thêm/gỡ indicator, đổi kiểu plot, chuyển pane/thang giá). */
function structSig(list: IndicatorInstance[], mainSlot: number): string {
  const keys = list.map((i) => paneKeyOf(i, byId(i.id)));
  const slot = clampSlot(mainSlot, otherPaneKeys(keys).length);
  return (
    list
      .map((i, k) => `${i.uid}:${i.id}:${byId(i.id).plots.map((p) => plotStyle(i, p).type).join("/")}@${keys[k]}/${effectiveScale(i, byId(i.id), keys[k])}`)
      .join(",") + `#${slot}`
  );
}

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

  private lower = new LowerFeed((symbol, tf, from, to, limit) => fetchBars(symbol, tf, to, limit, from), () => this.schedule(), {
    backfill: eaBackfill,
  });
  private tickProfiles = new TickProfileFeed((symbol, from, to, lay) => fetchTickProfile(symbol, from, to, lay.lo, lay.size, lay.N), () => this.schedule());
  private tickBig = new TickBigFeed(fetchTickBig, () => this.schedule());
  private tickFp = new TickFpFeed(fetchTickFp, () => this.schedule());
  private tickStat = new TickStatFeed(fetchTickStat, () => this.schedule());
  private liveMinute = new Map<string, LiveMinute[]>(); // symbol -> vài phút tick gần nhất, cuối là phút đang chạy (backend đẩy sau mỗi lô tick)
  private prevColors: string[] | null = null;
  private fpOn = false;

  /** `onSync`: báo sau mỗi lần tính lại để legend đọc giá trị mới. `onCandleColors`: báo khi indicator (Color Candles) đổi màu nến chart. */
  constructor(
    private chart: IChartApi,
    private onSync: () => void = () => {},
    private onCandleColors: CandleColorSink = () => {},
    private getTick: () => number = () => 0,
    private getMainSlot: () => number = () => 0, // số pane riêng nằm trên pane chính
    private getMainPane: () => IPaneApi<Time> | null = () => null, // pane chứa nến chính (để đặt vào đúng vị trí sau khi dựng)
    private onFootprint: FootprintSink = () => {},
  ) {
    chart.timeScale().subscribeVisibleLogicalRangeChange(this.onRange);
  }

  // Kéo / zoom: chỉ indicator phụ thuộc vùng nhìn (Visible Range Volume Profile) cần tính lại; tính lại gộp theo `schedule` (250ms)
  private onRange = () => {
    if (this.live.some((l) => l.def.needsRange)) this.schedule();
  };

  // Tính lại tối đa ~4 lần/giây để realtime không tốn CPU
  update(list: IndicatorInstance[], bars: Bar[], feed: FeedKey) {
    // Đổi symbol/khung: series còn điểm của khung cũ tới lần sync sau (250ms), làm trục thời gian của chart có điểm thừa
    // xen giữa nến mới -> chỉ số logic lệch so với chỉ số nến lúc Chart đặt góc nhìn. Xoá ngay để trục chỉ còn nến.
    if (feed.symbol !== this.feed.symbol || feed.tf !== this.feed.tf) {
      this.wipe();
      for (const l of this.live) l.memo = {}; // những gì indicator nhớ (cặp pool / thống kê của Big Trades...) là của symbol / khung cũ
    }
    // Replay cắt về mốc cũ hơn: series còn điểm của các nến sau mốc cắt tới lần sync sau, rồi co lại làm góc nhìn nhảy về đầu dữ liệu
    // (LWC giữ rightOffset khi nến cuối lùi). Bỏ ngay các điểm đó để trục chỉ còn các nến đã cắt.
    if (bars.length > 0 && this.bars.length > 0 && bars[bars.length - 1].t < this.bars[this.bars.length - 1].t) this.truncate(bars);
    this.list = list;
    this.bars = bars;
    this.feed = feed;
    this.schedule();
  }

  /** Cắt tại chỗ phần đã tính của mọi indicator theo các nến `bars` (đã ngắn đi): giữ nguyên giá trị của các nến còn lại, chỉ bỏ điểm của các nến sau. Khác `wipe`: series không rỗng nên bubble / profile / footprint
   *  (vẽ nhờ series neo) không biến mất trong lúc chờ sync sau, và không phải tính lại khi góc nhìn chưa ổn định. */
  private truncate(bars: Bar[]) {
    const times = bars.map((b) => b.t);
    const last = times[times.length - 1];
    this.times = times;
    for (const l of this.live) {
      l.def.plots.forEach((_, k) => {
        const snap = l.snaps[k];
        const d = l.data[k];
        if (!snap || !d) return;
        let m = snap.times.length;
        while (m > 0 && snap.times[m - 1] > last) m--;
        if (m === snap.times.length) return;
        const nd: PlotData = {
          values: d.values.slice(0, m),
          ...(d.colors ? { colors: d.colors.slice(0, m) } : {}),
          ...(d.candle ? { candle: { o: d.candle.o.slice(0, m), h: d.candle.h.slice(0, m), l: d.candle.l.slice(0, m) } } : {}),
        };
        const ts = snap.times.slice(0, m);
        l.snaps[k] = { times: ts, values: nd.values, ...(snap.colors ? { colors: snap.colors.slice(0, m) } : {}), ...(snap.aux ? { aux: snap.aux.map((a) => a.slice(0, m)) } : {}) };
        l.data[k] = nd;
        l.series[k].setData(ts.map((t, i) => this.point(t, nd, i)) as never);
      });
      if (l.anchor && l.anchorKey) {
        l.anchor.setData(times.map((t) => ({ time: t as UTCTimestamp, value: 0 })) as never);
        l.anchorKey = `${times[0]}:${times.length}`;
      }
    }
  }

  private wipe() {
    for (const l of this.live) {
      for (const s of l.series) s.setData([] as never);
      l.anchor?.setData([] as never);
      // primitive (bubble, profile, footprint) vẫn vẽ dù series rỗng: dữ liệu của khung / symbol cũ không được hiện trên trục mới
      l.objects?.set(null);
      l.profiles?.set(null);
      l.footprints?.set(null);
      l.snaps = l.def.plots.map(() => null);
      l.anchorKey = "";
    }
  }

  /** Backend đổi sang broker / server MT5 khác: bỏ mọi dữ liệu đã nạp (lịch sử nến, lịch, nến khung nhỏ, tick) của nguồn cũ. */
  resetSource() {
    this.history.reset();
    this.calendar.reset();
    this.lower.clear();
    for (const f of [this.tickProfiles, this.tickBig, this.tickFp, this.tickStat]) f.clear();
    this.liveMinute.clear();
    this.wipe();
    for (const l of this.live) l.memo = {};
    this.schedule();
  }

  /** Delta tick realtime từ backend (`tick_delta`): `bars` = nến delta các phút vừa đổi (tăng dần, cuối là phút đang chạy), `cells` = [giá, lên, xuống] của phút đang chạy.
   *  Nến delta vào cache nến khung nhỏ (CVD), ô giá vào phút đang chạy của Volume Profile / Big Trades; chỉ tính lại nếu có indicator dùng tick. */
  onTickDelta(m: { symbol: string; bars: Bar[]; cells: [number, number, number][] }) {
    if (m.bars.length === 0) return;
    const last = m.bars[m.bars.length - 1];
    this.liveMinute.set(m.symbol, appendLive(this.liveMinute.get(m.symbol) ?? [], { t: last.t, cells: m.cells }));
    const pushed = this.lower.push(m.symbol, TICK_TF, m.bars);
    if (m.symbol === this.feed.symbol && (pushed || this.live.some((l) => l.def.ticks))) this.schedule();
  }

  /** Giá trị các plot của indicator `uid` ở nến có thời gian `t` (undefined nếu chưa tính / không có nến đó). */
  valuesAt(uid: string, t: number): PlotValue[] | undefined {
    const l = this.live.find((x) => x.inst.uid === uid);
    if (!l) return undefined;
    const i = indexOfTime(this.times, t);
    if (i < 0 || l.data.length === 0) return undefined;
    const inputs = resolveInputs(l.def, l.inst.inputs);
    return l.def.plots.flatMap((p, k): PlotValue[] => {
      if (p.hidden || (p.showIf && !p.showIf(inputs))) return [];
      const d = l.data[k];
      const c = d.candle;
      if (c) {
        const st = plotStyle(l.inst, p);
        const close = d.values[i] ?? NaN;
        const color = close >= (c.o[i] ?? NaN) ? st.color : st.colorDown;
        return (["o", "h", "l"] as const)
          .map((key): PlotValue => ({ id: `${p.id}.${key}`, plot: p.id, title: key.toUpperCase(), value: c[key][i] ?? NaN, color }))
          .concat({ id: `${p.id}.c`, plot: p.id, title: "C", value: close, color });
      }
      return [{ id: p.id, plot: p.id, title: p.title, value: d.values[i] ?? NaN, color: d.colors?.[i] || plotColor(l.inst, l.def, p.id) }];
    });
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
    try { this.chart.timeScale().unsubscribeVisibleLogicalRangeChange(this.onRange); } catch { /* chart đã bị huỷ */ }
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
    const keys = this.list.map((i) => paneKeyOf(i, byId(i.id)));
    const indices = paneIndices(keys);
    this.list.forEach((inst, n) => {
      const def = byId(inst.id);
      const paneIndex = indices[n];
      const sid = scaleId(effectiveScale(inst, def, keys[n]), inst.uid);
      const series = def.plots.map((p) => addPlotSeries(this.chart, plotStyle(inst, p).type, paneIndex, sid));
      const hasAnchor = !!(def.levels?.length || def.fills?.length || def.objects || def.profiles || def.footprints);
      const anchor = hasAnchor ? addAnchorSeries(this.chart, paneIndex, sid) : null;
      if (sid === "left") this.chart.priceScale("left", paneIndex).applyOptions({ visible: true });
      else if (sid !== "right") this.chart.priceScale(sid, paneIndex).applyOptions({ visible: false, scaleMargins: { top: 0.1, bottom: 0.1 } });
      const lines = (def.levels ?? []).map((l) =>
        anchor!.createPriceLine({ price: l.value, color: l.color, lineStyle: LWC_LINE_STYLE[l.lineStyle ?? "dashed"], lineWidth: 1, axisLabelVisible: false, title: "" }),
      );
      const fills = (def.fills ?? []).map(() => {
        const prim = new FillPrimitive();
        anchor!.attachPrimitive(prim);
        return prim;
      });
      let objects: ObjectsPrimitive | null = null;
      if (def.objects) {
        objects = new ObjectsPrimitive();
        anchor!.attachPrimitive(objects);
      }
      let profiles: ProfilePrimitive | null = null;
      if (def.profiles) {
        profiles = new ProfilePrimitive();
        anchor!.attachPrimitive(profiles);
      }
      let footprints: FootprintPrimitive | null = null;
      if (def.footprints) {
        footprints = new FootprintPrimitive();
        anchor!.attachPrimitive(footprints);
      }
      this.live.push({ inst, def, series, anchor, lines, fills, objects, profiles, footprints, candleColors: null, lastNa: [], snaps: def.plots.map(() => null), data: [], styleKey: "", anchorKey: "", memo: {} });
    });
    // Series trên được dựng với pane chính ở trên cùng (pane riêng 1..n); đặt pane chính vào đúng chỗ giữa các pane riêng
    const main = this.getMainPane();
    const slot = clampSlot(this.getMainSlot(), otherPaneKeys(keys).length);
    try {
      if (main && main.paneIndex() !== slot) main.moveTo(slot);
    } catch { /* chart đã bị huỷ */ }
  }

  // Phần hiển thị (màu, nét, độ dày, ẩn, nhãn, số chữ số, levels) đổi bằng applyOptions: series giữ nguyên nên xem trước trong Settings không nháy
  private applyStyle(l: Live) {
    const { inst, def } = l;
    const shown = instanceShown(inst, this.feed.tf);
    const plots = def.plots.map((p) => plotStyle(inst, p));
    const levels = (def.levels ?? []).map((lv) => levelStyle(inst, lv));
    const inputs = resolveInputs(def, inst.inputs);
    const active = def.plots.map((p) => p.showIf?.(inputs) ?? true);
    const key = JSON.stringify([shown, plots, levels, active, showsPriceLabel(inst, def), inst.precision ?? null, l.lastNa]);
    if (key === l.styleKey) return;
    l.styleKey = key;
    def.plots.forEach((p, k) => {
      const st = plots[k];
      const opts: Record<string, unknown> = { ...plotOptions(st), visible: shown && st.visible && !p.hidden && active[k], lastValueVisible: showsPriceLabel(inst, def) && !p.hidden && !l.lastNa[k] };
      if (st.type !== "histogram") {
        const volume = def.format === "volume";
        opts.priceFormat = volume
          ? { type: "volume", ...(inst.precision === undefined ? {} : { precision: inst.precision }) }
          : inst.precision === undefined ? DEFAULT_FORMAT : { type: "price", precision: inst.precision, minMove: 10 ** -inst.precision };
      }
      l.series[k].applyOptions(opts);
    });
    l.anchor?.applyOptions({ visible: shown });
    l.lines.forEach((line, k) => {
      const st = levels[k];
      line.applyOptions({ price: st.value, color: st.color, lineWidth: st.width as 1 | 2 | 3 | 4, lineStyle: LWC_LINE_STYLE[st.lineStyle], lineVisible: st.visible });
    });
  }

  // LWC vẫn vẽ primitive của series đã ẩn, nên indicator ẩn / ngoài khung hiện thì phải xoá dữ liệu của fill và object
  private applyFills(l: Live, shown: boolean) {
    const { inst, def } = l;
    const inputs = resolveInputs(def, inst.inputs);
    (def.fills ?? []).forEach((f, k) => {
      if (!shown || (f.showIf && !f.showIf(inputs)) || !fillShown(inst, def, f)) return l.fills[k].set(null);
      const edge = (r: (typeof f.between)[number]): FillEdge => {
        if ("plot" in r) return l.data[def.plots.findIndex((p) => p.id === r.plot)]?.values ?? [];
        const lv = def.levels?.find((x) => x.id === r.level);
        return lv ? levelStyle(inst, lv).value : NaN;
      };
      const st = fillStyle(inst, f);
      l.fills[k].set({ a: edge(f.between[0]), b: edge(f.between[1]), color: st.color, ...(f.colorDown ? { colorDown: st.colorDown } : {}) });
    });
  }

  private point(time: number, d: PlotData, i: number) {
    const v = d.values[i];
    const t = time as UTCTimestamp;
    const c = d.candle;
    if (c) {
      const o = c.o[i], h = c.h[i], l = c.l[i];
      if (v === undefined || Number.isNaN(v) || Number.isNaN(o) || Number.isNaN(h) || Number.isNaN(l)) return { time: t };
      return { time: t, open: o, high: h, low: l, close: v };
    }
    if (v === undefined || Number.isNaN(v)) return { time: t };
    return d.colors?.[i] ? { time: t, value: v, color: d.colors[i] } : { time: t, value: v };
  }

  private sync() {
    const sig = structSig(this.list, this.getMainSlot());
    if (sig !== this.sig) {
      this.sig = sig;
      this.build();
    }
    if (this.live.length === 0 || this.bars.length === 0) {
      this.pushCandleColors();
      this.pushFootprint();
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
      const range = l.def.needsRange ? this.visibleRange(cut) : undefined;
      const ticks = this.tickSource(l, all, cut, step, cal ?? { offset: 0 }, range); // trước nến khung nhỏ: tick là nguồn chính, nến chỉ để dự phòng
      const lowerBars = this.lowerBars(l, all, cut, step, cal ?? { offset: 0 }, range);
      const env = { tick: this.getTick(), cut, memo: l.memo, ...(range ? { range } : {}), ...(ticks ? { ticks } : {}) };
      const out = computeInstance(l.def, l.inst, all, cal ?? { offset: 0 }, lowerBars);
      l.data = l.def.plots.map((p, k) => {
        const d = trimPlot(out[p.id], cut);
        // offset dương: plot dài hơn nến chart, phần thừa nằm ở vùng tương lai (mốc thời gian suy ra theo khung)
        const ts = d.values.length > times.length ? times.concat(futureTimes(times[times.length - 1], d.values.length - times.length, step)) : times;
        const next: Snap = { times: ts, values: d.values, colors: d.colors, aux: d.candle ? [d.candle.o, d.candle.h, d.candle.l] : undefined };
        const patch = planUpdate(l.snaps[k], next);
        l.snaps[k] = next;
        const s = l.series[k];
        if (patch.kind === "all") s.setData(ts.map((t, i) => this.point(t, d, i)) as never);
        else if (patch.kind === "tail")
          for (let i = patch.from; i < ts.length; i++) s.update(this.point(ts[i], d, i) as never);
        return d;
      });
      const lastNa = l.data.map((d) => Number.isNaN(d.values[times.length - 1] ?? NaN));
      if (lastNa.some((x, k) => x !== !!l.lastNa[k])) {
        l.lastNa = lastNa;
        this.applyStyle(l);
      }
      // LWC chỉ đổi giá ra toạ độ (price line, priceToCoordinate của fill) khi series có dữ liệu trong vùng đang nhìn:
      // series neo phủ mọi nến với giá trị 0 (không ảnh hưởng thang giá nhờ autoscaleInfoProvider)
      const anchorKey = `${times[0]}:${times.length}`;
      if (l.anchor && l.anchorKey !== anchorKey) {
        l.anchor.setData(times.map((t) => ({ time: t as UTCTimestamp, value: 0 })) as never);
        l.anchorKey = anchorKey;
      }
      const shown = instanceShown(l.inst, tf);
      this.applyFills(l, shown);
      if (l.objects || l.profiles || l.footprints || l.def.candleColors) {
        const ex = shown ? computeExtras(l.def, l.inst, all, cal ?? { offset: 0 }, lowerBars, env) : { objects: null, candleColors: null, profiles: null, footprints: null };
        l.objects?.set(ex.objects ? trimObjects(ex.objects, cut) : null);
        l.profiles?.set(ex.profiles ? trimProfiles(ex.profiles, cut) : null);
        l.footprints?.set(ex.footprints ? trimFootprints(ex.footprints, cut) : null);
        l.candleColors = ex.candleColors ? ex.candleColors.slice(cut) : null;
      }
    }
    this.pushCandleColors();
    this.pushFootprint();
    this.onSync();
  }

  private pushFootprint() {
    const on = this.live.some((l) => l.footprints && instanceShown(l.inst, this.feed.tf));
    if (on === this.fpOn) return;
    this.fpOn = on;
    this.onFootprint(on);
  }

  /** Vùng đang nhìn thấy theo chỉ số trong `all` (chart bắt đầu ở `cut`); undefined nếu chưa biết. */
  private visibleRange(cut: number): { from: number; to: number } | undefined {
    const r = this.chart.timeScale().getVisibleLogicalRange();
    if (!r || this.bars.length === 0) return undefined;
    const n = this.bars.length;
    // vùng nhìn có thể nằm hẳn trong phần tương lai (plot có offset dương / Ichimoku thêm điểm sau nến cuối): kẹp cả hai đầu vào các nến
    const to = Math.max(0, Math.min(n - 1, Math.ceil(r.to)));
    return { from: cut + Math.min(to, Math.max(0, Math.floor(r.from))), to: cut + to };
  }

  /** Hết dữ liệu ở đâu: cuối nến chart cuối, hoặc mốc con trỏ Replay nếu sớm hơn (nến cuối mới chạy dở). */
  private dataEnd(step: number): number {
    const end = this.bars[this.bars.length - 1].t + step;
    return this.feed.end === undefined ? end : Math.min(end, this.feed.end);
  }

  /** Nến khung nhỏ mà indicator cần (đã nạp tới đâu có tới đó; phần còn lại nạp ngầm rồi tính lại). */
  private lowerBars(l: Live, all: Bar[], cut: number, step: number, calendar: { offset: number; dayOpens?: number[] }, range?: { from: number; to: number }): Bar[] {
    if (!l.def.lower) return [];
    const need = l.def.lower(resolveInputs(l.def, l.inst.inputs), { bars: all, cut, step, calendar, ...(range ? { range } : {}) });
    if (!need) return [];
    const to = this.bars[this.bars.length - 1].t + step;
    return capBars(this.lower.get(this.feed.symbol, need, to), this.dataEnd(step));
  }

  /** Tick cho volume profile "1 tick": nạp nến delta tick (EA gửi lịch sử tick) rồi cấp histogram giá theo row cho từng profile. */
  private tickSource(l: Live, all: Bar[], cut: number, step: number, calendar: { offset: number; dayOpens?: number[] }, range?: { from: number; to: number }): TickSource | undefined {
    if (!l.def.ticks) return undefined;
    const need = l.def.ticks(resolveInputs(l.def, l.inst.inputs), { bars: all, cut, step, calendar, ...(range ? { range } : {}) });
    if (!need) return undefined;
    const { symbol } = this.feed;
    const cover = this.lower.get(symbol, { tfs: [TICK_TF], from: need.from }, this.bars[this.bars.length - 1].t + step);
    const lives = this.liveMinute.get(symbol) ?? [];
    const newest = lives[lives.length - 1];
    // Replay: mọi khoảng hỏi tick dừng ở con trỏ (indicator tự tính tới cuối nến cuối, hoặc xa hơn như khối thống kê của Big Trades)
    const replay = this.feed.end !== undefined;
    const E = replay ? this.dataEnd(step) : Infinity;
    return {
      covered: (t0) => coversFrom(cover, t0),
      hist: (t0, t1, lay) => liveHist(this.tickProfiles, symbol, cover, lives, t0, Math.min(t1, E), lay, replay),
      big: (t0, t1, min, limit, size) => {
        t1 = Math.min(t1, E);
        if (t1 <= t0) return [];
        const cut = liveCut(newest, t0, t1);
        const cells = this.tickBig.get(symbol, t0, t1, min, limit, size, `${cut}:${coverSig(cover, t0, cut)}`, cut);
        return cells && mergeLiveBig(cells, liveFrom(lives, this.tickBig.heldUpTo(symbol, t0, t1, min, limit, size) ?? cut, t0, t1), min, limit, size);
      },
      stat: (t0, t1, size) => {
        t1 = Math.min(t1, E);
        if (t1 <= t0) return { n: 0, sum: 0, sumsq: 0 };
        const cut = liveCut(newest, t0, t1);
        return this.tickStat.get(symbol, t0, t1, size, `${cut}:${coverSig(cover, t0, cut)}`, cut, replay);
      },
      fp: (bars, end, size) => {
        end = Math.min(end, E);
        const cut = liveCut(newest, bars[0], end);
        const cells = this.tickFp.get(symbol, bars, end, size, `${cut}:${bars.length}:${coverSig(cover, bars[0], cut)}`, cut, step);
        return cells && mergeLiveFp(cells, liveFrom(lives, this.tickFp.heldUpTo(symbol, bars, size, step) ?? cut, bars[0], end), bars, end, size);
      },
    };
  }

  // Color Candles: gộp màu của các indicator đang hiện rồi báo chart chính tô lại phần đã đổi
  private pushCandleColors() {
    const shown = this.live.filter((l) => instanceShown(l.inst, this.feed.tf));
    const next = mergeCandleColors(shown.map((l) => l.candleColors));
    const patch = planCandleColors(this.prevColors, next);
    this.prevColors = next;
    if (patch.kind === "none") return;
    const map = next ? new Map(this.times.map((t, i) => [t, next[i] ?? ""] as const)) : null;
    this.onCandleColors(map, patch.kind === "tail" ? this.times[patch.from] ?? null : null);
  }
}
