"use client";

import { DrawingManager } from "@/drawings/manager";
import { AlertI, Chevron, ResetViewI, SettingsI, SkipToLatest } from "../icons";
import { useDrawingStore } from "@/drawings/store";
import { overridePoint } from "@/indicators/candleColors";
import { IndicatorManager } from "@/indicators/manager";

import { TF_SECONDS, WS_URL, fetchBars, fetchSymbols, triggerBackfillAt, type Bar } from "@/lib/api";
import { SPEEDS, exitReplay } from "@/replay/store";
import { useChartStore } from "@/store/chart";
import { isActivePane, useLayoutStore } from "@/store/layout";
import { usePaneState } from "@/store/compose";
import type { ChartType, ScaleMode, VolumeSettings } from "@/store/paneStores";
import { createLineDrag, type ChartDrag } from "@/trading/chartOrders";
import type { DragPreview } from "@/trading/format";
import { useQuoteStore } from "@/trading/quote";
import { useReplaySim } from "@/trading/replaySim";
import { barIndexAt, indexAt, isSyncedRange, registerPaneView, syncCrosshair, syncRange, syncTime, timeAt, type PaneView } from "@/store/paneSync";
import { CHART_THEMES, useSettingsStore, type ChartSettings } from "@/store/settings";
import { clockLabel, crosshairLabel, tickLabel } from "@/lib/timefmt";
import { fmtVol, volColor, volDigits, volMaAt, volMaData, volMaShown, volShown, volUp } from "@/store/volume";
import {
  AreaSeries,
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  PriceScaleMode,
  createChart,
  type IChartApi,
  type IPriceLine,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
} from "react";
import CalendarMarkers from "./CalendarMarkers";
import ChartContextMenu, { type MenuItem } from "./ChartContextMenu";
import { drawingMenuItems } from "./drawingMenu";
import FavoritesBar from "./FavoritesBar";
import InlineTextEditor from "./InlineTextEditor";
import ReplayBar from "./ReplayBar";
import { SymbolBadge } from "../SymbolIcon";
import StylePanel from "./StylePanel";
import TradeOverlay from "./TradeOverlay";
import TimezoneMenu from "./TimezoneMenu";
import TradeWidget from "./TradeWidget";
import { tradeMenuItems } from "./tradeMenu";
import IndicatorLegend from "./IndicatorLegend";
import { indicatorMenuItems } from "./indicatorMenu";
import VolumeLegend, { volumeMenuItems } from "./VolumeLegend";
import { heikinAshi } from "./transform";


type Fmt = { precision: number };

// Màu nến/bar + nhãn giá cuối theo Settings (Symbol / Scales and lines).
function seriesStyle(cs: ChartSettings, type: ChartType) {
  const label = {
    // Nhãn giá cuối tự vẽ (xem effect "last price label") nên tắt nhãn của lightweight-charts.
    lastValueVisible: false,
    priceLineVisible: cs.symbolLabel === "value_line" || cs.symbolLabel === "line",
  };
  if (type === "bars") return { ...label, upColor: cs.bodyUp, downColor: cs.bodyDown };
  if (type === "line" || type === "area") return label;
  const clear = "rgba(0,0,0,0)";
  return {
    ...label,
    upColor: cs.body ? cs.bodyUp : clear,
    downColor: cs.body ? cs.bodyDown : clear,
    borderVisible: cs.borders,
    borderUpColor: cs.borderUp,
    borderDownColor: cs.borderDown,
    wickVisible: cs.wick,
    wickUpColor: cs.wickUp,
    wickDownColor: cs.wickDown,
  };
}

function createSeries(
  chart: IChartApi,
  type: ChartType,
  f: Fmt,
): ISeriesApi<SeriesType> {
  const priceFormat = {
    type: "price" as const,
    precision: f.precision,
    minMove: 10 ** -f.precision,
  };
  const style = seriesStyle(useSettingsStore.getState().s, type);
  switch (type) {
    case "bars":
      return chart.addSeries(BarSeries, { ...style, priceFormat });
    case "line":
      return chart.addSeries(LineSeries, {
        ...style,
        color: "#2962ff",
        lineWidth: 2,
        priceFormat,
      });
    case "area":
      return chart.addSeries(AreaSeries, {
        ...style,
        lineColor: "#2962ff",
        topColor: "rgba(41,98,255,0.4)",
        bottomColor: "rgba(41,98,255,0)",
        priceFormat,
      });
    default:
      return chart.addSeries(CandlestickSeries, { ...style, priceFormat });
  }
}

/** Nến tăng/giảm: so với giá mở (mặc định) hoặc giá đóng nến trước ("Color bars based on
 *  previous close"). */
function isUp(b: Bar, prevC: number | undefined, cs: ChartSettings) {
  return cs.colorByPrevClose && prevC !== undefined ? b.c >= prevC : b.c >= b.o;
}

/** `color`: màu ghi đè của indicator Color Candles (nếu có) cho nến này. */
function toPoint(b: Bar, type: ChartType, prevC?: number, color?: string) {
  const p = basePoint(b, type, prevC);
  return color ? overridePoint(p, type, color, useSettingsStore.getState().s.body) : p;
}

function basePoint(b: Bar, type: ChartType, prevC?: number) {
  const time = b.t as UTCTimestamp;
  if (type === "line" || type === "area") return { time, value: b.c };
  const point = { time, open: b.o, high: b.h, low: b.l, close: b.c };
  const cs = useSettingsStore.getState().s;
  if (!cs.colorByPrevClose || prevC === undefined) return point;
  const up = isUp(b, prevC, cs);
  if (type === "bars") return { ...point, color: up ? cs.bodyUp : cs.bodyDown };
  const clear = "rgba(0,0,0,0)";
  return {
    ...point,
    color: cs.body ? (up ? cs.bodyUp : cs.bodyDown) : clear,
    borderColor: up ? cs.borderUp : cs.borderDown,
    wickColor: up ? cs.wickUp : cs.wickDown,
  };
}

const volPoint = (b: Bar, prevC: number | undefined, vs: VolumeSettings) => {
  const cs = useSettingsStore.getState().s;
  return { time: b.t as UTCTimestamp, value: b.v, color: volColor(vs, cs, volUp(b, prevC, vs)) };
};

function fmtCountdown(sec: number) {
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

// Giá trên legend có dấu phẩy ngàn như TradingView: 4,131.155
const fmtPrice = (n: number, d: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });

// Nhãn khung thời gian trên legend của TV: phút là số trần ("15"), còn lại "1h", "1D"...
function tfLegend(tf: string) {
  const sec = TF_SECONDS[tf];
  if (tf === "MN1") return "1M";
  if (tf === "W1") return "1W";
  if (sec >= 86400) return `${sec / 86400}D`;
  if (sec >= 3600) return `${sec / 3600}h`;
  return String(sec / 60);
}

const RANGES: { label: string; secs: number | "ytd" | "all" }[] = [
  { label: "1D", secs: 86400 },
  { label: "5D", secs: 5 * 86400 },
  { label: "1M", secs: 30 * 86400 },
  { label: "3M", secs: 91 * 86400 },
  { label: "6M", secs: 182 * 86400 },
  { label: "YTD", secs: "ytd" },
  { label: "1Y", secs: 365 * 86400 },
  { label: "All", secs: "all" },
];

type Legend = { bar: Bar; prev: number | null };

// Khoảng cách giữa 2 nến liền kề lớn hơn mức này = cache backend có lỗ (không phải
// cuối tuần/nghỉ lễ) -> phải hỏi EA trước khi vẽ đoạn cũ hơn.
const gapLimit = (tf: string) => Math.max(5 * 86400, 3 * TF_SECONDS[tf]);

// Bar cũ hơn `firstT` lấy từ DB dùng được nếu nối liền với `firstT`, hoặc EA đã trả lời
// backfill neo đúng mốc này (khoảng trống là thật trên MT5).
const olderUsable = (
  older: Bar[],
  firstT: number,
  tf: string,
  req: { t: number; done: boolean } | null,
) =>
  older.length > 0 &&
  (firstT - older[older.length - 1].t <= gapLimit(tf) ||
    (req?.t === firstT && req.done));

// Góc nhìn lúc mới tải: bề rộng mỗi nến cố định như TV (~6px, đo từ layout TV), không theo số nến,
// nên chart rộng thì thấy nhiều nến hơn thay vì nến phình to.
const DEFAULT_BAR_SPACING = 6;
function defaultRange(chart: IChartApi, n: number) {
  const right = useSettingsStore.getState().s.rightOffset;
  const visible = chart.timeScale().width() / DEFAULT_BAR_SPACING;
  return { from: Math.max(0, n - 1 + right - visible), to: n - 1 + right };
}

// "Reset chart view" (⌥R): về đúng góc nhìn lúc mới tải, auto-scale giá.
function resetChartView(chart: IChartApi | null, n: number) {
  if (!chart || !n) return;
  chart.priceScale("right").setAutoScale(true);
  chart.timeScale().setVisibleLogicalRange(defaultRange(chart, n));
}

function setTabTitle(title: string) {
  if (document.title !== title) document.title = title;
}

// Nến mới nạp (từ DB) ghi đè nến cũ cùng mốc - trừ nến cuối `liveT` đang chạy realtime
// (WS mới là nguồn đúng nhất của nó). Nến trước đó có thể là bản gom dở đã được EA sửa lại.
function mergeBars(cur: Bar[], add: Bar[], liveT: number) {
  const m = new Map(cur.map((b) => [b.t, b]));
  for (const b of add) if (!m.has(b.t) || b.t < liveT) m.set(b.t, b);
  return [...m.values()].sort((a, b) => a.t - b.t);
}

export default function Chart({ paneId }: { paneId: string }) {
  // Chart gắn thẳng vào store của pane mình (không qua facade "pane đang active" của UI ngoài)
  const pane = useLayoutStore((s) => s.panes[paneId]);
  const isActive = useLayoutStore((s) => s.activeId === paneId); // thanh nổi (style, favorites, soạn text) chỉ hiện ở chart active
  const { symbol, tf, chartType, scaleMode } = usePaneState(pane.chart);
  const theme = useChartStore((s) => s.theme);
  const symDigits = useChartStore(
    (s) => s.symbols.find((x) => x.name === symbol)?.digits ?? 5,
  );
  const cs = useSettingsStore((s) => s.s);
  const symbolDesc = useChartStore(
    (s) => s.symbols.find((x) => x.name === symbol)?.description ?? "",
  );
  const symType = useChartStore((s) => s.symbols.find((x) => x.name === symbol)?.type);
  const broker = useChartStore((s) => {
    const b = s.symbols.find((x) => x.name === symbol)?.broker;
    return b ? b.split(" ")[0] : "";
  });
  const digits = cs.precision ?? symDigits;
  const boxRef = useRef<HTMLDivElement>(null);
  const hoverRef = useRef(false); // chuột đang ở trong chart này (nguồn của "Sync crosshair")
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const volMaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const barsRef = useRef<Bar[]>([]);
  const typeRef = useRef<ChartType>(chartType);
  const digitsRef = useRef(digits);
  const loadingRef = useRef(false);
  const exhaustedRef = useRef(false);
  const backfillRef = useRef<{ t: number; at: number; done: boolean } | null>(null);
  const prevCloseRef = useRef<number | null>(null);
  const linesRef = useRef<Partial<Record<"prev" | "hi" | "lo" | "bid" | "ask", IPriceLine>>>({});
  const tickRef = useRef<{ bid: number; ask: number } | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const drawingCount = usePaneState(pane.draw, (s) => s.drawings.length);
  const indRef = useRef<IndicatorManager | null>(null);
  const candleColorRef = useRef<Map<number, string> | null>(null); // màu nến do indicator Color Candles ghi đè, theo thời gian nến
  const drawRef = useRef<DrawingManager | null>(null);
  const indicators = usePaneState(pane.indicators, (s) => s.list);
  const removeIndicator = pane.indicators.getState().remove;
  const legendCollapsed = usePaneState(pane.indicators, (s) => s.collapsed);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [countdown, setCountdown] = useState("");
  const lblRef = useRef<HTMLDivElement>(null);
  const lblBoxRef = useRef<HTMLDivElement>(null);
  const lblPriceRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("");
  const [showLatestButton, setShowLatestButton] = useState(false);
  const [clock, setClock] = useState("");
  const fullRef = useRef<Bar[]>([]);
  const m1Ref = useRef<Bar[]>([]);
  const cursorRef = useRef(0);
  const prevSymbolRef = useRef(symbol);
  const wasActiveRef = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [, setIndVer] = useState(0); // indicator vừa tính lại: render lại để legend đọc giá trị mới
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    idx: number;
    label: string;
  } | null>(null);
  const selecting = usePaneState(pane.replay, (s) => s.selecting);
  const replayActive = usePaneState(pane.replay, (s) => s.active);
  // Thoát Replay (hoặc chart bị gỡ): xoá vị thế giả lập của pane này
  useEffect(() => {
    if (!replayActive) useReplaySim.getState().reset(paneId);
  }, [replayActive, paneId]);
  const playing = usePaneState(pane.replay, (s) => s.playing);
  const speed = usePaneState(pane.replay, (s) => s.speed);
  const interval = usePaneState(pane.replay, (s) => s.interval);

  const legendAt = (i: number): Legend | null => {
    const bars = barsRef.current;
    return bars[i] ? { bar: bars[i], prev: bars[i - 1]?.c ?? null } : null;
  };

  const display = () =>
    typeRef.current === "heikin"
      ? heikinAshi(barsRef.current)
      : barsRef.current;
  // Histogram volume + đường MA của nó (cùng thang "vol")
  const renderVol = () => {
    const bars = barsRef.current;
    const vs = pane.volume.getState().s;
    volRef.current?.setData(bars.map((b, i, a) => volPoint(b, a[i - 1]?.c, vs)));
    volMaRef.current?.setData(volMaData(bars, vs.maLength));
  };
  const updateVol = (bars: Bar[], i: number) => {
    const vs = pane.volume.getState().s;
    volRef.current?.update(volPoint(bars[i], bars[i - 1]?.c, vs));
    const ma = volMaAt(bars, i, vs.maLength);
    if (ma !== null) volMaRef.current?.update({ time: bars[i].t as UTCTimestamp, value: ma });
  };
  const render = () => {
    const cur = barsRef.current;
    if (cur.some((b, i) => i > 0 && b.t <= cur[i - 1].t)) {
      const byTime = new Map(cur.map((b) => [b.t, b]));
      barsRef.current = [...byTime.values()].sort((a, b) => a.t - b.t);
    }
    seriesRef.current?.setData(
      display().map((b, i, a) => toPoint(b, typeRef.current, a[i - 1]?.c, candleColorRef.current?.get(b.t))) as never,
    );
    renderVol();
    updateTitle();
  };

  // Tiêu đề tab kiểu TradingView: "XAUUSDm 4,122.741 ▼ −0.05%" (% so với giá đóng cửa
  // phiên D1 trước).
  const updateTitle = () => {
    if (!isActivePane(paneId)) return; // tiêu đề tab theo chart đang active
    const { symbols } = useChartStore.getState();
    const sym = pane.chart.getState().symbol;
    const last = barsRef.current[barsRef.current.length - 1];
    let title = "Wickloom";
    if (last) {
      const d = symbols.find((x) => x.name === sym)?.digits ?? digitsRef.current;
      title = `${sym} ${last.c.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
      const prev = prevCloseRef.current;
      if (prev) {
        const pct = ((last.c - prev) / prev) * 100;
        title += ` ${pct >= 0 ? "▲ +" : "▼ −"}${Math.abs(pct).toFixed(2)}%`;
      }
    }
    setTabTitle(title);
  };

  // Đường giá phụ (Settings › Scales and lines): đóng cửa phiên trước, cao/thấp vùng đang
  // xem, bid/ask. Chỉ đọc ref + store -> gọi được từ handler/subscription bất kỳ.
  const updateLines = () => {
    const series = seriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart) return;
    const st = useSettingsStore.getState().s;
    const line = (key: keyof typeof linesRef.current, price: number | null, color: string, title: string) => {
      const cur = linesRef.current[key];
      if (price === null || !Number.isFinite(price)) {
        if (cur) series.removePriceLine(cur);
        delete linesRef.current[key];
        return;
      }
      const opts = { price, color, title, lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: true };
      if (cur) cur.applyOptions(opts);
      else linesRef.current[key] = series.createPriceLine(opts);
    };
    line("prev", st.prevDayClose === "value_line" ? prevCloseRef.current : null, st.prevDayCloseColor, "");
    let hi: number | null = null;
    let lo: number | null = null;
    const bars = barsRef.current;
    const r = chart.timeScale().getVisibleLogicalRange();
    if (st.highLow === "value_line" && r && bars.length) {
      const a = Math.max(0, Math.floor(r.from));
      const b = Math.min(bars.length - 1, Math.ceil(r.to));
      for (let i = a; i <= b; i++) {
        hi = hi === null ? bars[i].h : Math.max(hi, bars[i].h);
        lo = lo === null ? bars[i].l : Math.min(lo, bars[i].l);
      }
    }
    line("hi", hi, st.highLowColor, "H");
    line("lo", lo, st.highLowColor, "L");
    const tick = st.bidAsk === "value_line" ? tickRef.current : null;
    line("bid", tick?.bid || null, st.bidColor, "Bid");
    line("ask", tick?.ask || null, st.askColor, "Ask");
  };

  const refreshExtras = () => {
    const { symbol, tf } = pane.chart.getState();
    indRef.current?.update(pane.indicators.getState().list, barsRef.current, { symbol, tf });
    drawRef.current?.refresh();
  };

  const setRange = (secs: number | "ytd" | "all") => {
    const bars = barsRef.current;
    const chart = chartRef.current;
    if (!chart || bars.length === 0) return;
    if (secs === "all") return chart.timeScale().fitContent();
    const last = bars[bars.length - 1].t;
    const from =
      secs === "ytd"
        ? Date.UTC(new Date(last * 1000).getUTCFullYear(), 0, 1) / 1000
        : last - secs;
    const idx = Math.max(
      0,
      bars.findIndex((b) => b.t >= from),
    );
    chart
      .timeScale()
      .setVisibleLogicalRange({ from: idx, to: bars.length - 1 + useSettingsStore.getState().s.rightOffset });
  };

  // --- replay ---
  const buildVisible = (cursorT: number): Bar[] => {
    const full = fullRef.current;
    const tfs = TF_SECONDS[pane.chart.getState().tf];
    let n = 0;
    while (n < full.length && full[n].t + tfs <= cursorT) n++;
    const out = full.slice(0, n);
    const next = full[n];
    if (next && next.t < cursorT) {
      const m = m1Ref.current.filter((x) => x.t >= next.t && x.t < cursorT);
      out.push(
        m.length
          ? {
              t: next.t,
              o: m[0].o,
              h: Math.max(...m.map((x) => x.h)),
              l: Math.min(...m.map((x) => x.l)),
              c: m[m.length - 1].c,
              v: m.reduce((s, x) => s + x.v, 0),
            }
          : next,
      );
    }
    return out;
  };

  const applyVisible = (vis: Bar[]) => {
    const old = barsRef.current;
    barsRef.current = vis;
    const incremental =
      old.length > 0 &&
      typeRef.current !== "heikin" &&
      vis.length - old.length >= 0 &&
      vis.length - old.length <= 1 &&
      vis[old.length - 1]?.t === old[old.length - 1].t;
    if (incremental) {
      for (let i = old.length - 1; i < vis.length; i++) {
        seriesRef.current?.update(toPoint(vis[i], typeRef.current, vis[i - 1]?.c, candleColorRef.current?.get(vis[i].t)) as never);
        updateVol(vis, i);
      }
    } else render();
    refreshExtras();
    setLegend(legendAt(vis.length - 1));
    const last = vis[vis.length - 1];
    if (last && pane.replay.getState().active) useReplaySim.getState().ingest(paneId, pane.chart.getState().symbol, last); // nến replay mới: giá khớp lệnh + kiểm tra SL / TP giả lập
  };

  const wantM1 = () => {
    const iv = pane.replay.getState().interval;
    return !!iv && TF_SECONDS[iv] < TF_SECONDS[pane.chart.getState().tf];
  };

  const loadM1 = async (from: number) => {
    m1Ref.current = await fetchBars(
      pane.chart.getState().symbol,
      "M1",
      undefined,
      50000,
      from,
    );
  };

  const stepReplay = (): boolean => {
    const st = pane.replay.getState();
    if (!st.active) return false;
    const tfs = TF_SECONDS[pane.chart.getState().tf];
    let t = cursorRef.current;
    if (!wantM1() || m1Ref.current.length === 0) {
      const next = fullRef.current.find((b) => b.t + tfs > t);
      if (!next) return false;
      t = next.t + tfs;
    } else {
      const m = m1Ref.current.find((x) => x.t >= t);
      if (!m) return false;
      t = Math.max(t, m.t) + TF_SECONDS[st.interval];
    }
    cursorRef.current = t;
    applyVisible(buildVisible(t));
    return true;
  };

  const startReplay = async (idx: number) => {
    const bars = barsRef.current;
    const b = bars[idx];
    if (!b) return;
    if (!pane.replay.getState().active) fullRef.current = [...bars];
    cursorRef.current = b.t + TF_SECONDS[pane.chart.getState().tf];
    pane.replay.setState({ selecting: false, active: true, playing: false });
    setHover(null);
    if (wantM1()) await loadM1(b.t);
    applyVisible(buildVisible(cursorRef.current));
  };

  const onSelectMove = (e: RMouseEvent<HTMLDivElement>) => {
    const ts = chartRef.current?.timeScale();
    const bars = barsRef.current;
    if (!ts || bars.length === 0) return;
    const r = e.currentTarget.getBoundingClientRect();
    const l = ts.coordinateToLogical(e.clientX - r.left);
    if (l === null) return;
    const idx = Math.max(0, Math.min(bars.length - 1, Math.round(l)));
    const x = ts.logicalToCoordinate(idx as never) ?? e.clientX - r.left;
    setHover({
      x,
      y: e.clientY - r.top,
      idx,
      label: `Re: ${crosshairLabel(bars[idx].t)}`,
    });
  };

  // chart instance
  useEffect(() => {
    const chart = createChart(boxRef.current!, {
      autoSize: true,
      // Logo TradingView trên chart tắt, không còn dòng "Charts by TradingView" ở thanh dưới (theo ý chủ app); ghi công theo giấy phép lightweight-charts
      // nằm ở Settings > Symbol (cuối trang). Attribution notice:
      // TradingView Lightweight Charts™ Copyright (c) TradingView, Inc. https://www.tradingview.com/
      layout: { fontSize: 12, attributionLogo: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { style: LineStyle.Dashed, width: 1 },
        horzLine: { style: LineStyle.Dashed, width: 1 },
      },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.25 } },
      localization: { timeFormatter: (t: number) => crosshairLabel(t) },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
        // Lăn chuột zoom ngang lấy mép phải làm gốc (như TradingView), không theo con trỏ.
        rightBarStaysOnScroll: true,
        tickMarkFormatter: (t: number, type: number) => tickLabel(t, type),
      },
    });
    chartRef.current = chart;

    // Wheel over the price axis pans prices; over the time axis pans time.
    const box = boxRef.current!;
    const onAxisWheel = (e: WheelEvent) => {
      const r = box.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const paneW = chart.timeScale().width();
      const paneH = r.height - chart.timeScale().height();
      if (x > paneW && y < paneH) {
        const s = seriesRef.current;
        const bars = barsRef.current;
        const scale = chart.priceScale("right");
        const range = scale.getVisibleRange();
        if (!s || !bars.length || !range) return;
        const { from: bottom, to: top } = range;
        const paneHeight = chart.paneSize(0).height;
        const anchor = s.coordinateToPrice(
          Math.max(0, Math.min(paneHeight, y)),
        );
        if (anchor == null) return;
        e.preventDefault();
        e.stopPropagation();
        const span = top - bottom;
        const dataLow = Math.min(...bars.map((bar) => bar.l));
        const dataHigh = Math.max(...bars.map((bar) => bar.h));
        const symbolInfo = useChartStore
          .getState()
          .symbols.find(
            (item) => item.name === pane.chart.getState().symbol,
          );
        const minSpan = Math.max(
          symbolInfo?.tick_size ?? 10 ** -digitsRef.current,
          span * 0.0001,
        );
        const maxSpan = Math.max(span, (dataHigh - dataLow) * 4);
        const factor = Math.exp(
          Math.max(-300, Math.min(300, e.deltaY)) * 0.001,
        );
        const nextSpan = Math.max(minSpan, Math.min(maxSpan, span * factor));
        const ratio = nextSpan / span;
        const nextBottom = anchor - (anchor - bottom) * ratio;
        const nextTop = anchor + (top - anchor) * ratio;
        scale.setAutoScale(false);
        scale.setVisibleRange({ from: nextBottom, to: nextTop });
      } else if (x <= paneW && y >= paneH) {
        e.preventDefault();
        e.stopPropagation();
        const ts = chart.timeScale();
        const range = ts.getVisibleLogicalRange();
        if (!range) return;
        const anchor = range.to; // zoom lấy mép phải làm gốc, như lăn chuột trên vùng chart
        const delta =
          Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        const span = range.to - range.from;
        const factor = Math.exp(Math.max(-300, Math.min(300, delta)) * 0.001);
        const nextSpan = Math.max(
          2,
          Math.min(barsRef.current.length * 2, span * factor),
        );
        const ratio = nextSpan / span;
        ts.setVisibleLogicalRange({
          from: anchor - (anchor - range.from) * ratio,
          to: anchor + (range.to - anchor) * ratio,
        });
      }
    };
    box.addEventListener("wheel", onAxisWheel, {
      capture: true,
      passive: false,
    });

    volRef.current = chart.addSeries(HistogramSeries, {
      priceScaleId: "vol",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    volMaRef.current = chart.addSeries(LineSeries, {
      priceScaleId: "vol",
      lineWidth: 1,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chart
      .priceScale("vol")
      .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    indRef.current = new IndicatorManager(
      chart,
      () => setIndVer((n) => n + 1),
      (colors, from) => {
        candleColorRef.current = colors;
        const bars = display();
        // from = null: dựng lại cả series; không thì chỉ vẽ lại các nến từ mốc đó (nến cuối đổi màu theo tick)
        const start = from === null ? 0 : bars.findIndex((b) => b.t >= from);
        if (start < 0) return;
        const pts = bars.slice(start).map((b, k) => toPoint(b, typeRef.current, bars[start + k - 1]?.c, colors?.get(b.t)));
        if (from === null) seriesRef.current?.setData(pts as never);
        else for (const pt of pts) seriesRef.current?.update(pt as never);
      },
      () =>
        useChartStore
          .getState()
          .symbols.find((item) => item.name === pane.chart.getState().symbol)
          ?.tick_size ?? 10 ** -digitsRef.current,
    );
    drawRef.current = new DrawingManager({
      pane,
      chart,
      container: boxRef.current!,
      getBars: () => barsRef.current,
      getDisplayBars: display,
      getTf: () => pane.chart.getState().tf,
      getDigits: () => digitsRef.current,
      getTickSize: () =>
        useChartStore
          .getState()
          .symbols.find((item) => item.name === pane.chart.getState().symbol)
          ?.tick_size ?? 10 ** -digitsRef.current,
    });

    // Góc nhìn + crosshair của chart này cho "Sync in layout" (store/paneSync.ts). Thời gian là đơn vị chung giữa các khung.
    const tfSec = () => TF_SECONDS[pane.chart.getState().tf];
    let remoteCross = false; // đang vẽ crosshair do chart khác đẩy sang (ẩn đường ngang, vì không có giá của con trỏ)
    let remoteT: number | null = null; // thời gian của crosshair đó: LWC giữ nó theo pixel nên phải vẽ lại sau khi góc nhìn dời
    const setHorz = (on: boolean) => chart.applyOptions({ crosshair: { horzLine: { visible: on, labelVisible: on } } });
    const endRemoteCross = () => {
      remoteT = null;
      if (!remoteCross) return;
      remoteCross = false;
      setHorz(true);
    };
    const setCross = (t: number | null) => {
      const bars = barsRef.current;
      const series = seriesRef.current;
      let i = t === null || !series ? -1 : barIndexAt(bars, tfSec(), t);
      // LWC kẹp crosshair vào mép khi nến nằm ngoài vùng đang hiện (nhãn giờ sai) → coi như không có
      const vis = chart.timeScale().getVisibleLogicalRange();
      if (i >= 0 && (!vis || i < Math.ceil(vis.from) || i > Math.floor(vis.to))) i = -1;
      if (i < 0) {
        if (remoteCross) {
          chart.clearCrosshairPosition();
          endRemoteCross();
          setLegend(legendAt(bars.length - 1));
        }
        remoteT = t; // vẫn nhớ để vẽ lại khi góc nhìn dời tới đó
        return;
      }
      remoteT = t;
      if (!remoteCross) {
        remoteCross = true;
        setHorz(false);
      }
      chart.setCrosshairPosition(bars[i].c, bars[i].t as UTCTimestamp, series!);
      setLegend(legendAt(i));
    };
    const view: PaneView = {
      getRange: () => {
        const r = chart.timeScale().getVisibleLogicalRange();
        const bars = barsRef.current;
        if (!r || !bars.length) return null;
        const from = timeAt(bars, tfSec(), r.from);
        const to = timeAt(bars, tfSec(), r.to);
        return from === null || to === null ? null : { from, to, lf: r.from, lt: r.to };
      },
      setRange: (to, from) => {
        const ts = chart.timeScale();
        const cur = ts.getVisibleLogicalRange();
        const bars = barsRef.current;
        if (!cur || !bars.length) return null;
        const lt = indexAt(bars, tfSec(), to);
        const lf = indexAt(bars, tfSec(), from);
        if (lt === null || lf === null || !(lt - lf > 0.5)) return null;
        if (Math.abs(lt - cur.to) > 1e-4 || Math.abs(lf - cur.from) > 1e-4) {
          ts.setVisibleLogicalRange({ from: lf, to: lt });
          if (remoteT !== null) setCross(remoteT);
        }
        const after = ts.getVisibleLogicalRange();
        return after && { lf: after.from, lt: after.to };
      },
      showTime: (t, frac) => {
        const ts = chart.timeScale();
        const cur = ts.getVisibleLogicalRange();
        const bars = barsRef.current;
        if (!cur || !bars.length) return null;
        const idx = indexAt(bars, tfSec(), t);
        if (idx === null) return null;
        const span = cur.to - cur.from;
        const lf = idx - frac * span;
        if (Math.abs(lf - cur.from) > 1e-4) {
          ts.setVisibleLogicalRange({ from: lf, to: lf + span });
          if (remoteT !== null) setCross(remoteT);
        }
        const after = ts.getVisibleLogicalRange();
        return after && { lf: after.from, lt: after.to };
      },
      setCrosshair: setCross,
      hovered: () => hoverRef.current,
    };
    const unregisterView = registerPaneView(paneId, view);
    const onEnter = () => {
      hoverRef.current = true;
      endRemoteCross(); // chuột vào: crosshair của chính chart này (đủ cả đường ngang) thay cho crosshair từ chart khác
    };
    const onLeave = () => {
      hoverRef.current = false;
    };
    box.addEventListener("mouseenter", onEnter);
    box.addEventListener("mouseleave", onLeave);

    // "Sync in layout › Time": bấm vào chart thì các chart khác cuộn tới đúng thời điểm của cây nến vừa bấm, cùng vị trí ngang
    chart.subscribeClick((p) => {
      const ts = chart.timeScale();
      const w = ts.width();
      if (!p.point || w <= 0 || p.point.x < 0 || p.point.x > w) return;
      const idx = ts.coordinateToLogical(p.point.x);
      const bars = barsRef.current;
      if (idx === null || !bars.length) return;
      const i = Math.round(idx);
      const t = timeAt(bars, tfSec(), i);
      const x = ts.logicalToCoordinate(i as never);
      if (t !== null && x !== null) syncTime(paneId, t, x / w);
    });

    chart.subscribeCrosshairMove((p) => {
      const bars = barsRef.current;
      // "Sync in layout › Crosshair": rời chart thì luôn báo để xoá, còn vị trí chỉ báo khi chuột đang ở chart này
      if (!p.time) syncCrosshair(paneId, null);
      else if (hoverRef.current) syncCrosshair(paneId, p.time as number);
      if (!p.time || bars.length === 0)
        return setLegend(legendAt(bars.length - 1));
      let lo = 0,
        hi = bars.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].t < (p.time as number)) lo = mid + 1;
        else hi = mid;
      }
      setLegend(legendAt(lo));
    });

    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      updateLines();
      const bars = barsRef.current;
      const awayFromLatest =
        !!range && bars.length > 0 && range.to < bars.length - 1;
      setShowLatestButton(
        awayFromLatest && !pane.replay.getState().selecting,
      );
      if (range) syncRange(paneId); // "Sync in layout › Time / Date range"
      if (remoteT !== null) setCross(remoteT); // crosshair do chart khác đẩy sang: vẽ lại theo thời gian khi góc nhìn dời (LWC giữ theo pixel)
      if (
        !range ||
        range.from > 50 ||
        isSyncedRange(paneId, { lf: range.from, lt: range.to }) || // góc nhìn do đồng bộ đặt: để trống, không đi tải thêm

        loadingRef.current ||
        exhaustedRef.current ||
        pane.replay.getState().active
      )
        return;
      const first = barsRef.current[0];
      if (!first) return;
      loadingRef.current = true;
      const curSym = pane.chart.getState().symbol;
      const curTf = pane.chart.getState().tf;
      const key = `${curSym}|${curTf}`;
      fetchBars(
        curSym,
        curTf,
        first.t,
        500,
      )
        .then(async (older) => {
          if (
            key !==
              `${pane.chart.getState().symbol}|${pane.chart.getState().tf}` ||
            barsRef.current[0] !== first // "bars_loaded" đã ghép đoạn này trước
          )
            return;
          if (olderUsable(older, first.t, curTf, backfillRef.current)) {
            const vis = chart.timeScale().getVisibleLogicalRange();
            barsRef.current = [...older, ...barsRef.current];
            render();
            refreshExtras();
            if (vis)
              chart.timeScale().setVisibleLogicalRange({
                from: vis.from + older.length,
                to: vis.to + older.length,
              });
          } else {
            // Database backend hết (hoặc có lỗ ngay trước `first`) -> gọi MT5 backfill
            // tiếp, neo theo thời gian của nến cũ nhất (không theo index: cache có thể hở
            // so với nến mới nhất của MT5 nên `pos` bị lệch). Mỗi mốc chỉ xin 1 lần rồi chờ
            // "bars_loaded" (EA offline thì backend xếp hàng, gửi khi EA kết nối lại).
            const pending = backfillRef.current;
            if (pending && pending.t === first.t && Date.now() - pending.at < 30000) return;
            backfillRef.current = { t: first.t, at: Date.now(), done: false };
            try {
              const res = await triggerBackfillAt(curSym, curTf, 500, first.t);
              if (!res.ok) {
                exhaustedRef.current = true;
              }
            } catch {
              exhaustedRef.current = true;
            }
          }
        })
        .finally(() => {
          loadingRef.current = false;
        });
    });

    return () => {
      unregisterView();
      box.removeEventListener("mouseenter", onEnter);
      box.removeEventListener("mouseleave", onLeave);
      box.removeEventListener("wheel", onAxisWheel, { capture: true });
      drawRef.current?.destroy();
      indRef.current?.destroy();
      drawRef.current = null;
      indRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
      volMaRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme + Canvas/Scales settings
  useEffect(() => {
    const t = CHART_THEMES[theme];
    const grid = cs.gridColor ?? t.grid;
    const cross = cs.crosshairColor ?? t.crosshair;
    const border = cs.scaleLineColor ?? t.grid;
    chartRef.current?.applyOptions({
      layout: {
        background:
          cs.bgType === "gradient"
            ? { type: ColorType.VerticalGradient, topColor: cs.bg ?? t.bg, bottomColor: cs.bg2 ?? t.bg }
            : { type: ColorType.Solid, color: cs.bg ?? t.bg },
        textColor: cs.scaleTextColor ?? t.text,
        fontSize: cs.fontSize,
      },
      grid: {
        vertLines: { visible: cs.vertGrid, color: grid, style: LineStyle.Dotted },
        horzLines: { visible: cs.horzGrid, color: grid, style: LineStyle.Dotted },
      },
      rightPriceScale: {
        borderColor: border,
        scaleMargins: { top: cs.marginTop / 100, bottom: cs.marginBottom / 100 },
      },
      timeScale: {
        borderColor: border,
        rightOffset: cs.rightOffset,
        // hàm mới mỗi lần -> chart vẽ lại nhãn khi đổi timezone/date format
        tickMarkFormatter: (time: number, type: number) => tickLabel(time, type),
      },
      localization: { timeFormatter: (time: number) => crosshairLabel(time) },
      crosshair: {
        vertLine: { color: cross, labelBackgroundColor: t.label },
        horzLine: { color: cross, labelBackgroundColor: t.label },
      },
    });
  }, [theme, cs]);

  // Symbol settings: màu nến, nhãn/đường giá cuối, các đường giá phụ
  useEffect(() => {
    seriesRef.current?.applyOptions(seriesStyle(cs, chartType));
    render();
    updateLines();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cs, chartType]);

  // Volume theo Settings riêng của nó (hiện/ẩn, nhãn trục, độ chính xác, màu, MA); chỉnh là áp ngay
  const vs = usePaneState(pane.volume, (st) => st.s);
  useEffect(() => {
    volRef.current?.applyOptions({
      visible: volShown(vs, tf),
      lastValueVisible: vs.priceLabel,
      priceFormat: { type: "volume", precision: volDigits(vs) },
    });
    volMaRef.current?.applyOptions({ visible: volMaShown(vs, tf), color: vs.maColor });
    renderVol();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vs, tf, cs.bodyUp, cs.bodyDown]);

  // cursor mode + screenshot
  const cursor = useDrawingStore((s) => s.cursor);
  useEffect(() => {
    chartRef.current?.applyOptions({
      crosshair: {
        mode: cursor === "arrow" ? CrosshairMode.Hidden : CrosshairMode.Normal,
      },
    });
  }, [cursor]);

  useEffect(() => {
    const shot = () => {
      if (!isActivePane(paneId)) return; // chụp chart đang active
      const canvas = chartRef.current?.takeScreenshot();
      canvas?.toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `${pane.chart.getState().symbol}-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    };
    window.addEventListener("tv-screenshot", shot);
    return () => window.removeEventListener("tv-screenshot", shot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // price scale mode
  useEffect(() => {
    const mode = {
      normal: PriceScaleMode.Normal,
      log: PriceScaleMode.Logarithmic,
      percent: PriceScaleMode.Percentage,
    }[scaleMode];
    chartRef.current?.priceScale("right").applyOptions({ mode });
  }, [scaleMode]);

  // series type
  useEffect(() => {
    digitsRef.current = digits;
    const chart = chartRef.current!;
    if (seriesRef.current) chart.removeSeries(seriesRef.current);
    linesRef.current = {}; // price line thuộc series cũ đã bị xoá cùng series
    typeRef.current = chartType;
    seriesRef.current = createSeries(chart, chartType, {
      precision: digitsRef.current,
    });
    drawRef.current?.attachTo(seriesRef.current);
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType]);

  // Vị thế / lệnh chờ / bản nháp lệnh trên symbol này: đường giá + thẻ kéo thả kiểu TradingView do <TradeOverlay /> vẽ (docs/trade-plan.md T3-T4)
  const [dragPreview, setDragPreview] = useState<DragPreview[]>([]); // đường giao dịch đang kéo / chờ xác nhận
  const lineDragRef = useRef<ChartDrag | null>(null);
  const getChart = useCallback(() => chartRef.current, []);
  const getSeries = useCallback(() => seriesRef.current, []);
  const getDigits = useCallback(() => digitsRef.current, []);
  const getBars = useCallback(() => barsRef.current, []);

  // Kéo các đường giao dịch (lệnh chờ, entry/SL/TP của bảng đặt lệnh): nghe chuột ở phần tử bao quanh chart, trước DrawingManager
  useEffect(() => {
    const chart = chartRef.current;
    const box = boxRef.current;
    if (!chart || !box?.parentElement) return;
    const drag = createLineDrag({
      chart,
      container: box,
      listenOn: box.parentElement,
      getSeries: () => seriesRef.current,
      getSymbol: () => pane.chart.getState().symbol,
      getDigits: () => digitsRef.current,
      isReplay: () => pane.replay.getState().active,
      paneId,
      setPreview: setDragPreview,
    });
    lineDragRef.current = drag;
    return () => {
      drag.destroy();
      lineDragRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // price precision
  useEffect(() => {
    digitsRef.current = digits;
    seriesRef.current?.applyOptions({
      priceFormat: { type: "price", precision: digits, minMove: 10 ** -digits },
    });
  }, [digits, chartType]);

  // symbol/tf change resets replay settings
  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      exitReplay(pane.replay);
    }
    pane.replay.setState({ interval: "" });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf]);

  // leaving replay reloads live data
  useEffect(() => {
    if (wasActiveRef.current && !replayActive) setReloadTick((n) => n + 1);
    wasActiveRef.current = replayActive;
  }, [replayActive]);

  // play loop
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      if (!stepReplay()) pane.replay.setState({ playing: false });
    }, SPEEDS[speed]);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed]);

  // changing the update interval
  useEffect(() => {
    if (!pane.replay.getState().active) return;
    (async () => {
      if (wantM1())
        await loadM1(
          cursorRef.current - TF_SECONDS[pane.chart.getState().tf],
        );
      applyVisible(buildVisible(cursorRef.current));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval]);

  // ⌥R = Reset chart view (e.code: trên macOS Option+R ra ký tự "®")
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isActivePane(paneId)) return;
      const el = e.target as HTMLElement;
      if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
      if (e.altKey && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.code === "KeyR") {
        e.preventDefault();
        resetChartView(chartRef.current, barsRef.current.length);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Esc cancels bar selection
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") pane.replay.setState({ selecting: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selecting]);

  // giá đóng cửa phiên D1 trước cho % thay đổi trên tiêu đề tab
  useEffect(() => {
    let alive = true;
    prevCloseRef.current = null;
    updateLines();
    const loadPrev = () =>
      fetchBars(symbol, "D1", undefined, 2)
        .then((d) => {
          if (!alive || d.length === 0) return;
          const hasToday = d[d.length - 1].t + 86400 > Date.now() / 1000;
          prevCloseRef.current = hasToday ? (d[d.length - 2]?.c ?? null) : d[d.length - 1].c;
          updateTitle();
          updateLines();
        })
        .catch(() => {});
    loadPrev();
    const id = setInterval(loadPrev, 10 * 60 * 1000); // qua ngày mới
    return () => {
      alive = false;
      clearInterval(id);
      if (isActivePane(paneId)) setTabTitle("Wickloom");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol]);

  // đổi chart active -> tiêu đề tab đổi theo chart mới
  useEffect(
    () =>
      useLayoutStore.subscribe((s, prev) => {
        if (s.activeId !== prev.activeId && s.activeId === paneId) updateTitle();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paneId],
  );

  // data + realtime
  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let pollTimer: ReturnType<typeof setTimeout>;
    barsRef.current = [];
    exhaustedRef.current = false;
    backfillRef.current = null;
    tickRef.current = null;
    render();
    drawRef.current?.setSymbol(symbol);
    refreshExtras();

    const load = async () => {
      const replayActiveNow = pane.replay.getState().active;
      // Đang replay (đã "cắt" tại 1 mốc thời gian) -> đổi symbol/tf vẫn phải neo đúng
      // mốc đó, không load "mới nhất" của tf mới.
      const anchor = replayActiveNow ? cursorRef.current : undefined;
      const bars = await fetchBars(symbol, tf, anchor);
      if (!alive) return;
      if (replayActiveNow) {
        fullRef.current = bars;
        if (bars.length === 0) {
          // tf này chưa có cache tới mốc cắt -> xin EA nạp thêm, chờ "bars_loaded" rồi
          // load() sẽ tự chạy lại (xem ws.onmessage bên dưới).
          triggerBackfillAt(symbol, tf, 500, anchor).catch(() => {});
        }
        if (wantM1()) await loadM1(cursorRef.current - TF_SECONDS[tf]);
        if (!alive) return;
        applyVisible(buildVisible(cursorRef.current));
        return;
      }
      barsRef.current = bars;
      setLegend(legendAt(bars.length - 1));
      // Đổi account/loại account (vd Standard "XAUUSDm" -> Pro "XAUUSD"): symbol không còn
      // trong danh sách EA gửi -> báo rõ thay vì chờ mãi.
      const known = useChartStore.getState().symbols;
      const missing = !bars.length && known.length > 0 && !known.some((s) => s.name === symbol);
      setStatus(
        bars.length
          ? ""
          : missing
            ? `${symbol} không có trên account MT5 hiện tại - chọn symbol khác`
            : "Đang chờ dữ liệu từ MT5…",
      );
      render();
      refreshExtras();
      chartRef.current?.priceScale("right").setAutoScale(true);
      if (bars.length) {
        if (chartRef.current) chartRef.current.timeScale().setVisibleLogicalRange(defaultRange(chartRef.current, bars.length));
      } else {
        clearTimeout(pollTimer);
        pollTimer = setTimeout(load, missing ? 5000 : 800);
      }
    };
    load();

    const upsert = (b: Bar) => {
      const arr = barsRef.current;
      const last = arr[arr.length - 1];
      if (last && last.t === b.t) arr[arr.length - 1] = b;
      else if (!last || last.t < b.t) arr.push(b);
      else return;
      if (typeRef.current === "heikin") render();
      else seriesRef.current?.update(toPoint(b, typeRef.current, arr[arr.length - 2]?.c, candleColorRef.current?.get(b.t)) as never);
      updateVol(arr, arr.length - 1);
      updateLines();
      refreshExtras();
      updateTitle();
      setLegend((cur) =>
        cur && cur.bar.t !== b.t && cur.bar !== last
          ? cur
          : legendAt(arr.length - 1),
      );
    };

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () =>
        ws!.send(JSON.stringify({ action: "subscribe", symbol, tf }));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "reset") {
          // Backend đổi sang broker/server MT5 khác: bar trong bộ nhớ là của nguồn cũ ->
          // bỏ hết, tải lại từ đầu (không ghép với dữ liệu của nguồn mới).
          barsRef.current = [];
          exhaustedRef.current = false;
          backfillRef.current = null;
          render();
          refreshExtras();
          fetchSymbols()
            .then((symbols) => useChartStore.getState().set({ symbols }))
            .catch(() => {});
          load();
          return;
        }
        if (m.symbol !== symbol) return;
        if (m.type === "bars_loaded" && m.tf === tf) {
          if (pane.replay.getState().active) {
            // EA vừa nạp xong đoạn thiếu cho mốc cắt hiện tại -> load() lại để fill
            // fullRef.current/áp dụng visible range đúng mốc.
            load();
            return;
          }
          if (barsRef.current.length === 0) {
            load();
          } else {
            const first = barsRef.current[0];
            const last = barsRef.current[barsRef.current.length - 1];
            const req = backfillRef.current;
            if (req && req.t === first.t) req.done = true;
            // EA vừa nạp: có thể là đoạn cũ hơn (scroll-back) hoặc đoạn mới hơn (catch-up
            // sau khi EA/backend tắt) -> lấy cả 2 phía.
            Promise.all([
              fetchBars(symbol, tf, undefined, 50000, last.t - 3 * TF_SECONDS[tf]),
              fetchBars(symbol, tf, first.t, 500),
            ]).then(([newer, older]) => {
              if (!alive || barsRef.current[0] !== first) return;
              if (newer.length >= 50000) {
                load(); // catch-up quá dài để ghép -> tải lại từ mới nhất
                return;
              }
              const useOlder = olderUsable(older, first.t, tf, backfillRef.current);
              const have = new Map(barsRef.current.map((b) => [b.t, b]));
              const added = newer.some((b) => {
                const old = have.get(b.t);
                return b.t > last.t || (b.t < last.t && old && (old.o !== b.o || old.h !== b.h || old.l !== b.l || old.c !== b.c));
              });
              if (!useOlder && !added) return;
              const vis = chartRef.current?.timeScale().getVisibleLogicalRange();
              const merged = mergeBars(barsRef.current, newer, last.t);
              barsRef.current = useOlder ? [...older, ...merged] : merged;
              render();
              refreshExtras();
              if (useOlder && vis && chartRef.current) {
                chartRef.current.timeScale().setVisibleLogicalRange({
                  from: vis.from + older.length,
                  to: vis.to + older.length,
                });
              }
            });
          }
        }
        else if (pane.replay.getState().active) {
          // Đang replay: bỏ qua realtime (bar_update/bar_close/tick), chỉ xử lý
          // bars_loaded ở trên.
        }
        else if (
          (m.type === "bar_update" || m.type === "bar_close") &&
          m.tf === tf
        ) {
          if (barsRef.current.length === 0) setStatus("");
          upsert(m.bar);
        } else if (m.type === "tick_delta" && m.symbol === symbol) {
          indRef.current?.onTickDelta(m);
          drawRef.current?.onTickDelta(m);
        } else if (m.type === "tick" && m.symbol === symbol) {
          tickRef.current = { bid: m.bid, ask: m.ask };
          useQuoteStore.getState().set(symbol, m.bid, m.ask);
          const price = m.bid || m.last;
          if (price > 0 && barsRef.current.length > 0) {
            const last = barsRef.current[barsRef.current.length - 1];
            if (last) {
              const updated = {
                ...last,
                c: price,
                h: Math.max(last.h, price),
                l: Math.min(last.l, price),
              };
              upsert(updated);
            }
          }
        }
      };
      ws.onclose = () => {
        if (alive) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      alive = false;
      clearTimeout(retry);
      clearTimeout(pollTimer);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, tf, reloadTick]);

  // indicators
  useEffect(() => {
    refreshExtras();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indicators]);

  // Nhãn giá cuối trên trục giá như TradingView: khối liền (giá + đếm ngược đóng nến bên dưới),
  // chữ canh trái. Thay hẳn nhãn của lightweight-charts (chữ canh giữa, không nối được với đếm
  // ngược), nên series đặt lastValueVisible=false. Kích thước đo từ canvas TV: khối rộng
  // = trục − 6 (cách mép trái 1px), chữ cách mép 9px, bo 3px bên phải, hàng giá cao fontSize+4,
  // hàng đếm ngược fontSize+3. Theo sát giá khi kéo/zoom trục -> cập nhật mỗi frame, chỉ đụng
  // style/textContent (không setState).
  useEffect(() => {
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const el = lblRef.current;
      const box = lblBoxRef.current;
      const txt = lblPriceRef.current;
      const chart = chartRef.current;
      const series = seriesRef.current;
      const bars = barsRef.current;
      const last = bars[bars.length - 1];
      const st = useSettingsStore.getState().s;
      const shown = st.symbolLabel === "value_line" || st.symbolLabel === "value";
      const y = shown && series && last ? series.priceToCoordinate(last.c) : null;
      if (!el || !box || !txt || !chart || y === null || !last) {
        if (el) el.style.display = "none";
        return;
      }
      const scale = chart.priceScale("right");
      const up = isUp(last, bars[bars.length - 2]?.c, st);
      const priceH = st.fontSize + 4;
      const total = priceH + (box.childElementCount > 1 ? st.fontSize + 3 : 0);
      const paneH = chart.paneSize(0).height;
      let top = y - priceH / 2;
      if (paneH > total) top = Math.min(Math.max(top, 0), paneH - total);

      // Chế độ % của trục: nhãn là % so với giá đóng của nến đầu tiên đang thấy (như lightweight-charts).
      let text: string;
      if (pane.chart.getState().scaleMode === "percent") {
        const from = Math.max(0, Math.ceil(chart.timeScale().getVisibleLogicalRange()?.from ?? 0));
        const base = (bars[Math.min(from, bars.length - 1)] ?? last).c;
        text = `${(((last.c - base) / Math.abs(base)) * 100).toFixed(2)}%`;
      } else {
        text = series!.priceFormatter().format(last.c);
      }
      if (txt.textContent !== text) txt.textContent = text;

      el.style.display = "block";
      el.style.width = `${scale.width()}px`;
      el.style.transform = `translateY(${Math.round(top)}px)`;
      box.style.width = `${scale.width() - 6}px`;
      box.style.background = up ? st.bodyUp : st.bodyDown;
      box.style.fontSize = `${st.fontSize}px`;
      txt.style.height = `${priceH}px`;
      const cd = box.children[1] as HTMLElement | undefined;
      if (cd) cd.style.height = `${st.fontSize + 3}px`;
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // countdown + clock
  useEffect(() => {
    const id = setInterval(() => {
      const last = barsRef.current[barsRef.current.length - 1];
      const now = Date.now();
      if (!last || tf === "MN1") setCountdown("");
      else {
        const left = last.t + TF_SECONDS[tf] - Math.floor(now / 1000);
        setCountdown(left > 0 ? fmtCountdown(left) : "");
      }
      setClock(clockLabel(now));
    }, 1000);
    return () => clearInterval(id);
  }, [tf]);

  const L = legend?.bar;
  const up = L ? isUp(L, legend.prev ?? undefined, cs) : true;
  const color = up ? cs.bodyUp : cs.bodyDown;
  const chg = L && legend.prev !== null ? L.c - legend.prev : null;
  const d = digits;
  const scaleBtn = (m: ScaleMode, label: string) => (
    <button
      key={m}
      onClick={() => pane.chart.setState({ scaleMode: scaleMode === m ? "normal" : m })}
      className={`rounded px-1.5 py-0.5 hover:bg-[var(--hover)] ${scaleMode === m ? "text-[var(--accent)]" : ""}`}
    >
      {label}
    </button>
  );

  const resetView = () => resetChartView(chartRef.current, barsRef.current.length);

  const onChartContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const chart = chartRef.current;
    const box = boxRef.current;
    if (!chart || !box) return;
    const r = box.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    if (x > chart.timeScale().width() || y > r.height - chart.timeScale().height()) return; // trục giá/thời gian
    // Chuột phải lên hình: chọn hình và hiện menu riêng của hình (như TV), không phải menu chart
    const hit = drawRef.current?.pickAt(e.nativeEvent);
    if (drawRef.current && hit) {
      setCtxMenu({ x: e.clientX, y: e.clientY, items: drawingMenuItems(drawRef.current, hit, tf) });
      return;
    }
    // Chuột phải lên cột volume: menu của indicator Volume (như TV)
    if (volShown(pane.volume.getState().s, tf)) {
      const logical = chart.timeScale().coordinateToLogical(x);
      const bar = logical === null ? undefined : barsRef.current[Math.round(logical)];
      const top = bar ? volRef.current?.priceToCoordinate(bar.v) : null;
      if (top != null && y >= top) {
        setCtxMenu({ x: e.clientX, y: e.clientY, items: volumeMenuItems(tf) });
        return;
      }
    }
    setCtxMenu({ x: e.clientX, y: e.clientY, items: menuItems(seriesRef.current?.coordinateToPrice(y) ?? null) });
  };

  const menuItems = (price: number | null): MenuItem[] => {
    const p =
      price === null
        ? ""
        : price.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
    const last = barsRef.current[barsRef.current.length - 1]?.c;
    const items: MenuItem[] = [
      { label: "Reset chart view", icon: <ResetViewI />, shortcut: "⌥ R", onSelect: resetView },
      "sep",
      {
        label: `Copy price ${p}`,
        disabled: price === null,
        onSelect: () => navigator.clipboard?.writeText(p.replace(/,/g, "")).catch(() => {}),
      },
      { label: "Paste", shortcut: "⌘ V", disabled: true },
      "sep",
      { label: `Add alert on ${symbol} at ${p}`, icon: <AlertI />, shortcut: "⌥ A", disabled: true },
      ...tradeMenuItems(symbol, price, digits, last, replayActive),
      "sep",
      { label: "Lock vertical cursor line by time", disabled: true },
      "sep",
      { label: "Table view", disabled: true },
      { label: "Object tree", disabled: true },
      { label: "Chart template", submenu: true, disabled: true },
    ];
    const removals: MenuItem[] = [];
    if (drawingCount > 0)
      removals.push({
        label: `Remove ${drawingCount} drawing${drawingCount > 1 ? "s" : ""}`,
        onSelect: () => drawRef.current?.clearAll(), // ⌘Z để hoàn tác
      });
    if (indicators.length > 0)
      removals.push({
        label: `Remove ${indicators.length} indicator${indicators.length > 1 ? "s" : ""}`,
        onSelect: () => pane.indicators.setState({ list: [] }),
      });
    if (removals.length) items.push("sep", ...removals);
    items.push("sep", {
      label: "Settings…",
      icon: <SettingsI />,
      onSelect: () => useSettingsStore.setState({ open: true }),
    });
    return items;
  };

  return (
    <div
      className="flex h-full w-full flex-col"
      // bấm vào chart nào thì chart đó active TRƯỚC khi DrawingManager xử lý, để công cụ đang chọn vẽ đúng chart vừa bấm
      onPointerDownCapture={() => useLayoutStore.getState().setActive(paneId)}
    >
      <div className="relative min-h-0 flex-1 overflow-hidden" onContextMenu={onChartContextMenu}>
        <div ref={boxRef} className="h-full w-full" />
        <TradeOverlay
          paneId={paneId}
          symbol={symbol}
          chartType={chartType}
          replay={replayActive}
          preview={dragPreview}
          getChart={getChart}
          getSeries={getSeries}
          getDigits={getDigits}
          onGhost={(owner, kind, e) => lineDragRef.current?.beginStop(owner, kind, e)}
          onConfirmEdit={(owner) => lineDragRef.current?.confirmEdit(owner)}
          onCancelEdit={(owner) => lineDragRef.current?.cancelEdit(owner)}
        />
        <CalendarMarkers symbol={symbol} tf={tf} replay={replayActive} getChart={getChart} getBars={getBars} />
        {ctxMenu && (
          <ChartContextMenu
            x={ctxMenu.x}
            y={ctxMenu.y}
            items={ctxMenu.items}
            onClose={() => setCtxMenu(null)}
          />
        )}
        {showLatestButton && (
          <button
            type="button"
            aria-label="Scroll to the most recent bar"
            title="Scroll to the most recent bar"
            onClick={() => {
              chartRef.current?.timeScale().scrollToRealTime();
              setShowLatestButton(false);
            }}
            className="absolute bottom-9 right-[76px] z-20 flex h-8 w-8 items-center justify-center rounded border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow hover:bg-[var(--hover)]"
          >
            <SkipToLatest />
          </button>
        )}
        <div className="pointer-events-none absolute left-3 top-2 z-10 text-[13px] leading-[20px]">
          <div className="flex flex-wrap items-baseline gap-x-3">
            {cs.showTitle && (
              <span className="flex items-center whitespace-nowrap text-[16px] text-[var(--fg)]">
                <span className="mr-2 flex">
                  <SymbolBadge name={symbol} type={symType} size={20} />
                </span>
                <span>
                  {cs.titleMode === "description" ? symbolDesc || symbol : symbol}
                  <span className="text-[var(--muted)]"> · </span>
                  {tfLegend(tf)}
                  {broker && (
                    <>
                      <span className="text-[var(--muted)]"> · </span>
                      {broker}
                    </>
                  )}
                </span>
              </span>
            )}
            {L && cs.showChartValues && (
              <span className="flex items-baseline gap-x-2 whitespace-nowrap">
                {(
                  [
                    ["O", L.o],
                    ["H", L.h],
                    ["L", L.l],
                    ["C", L.c],
                  ] as const
                ).map(([k, v]) => (
                  <span key={k}>
                    <span className="text-[var(--fg)]">{k}</span>
                    <span style={{ color }}>{fmtPrice(v, d)}</span>
                  </span>
                ))}
              </span>
            )}
            {L && cs.showBarChange && chg !== null && legend.prev && (
              <span className="whitespace-nowrap" style={{ color }}>
                {chg >= 0 ? "+" : "−"}
                {fmtPrice(Math.abs(chg), d)} ({chg >= 0 ? "+" : "−"}
                {Math.abs((chg / legend.prev) * 100).toFixed(2)}%)
              </span>
            )}
            {L && cs.showVolume && (
              <span className="whitespace-nowrap">
                <span className="text-[var(--fg)]">Vol </span>
                <span style={{ color }}>{fmtVol(L.v, volDigits(vs))}</span>
              </span>
            )}
          </div>
          <TradeWidget symbol={symbol} digits={digits} replay={replayActive} />
          {!legendCollapsed && (
            <VolumeLegend
              getBars={() => barsRef.current}
              bar={L}
              prev={legend?.prev}
              onMenu={(x, y) => setCtxMenu({ x, y, items: volumeMenuItems(tf) })}
            />
          )}
          {!legendCollapsed && indicators.map((inst) => (
            <IndicatorLegend
              key={inst.uid}
              inst={inst}
              tf={tf}
              symbolDigits={digits}
              getValues={(uid) => (L ? indRef.current?.valuesAt(uid, L.t) : undefined)}
              onHide={() => pane.indicators.getState().update(inst.uid, { hidden: inst.hidden ? undefined : true })}
              onSettings={() => pane.indicators.getState().openSettings(inst.uid)}
              onRemove={() => removeIndicator(inst.uid)}
              onMenu={(x, y) => setCtxMenu({ x, y, items: indicatorMenuItems(pane.indicators, inst, tf) })}
            />
          ))}
          {(!vs.removed || indicators.length > 0) && (
            <button
              type="button"
              aria-label={legendCollapsed ? "Show indicator legend" : "Hide indicator legend"}
              title={legendCollapsed ? "Show indicator legend" : "Hide indicator legend"}
              onClick={() => pane.indicators.getState().setCollapsed(!legendCollapsed)}
              className="pointer-events-auto mt-1 flex h-5 w-5 items-center justify-center rounded border border-[var(--border)] text-[var(--fg)] hover:bg-[var(--hover)]"
            >
              <span className={legendCollapsed ? "" : "rotate-180"}>
                <Chevron size={14} />
              </span>
            </button>
          )}
          {status && <div className="mt-1 text-[var(--muted)]">{status}</div>}
        </div>
        <div ref={lblRef} className="pointer-events-none absolute right-0 top-0 z-10 hidden">
          <div
            ref={lblBoxRef}
            className="ml-px overflow-hidden whitespace-nowrap rounded-r-[3px] text-white"
          >
            <div ref={lblPriceRef} className="flex items-center pl-2" />
            {cs.countdown && countdown && (
              // TV đặt số đếm ngược sát hàng giá hơn là canh giữa hàng của nó: kéo lên 2px cho khớp
              <div className="flex items-center pl-2">
                <span className="-translate-y-[2px]">{countdown}</span>
              </div>
            )}
          </div>
        </div>
        {isActive && (
          <>
            <FavoritesBar />
            <StylePanel />
            <InlineTextEditor />
          </>
        )}
        {selecting && (
          <div
            className="absolute inset-y-0 left-0 z-30 cursor-pointer"
            style={{ right: chartRef.current?.priceScale("right").width() ?? 70 }}
            onMouseMove={onSelectMove}
            onMouseLeave={() => setHover(null)}
            onClick={() => hover && startReplay(hover.idx)}
          >
            {hover && (
              <>
                {/* Như TV (đo canvas): vùng sau thanh cắt phủ màu nền 70%, thanh dọc 2px #2962ff;
                    cả hai chỉ ở các pane, không đè lên trục thời gian (nơi có nhãn "Re: ..."). */}
                <div
                  className="absolute right-0 top-0"
                  style={{
                    left: hover.x + 1,
                    bottom: chartRef.current?.timeScale().height() ?? 0,
                    background: `color-mix(in srgb, ${cs.bg ?? CHART_THEMES[theme].bg} 70%, transparent)`,
                  }}
                />
                <div
                  className="absolute top-0 w-[2px] bg-[#2962ff]"
                  style={{ left: hover.x - 1, bottom: chartRef.current?.timeScale().height() ?? 0 }}
                />
                <svg
                  className="absolute text-[#2962ff]"
                  style={{ left: hover.x - 9, top: hover.y - 9 }}
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                >
                  <circle cx="6" cy="6" r="3" />
                  <circle cx="6" cy="18" r="3" />
                  <path d="M20 4L8.100 15.900M14.500 14.500L20 20M8.100 8.100L12 12" />
                </svg>
                <div
                  className="absolute bottom-1 -translate-x-1/2 whitespace-nowrap rounded bg-[#2962ff] px-2 py-1 text-xs text-white"
                  style={{ left: hover.x }}
                >
                  {hover.label}
                </div>
              </>
            )}
          </div>
        )}
      </div>
      {(selecting || replayActive) && <ReplayBar paneId={paneId} symbol={symbol} onStep={() => stepReplay()} />}
      <div className="flex h-8 items-center justify-between border-t border-[var(--border)] px-2 text-xs">
        <div className="flex gap-0.5">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setRange(r.secs)}
              className="rounded px-2 py-1 hover:bg-[var(--hover)]"
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <TimezoneMenu clock={clock} />
          {scaleBtn("percent", "%")}
          {scaleBtn("log", "log")}
        </div>
      </div>
    </div>
  );
}
