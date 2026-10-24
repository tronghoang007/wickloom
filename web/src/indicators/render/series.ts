import {
    AreaSeries,
    CandlestickSeries,
    HistogramSeries,
    LineSeries,
    LineStyle,
    LineType,
    type IChartApi,
    type ISeriesApi,
    type SeriesType,
} from "lightweight-charts";
import type { LineStyleName, PlotType } from "../schema";
import { CrossSeries, LineBreakSeries } from "./custom";
import { withAlpha, type PlotStyleR } from "../style";

export const LWC_LINE_STYLE: Record<LineStyleName, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.LargeDashed, // nét đứt dài (6 / 6) như đường crosshair của TV; Dashed của LWC chỉ 2 / 2 nên trông như chấm
  dotted: LineStyle.Dotted,
};

/** Id thang giá LWC: phải/trái là thang của pane; "none" = thang riêng ẩn của indicator (overlay). */
export const scaleId = (scale: "right" | "left" | "none", uid: string): string => (scale === "none" ? `ov-${uid}` : scale);

/** Dựng series cho một plot theo kiểu của nó (đổi kiểu = dựng lại series). Tuỳ chọn hiển thị đặt sau bằng `plotOptions`. */
export function addPlotSeries(chart: IChartApi, type: PlotType, paneIndex: number, priceScaleId = "right"): ISeriesApi<SeriesType> {
  // không đặt title: nhãn trên trục giá chỉ có giá trị như TV, tên indicator nằm ở legend của pane
  const common = { priceLineVisible: false, priceScaleId };
  switch (type) {
    case "histogram":
      return chart.addSeries(HistogramSeries, { ...common, priceFormat: { type: "volume" } }, paneIndex) as ISeriesApi<SeriesType>;
    case "area":
      return chart.addSeries(AreaSeries, common, paneIndex) as ISeriesApi<SeriesType>;
    case "candles":
      return chart.addSeries(CandlestickSeries, { ...common, borderVisible: true }, paneIndex) as ISeriesApi<SeriesType>;
    case "cross":
      return chart.addCustomSeries(new CrossSeries(), common, paneIndex) as unknown as ISeriesApi<SeriesType>;
    case "linebr":
      return chart.addCustomSeries(new LineBreakSeries(), common, paneIndex) as unknown as ISeriesApi<SeriesType>;
    default:
      return chart.addSeries(LineSeries, common, paneIndex) as ISeriesApi<SeriesType>;
  }
}

/** Tuỳ chọn LWC của một plot: màu, độ dày, nét, kiểu đường. Chỉ chứa khoá hợp lệ với loại series của `st.type`. */
export function plotOptions(st: PlotStyleR): Record<string, unknown> {
  const lineWidth = st.width as 1 | 2 | 3 | 4;
  switch (st.type) {
    case "histogram":
      return { color: st.color };
    case "candles":
      return {
        upColor: st.color, borderUpColor: st.color, wickUpColor: st.color,
        downColor: st.colorDown, borderDownColor: st.colorDown, wickDownColor: st.colorDown,
      };
    case "area":
      return { lineColor: st.color, topColor: withAlpha(st.color, 0.35), bottomColor: withAlpha(st.color, 0), lineWidth, lineStyle: LWC_LINE_STYLE[st.lineStyle] };
    case "circles":
      return { color: st.color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: st.width + 1 };
    case "cross":
      return { color: st.color, size: st.width + 2, thickness: 1 };
    case "linebr":
      return { color: st.color, thickness: st.width, dash: st.lineStyle };
    case "step":
      return { color: st.color, lineWidth, lineStyle: LWC_LINE_STYLE[st.lineStyle], lineType: LineType.WithSteps, lineVisible: true, pointMarkersVisible: false };
    default:
      return { color: st.color, lineWidth, lineStyle: LWC_LINE_STYLE[st.lineStyle], lineType: LineType.Simple, lineVisible: true, pointMarkersVisible: false };
  }
}

/** Series "neo" không vẽ gì, giữ đường ngang (levels) và vùng tô (fills) của một indicator: ẩn/hiện theo indicator chứ không theo plot nào. */
export function addAnchorSeries(chart: IChartApi, paneIndex: number, priceScaleId = "right"): ISeriesApi<SeriesType> {
  return chart.addSeries(
    LineSeries,
    {
      lineVisible: false,
      pointMarkersVisible: false,
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
      priceScaleId,
      autoscaleInfoProvider: () => null, // không ảnh hưởng thang giá
    },
    paneIndex,
  ) as ISeriesApi<SeriesType>;
}
