"use client";

import { DrawingManager } from "@/drawings/manager";
import { SkipToLatest } from "../icons";
import { useDrawingStore } from "@/drawings/store";
import { IndicatorManager } from "@/indicators/manager";
import { byId } from "@/indicators/registry";
import { useIndicatorStore } from "@/indicators/store";
import { TF_SECONDS, WS_URL, fetchBars, fetchSymbols, triggerBackfillAt, type Bar } from "@/lib/api";
import { SPEEDS, exitReplay, useReplayStore } from "@/replay/store";
import { useChartStore, type ChartType, type ScaleMode } from "@/store/chart";
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
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent as RMouseEvent,
} from "react";
import DrawingSettings from "./DrawingSettings";
import FavoritesBar from "./FavoritesBar";
import ReplayBar from "./ReplayBar";
import StylePanel from "./StylePanel";
import { heikinAshi } from "./transform";

const THEMES = {
  dark: { bg: "#0f0f0f", text: "#b2b5be", grid: "#242424", label: "#363a45" },
  light: { bg: "#ffffff", text: "#131722", grid: "#f0f3fa", label: "#131722" },
};

const UP = "#089981";
const DOWN = "#f23645";

type Fmt = { precision: number };

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
  switch (type) {
    case "bars":
      return chart.addSeries(BarSeries, {
        upColor: UP,
        downColor: DOWN,
        priceFormat,
      });
    case "line":
      return chart.addSeries(LineSeries, {
        color: "#2962ff",
        lineWidth: 2,
        priceFormat,
      });
    case "area":
      return chart.addSeries(AreaSeries, {
        lineColor: "#2962ff",
        topColor: "rgba(41,98,255,0.4)",
        bottomColor: "rgba(41,98,255,0)",
        priceFormat,
      });
    default:
      return chart.addSeries(CandlestickSeries, {
        upColor: UP,
        downColor: DOWN,
        borderUpColor: UP,
        borderDownColor: DOWN,
        wickUpColor: UP,
        wickDownColor: DOWN,
        priceFormat,
      });
  }
}

function toPoint(b: Bar, type: ChartType) {
  const time = b.t as UTCTimestamp;
  if (type === "line" || type === "area") return { time, value: b.c };
  return { time, open: b.o, high: b.h, low: b.l, close: b.c };
}

const volPoint = (b: Bar) => ({
  time: b.t as UTCTimestamp,
  value: b.v,
  color: b.c >= b.o ? `${UP}66` : `${DOWN}66`,
});

function fmtCountdown(sec: number) {
  const h = Math.floor(sec / 3600),
    m = Math.floor((sec % 3600) / 60),
    s = sec % 60;
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${p(h)}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`;
}

function fmtVol(v: number) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`;
  return String(v);
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");

// Hiển thị theo giờ máy người dùng
function crosshairTime(t: number) {
  const d = new Date(t * 1000);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}  ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

// TickMarkType: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds
function tickLabel(t: number, type: number) {
  const d = new Date(t * 1000);
  if (type === 0) return String(d.getFullYear());
  if (type === 1) return MONTHS[d.getMonth()];
  if (type === 2) return String(d.getDate());
  return `${p2(d.getHours())}:${p2(d.getMinutes())}`;
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

function setTabTitle(title: string) {
  if (document.title !== title) document.title = title;
}

function mergeBars(cur: Bar[], add: Bar[]) {
  const m = new Map(cur.map((b) => [b.t, b]));
  for (const b of add) if (!m.has(b.t)) m.set(b.t, b);
  return [...m.values()].sort((a, b) => a.t - b.t);
}

export default function Chart() {
  const { symbol, tf, chartType, scaleMode, theme, set } = useChartStore();
  const digits = useChartStore(
    (s) => s.symbols.find((x) => x.name === s.symbol)?.digits ?? 5,
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<SeriesType> | null>(null);
  const volRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const barsRef = useRef<Bar[]>([]);
  const typeRef = useRef<ChartType>(chartType);
  const digitsRef = useRef(digits);
  const loadingRef = useRef(false);
  const exhaustedRef = useRef(false);
  const backfillRef = useRef<{ t: number; at: number; done: boolean } | null>(null);
  const prevCloseRef = useRef<number | null>(null);
  const indRef = useRef<IndicatorManager | null>(null);
  const drawRef = useRef<DrawingManager | null>(null);
  const indicators = useIndicatorStore((s) => s.list);
  const removeIndicator = useIndicatorStore((s) => s.remove);
  const [legend, setLegend] = useState<Legend | null>(null);
  const [countdown, setCountdown] = useState("");
  const [status, setStatus] = useState("");
  const [showLatestButton, setShowLatestButton] = useState(false);
  const [clock, setClock] = useState("");
  const fullRef = useRef<Bar[]>([]);
  const m1Ref = useRef<Bar[]>([]);
  const cursorRef = useRef(0);
  const prevSymbolRef = useRef(symbol);
  const wasActiveRef = useRef(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [hover, setHover] = useState<{
    x: number;
    y: number;
    idx: number;
    label: string;
  } | null>(null);
  const selecting = useReplayStore((s) => s.selecting);
  const replayActive = useReplayStore((s) => s.active);
  const playing = useReplayStore((s) => s.playing);
  const speed = useReplayStore((s) => s.speed);
  const interval = useReplayStore((s) => s.interval);

  const legendAt = (i: number): Legend | null => {
    const bars = barsRef.current;
    return bars[i] ? { bar: bars[i], prev: bars[i - 1]?.c ?? null } : null;
  };

  const display = () =>
    typeRef.current === "heikin"
      ? heikinAshi(barsRef.current)
      : barsRef.current;
  const render = () => {
    const cur = barsRef.current;
    if (cur.some((b, i) => i > 0 && b.t <= cur[i - 1].t)) {
      const byTime = new Map(cur.map((b) => [b.t, b]));
      barsRef.current = [...byTime.values()].sort((a, b) => a.t - b.t);
    }
    seriesRef.current?.setData(
      display().map((b) => toPoint(b, typeRef.current)) as never,
    );
    volRef.current?.setData(barsRef.current.map(volPoint));
    updateTitle();
  };

  // Tiêu đề tab kiểu TradingView: "XAUUSDm 4,122.741 ▼ −0.05%" (% so với giá đóng cửa
  // phiên D1 trước).
  const updateTitle = () => {
    const st = useChartStore.getState();
    const last = barsRef.current[barsRef.current.length - 1];
    let title = "Invest Charts";
    if (last) {
      const d = st.symbols.find((x) => x.name === st.symbol)?.digits ?? digitsRef.current;
      title = `${st.symbol} ${last.c.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`;
      const prev = prevCloseRef.current;
      if (prev) {
        const pct = ((last.c - prev) / prev) * 100;
        title += ` ${pct >= 0 ? "▲ +" : "▼ −"}${Math.abs(pct).toFixed(2)}%`;
      }
    }
    setTabTitle(title);
  };

  const refreshExtras = () => {
    indRef.current?.update(useIndicatorStore.getState().list, barsRef.current);
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
      .setVisibleLogicalRange({ from: idx, to: bars.length - 1 + 8 });
  };

  // --- replay ---
  const buildVisible = (cursorT: number): Bar[] => {
    const full = fullRef.current;
    const tfs = TF_SECONDS[useChartStore.getState().tf];
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
        seriesRef.current?.update(toPoint(vis[i], typeRef.current) as never);
        volRef.current?.update(volPoint(vis[i]));
      }
    } else render();
    refreshExtras();
    setLegend(legendAt(vis.length - 1));
  };

  const wantM1 = () => {
    const iv = useReplayStore.getState().interval;
    return !!iv && TF_SECONDS[iv] < TF_SECONDS[useChartStore.getState().tf];
  };

  const loadM1 = async (from: number) => {
    m1Ref.current = await fetchBars(
      useChartStore.getState().symbol,
      "M1",
      undefined,
      50000,
      from,
    );
  };

  const stepReplay = (): boolean => {
    const st = useReplayStore.getState();
    if (!st.active) return false;
    const tfs = TF_SECONDS[useChartStore.getState().tf];
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
    if (!useReplayStore.getState().active) fullRef.current = [...bars];
    cursorRef.current = b.t + TF_SECONDS[useChartStore.getState().tf];
    useReplayStore.setState({ selecting: false, active: true, playing: false });
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
      label: `Re: ${crosshairTime(bars[idx].t)}`,
    });
  };

  // chart instance
  useEffect(() => {
    const chart = createChart(boxRef.current!, {
      autoSize: true,
      // Logo TradingView trên chart tắt; link bắt buộc theo giấy phép lightweight-charts
      // nằm ở thanh dưới ("Charts by TradingView"). Attribution notice:
      // TradingView Lightweight Charts™ Copyright (c) TradingView, Inc. https://www.tradingview.com/
      layout: { fontSize: 12, attributionLogo: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { style: LineStyle.Dashed, width: 1 },
        horzLine: { style: LineStyle.Dashed, width: 1 },
      },
      rightPriceScale: { scaleMargins: { top: 0.08, bottom: 0.25 } },
      localization: { timeFormatter: (t: number) => crosshairTime(t) },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 8,
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
            (item) => item.name === useChartStore.getState().symbol,
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
        const anchor = ts.coordinateToLogical(x);
        if (!range || anchor === null) return;
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
    chart
      .priceScale("vol")
      .applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });

    indRef.current = new IndicatorManager(chart);
    drawRef.current = new DrawingManager({
      chart,
      container: boxRef.current!,
      getBars: () => barsRef.current,
      getTf: () => useChartStore.getState().tf,
      getDigits: () => digitsRef.current,
      getTickSize: () =>
        useChartStore
          .getState()
          .symbols.find((item) => item.name === useChartStore.getState().symbol)
          ?.tick_size ?? 10 ** -digitsRef.current,
    });

    chart.subscribeCrosshairMove((p) => {
      const bars = barsRef.current;
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
      const bars = barsRef.current;
      const awayFromLatest =
        !!range && bars.length > 0 && range.to < bars.length - 1;
      setShowLatestButton(
        awayFromLatest && !useReplayStore.getState().selecting,
      );
      if (
        !range ||
        range.from > 50 ||
        loadingRef.current ||
        exhaustedRef.current ||
        useReplayStore.getState().active
      )
        return;
      const first = barsRef.current[0];
      if (!first) return;
      loadingRef.current = true;
      const curSym = useChartStore.getState().symbol;
      const curTf = useChartStore.getState().tf;
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
              `${useChartStore.getState().symbol}|${useChartStore.getState().tf}` ||
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
      box.removeEventListener("wheel", onAxisWheel, { capture: true });
      drawRef.current?.destroy();
      indRef.current?.destroy();
      drawRef.current = null;
      indRef.current = null;
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // theme
  useEffect(() => {
    const t = THEMES[theme];
    chartRef.current?.applyOptions({
      layout: {
        background: { type: ColorType.Solid, color: t.bg },
        textColor: t.text,
      },
      grid: {
        vertLines: { color: t.grid, style: LineStyle.Dotted },
        horzLines: { color: t.grid, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: t.grid },
      timeScale: { borderColor: t.grid },
      crosshair: {
        vertLine: { color: "#758696", labelBackgroundColor: t.label },
        horzLine: { color: "#758696", labelBackgroundColor: t.label },
      },
    });
  }, [theme]);

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
      const canvas = chartRef.current?.takeScreenshot();
      canvas?.toBlob((b) => {
        if (!b) return;
        const a = document.createElement("a");
        a.href = URL.createObjectURL(b);
        a.download = `${useChartStore.getState().symbol}-${Date.now()}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      });
    };
    window.addEventListener("tv-screenshot", shot);
    return () => window.removeEventListener("tv-screenshot", shot);
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
    typeRef.current = chartType;
    seriesRef.current = createSeries(chart, chartType, {
      precision: digitsRef.current,
    });
    drawRef.current?.attachTo(seriesRef.current);
    render();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chartType]);

  // price precision
  useEffect(() => {
    seriesRef.current?.applyOptions({
      priceFormat: { type: "price", precision: digits, minMove: 10 ** -digits },
    });
  }, [digits, chartType]);

  // symbol/tf change resets replay settings
  useEffect(() => {
    if (prevSymbolRef.current !== symbol) {
      prevSymbolRef.current = symbol;
      exitReplay();
    }
    useReplayStore.setState({ interval: "" });
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
      if (!stepReplay()) useReplayStore.setState({ playing: false });
    }, SPEEDS[speed]);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed]);

  // changing the update interval
  useEffect(() => {
    if (!useReplayStore.getState().active) return;
    (async () => {
      if (wantM1())
        await loadM1(
          cursorRef.current - TF_SECONDS[useChartStore.getState().tf],
        );
      applyVisible(buildVisible(cursorRef.current));
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interval]);

  // Esc cancels bar selection
  useEffect(() => {
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useReplayStore.setState({ selecting: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selecting]);

  // giá đóng cửa phiên D1 trước cho % thay đổi trên tiêu đề tab
  useEffect(() => {
    let alive = true;
    prevCloseRef.current = null;
    const loadPrev = () =>
      fetchBars(symbol, "D1", undefined, 2)
        .then((d) => {
          if (!alive || d.length === 0) return;
          const hasToday = d[d.length - 1].t + 86400 > Date.now() / 1000;
          prevCloseRef.current = hasToday ? (d[d.length - 2]?.c ?? null) : d[d.length - 1].c;
          updateTitle();
        })
        .catch(() => {});
    loadPrev();
    const id = setInterval(loadPrev, 10 * 60 * 1000); // qua ngày mới
    return () => {
      alive = false;
      clearInterval(id);
      setTabTitle("Invest Charts");
    };
  }, [symbol]);

  // data + realtime
  useEffect(() => {
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;
    let pollTimer: ReturnType<typeof setTimeout>;
    barsRef.current = [];
    exhaustedRef.current = false;
    backfillRef.current = null;
    render();
    drawRef.current?.setSymbol(symbol);
    refreshExtras();

    const load = async () => {
      const replayActiveNow = useReplayStore.getState().active;
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
        chartRef.current?.timeScale().setVisibleLogicalRange({
          from: Math.max(0, bars.length - 150),
          to: bars.length - 1 + 8,
        });
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
      else seriesRef.current?.update(toPoint(b, typeRef.current) as never);
      volRef.current?.update(volPoint(b));
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
          if (useReplayStore.getState().active) {
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
              fetchBars(symbol, tf, undefined, 50000, last.t),
              fetchBars(symbol, tf, first.t, 500),
            ]).then(([newer, older]) => {
              if (!alive || barsRef.current[0] !== first) return;
              if (newer.length >= 50000) {
                load(); // catch-up quá dài để ghép -> tải lại từ mới nhất
                return;
              }
              const useOlder = olderUsable(older, first.t, tf, backfillRef.current);
              const added = newer.some((b) => b.t > last.t);
              if (!useOlder && !added) return;
              const vis = chartRef.current?.timeScale().getVisibleLogicalRange();
              const merged = mergeBars(barsRef.current, newer);
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
        else if (useReplayStore.getState().active) {
          // Đang replay: bỏ qua realtime (bar_update/bar_close/tick), chỉ xử lý
          // bars_loaded ở trên.
        }
        else if (
          (m.type === "bar_update" || m.type === "bar_close") &&
          m.tf === tf
        ) {
          if (barsRef.current.length === 0) setStatus("");
          upsert(m.bar);
        } else if (m.type === "tick" && m.symbol === symbol) {
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
  }, [indicators]);

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
      const off = -new Date().getTimezoneOffset() / 60;
      const d = new Date(now);
      setClock(
        `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} UTC${off >= 0 ? "+" : ""}${off}`,
      );
    }, 1000);
    return () => clearInterval(id);
  }, [tf]);

  const L = legend?.bar;
  const up = L ? L.c >= L.o : true;
  const color = up ? UP : DOWN;
  const chg = L && legend.prev !== null ? L.c - legend.prev : null;
  const d = digits;
  const scaleBtn = (m: ScaleMode, label: string) => (
    <button
      key={m}
      onClick={() => set({ scaleMode: scaleMode === m ? "normal" : m })}
      className={`rounded px-1.5 py-0.5 hover:bg-[var(--hover)] ${scaleMode === m ? "text-[var(--accent)]" : ""}`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={boxRef} className="h-full w-full" />
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
        <div className="pointer-events-none absolute left-3 top-2 z-10 text-xs">
          <div className="flex items-center gap-2 text-[13px]">
            <span className="font-semibold">{symbol}</span>
            <span className="text-[var(--muted)]">· {tf} ·</span>
            {countdown && (
              <span className="text-[var(--muted)]">{countdown}</span>
            )}
          </div>
          {L && (
            <div className="mt-0.5 flex gap-2 font-mono" style={{ color }}>
              <span>
                O<b className="ml-1 font-normal">{L.o.toFixed(d)}</b>
              </span>
              <span>
                H<b className="ml-1 font-normal">{L.h.toFixed(d)}</b>
              </span>
              <span>
                L<b className="ml-1 font-normal">{L.l.toFixed(d)}</b>
              </span>
              <span>
                C<b className="ml-1 font-normal">{L.c.toFixed(d)}</b>
              </span>
              {chg !== null && legend.prev && (
                <span>
                  {chg >= 0 ? "+" : ""}
                  {chg.toFixed(d)} ({((chg / legend.prev) * 100).toFixed(2)}%)
                </span>
              )}
            </div>
          )}
          {L && (
            <div className="mt-0.5 flex gap-1.5 font-mono">
              <span className="text-[var(--muted)]">Vol</span>
              <span style={{ color }}>{fmtVol(L.v)}</span>
            </div>
          )}
          {indicators.map((inst) => {
            const def = byId(inst.id);
            const params = def.inputs.map((i) => inst.inputs[i.key]).join(" ");
            return (
              <div
                key={inst.uid}
                className="mt-0.5 flex items-center gap-1.5 text-[var(--muted)]"
              >
                <span style={{ color: inst.colors[0] }}>{def.name}</span>
                <span>{params}</span>
                <button
                  onClick={() => removeIndicator(inst.uid)}
                  className="pointer-events-auto px-1 hover:text-[var(--fg)]"
                  title="Remove"
                >
                  ✕
                </button>
              </div>
            );
          })}
          {status && <div className="mt-1 text-[var(--muted)]">{status}</div>}
        </div>
        <FavoritesBar />
        <StylePanel />
        <DrawingSettings />
        {selecting && (
          <div
            className="absolute inset-y-0 left-0 z-30 cursor-pointer"
            style={{ right: 70 }}
            onMouseMove={onSelectMove}
            onMouseLeave={() => setHover(null)}
            onClick={() => hover && startReplay(hover.idx)}
          >
            {hover && (
              <>
                <div
                  className="absolute inset-y-0 w-px bg-[#2962ff]"
                  style={{ left: hover.x }}
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
      {(selecting || replayActive) && <ReplayBar onStep={() => stepReplay()} />}
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
          <a
            href="https://www.tradingview.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--muted)] hover:underline"
          >
            Charts by TradingView
          </a>
          <span className="text-[var(--muted)]">{clock}</span>
          {scaleBtn("percent", "%")}
          {scaleBtn("log", "log")}
        </div>
      </div>
    </div>
  );
}
