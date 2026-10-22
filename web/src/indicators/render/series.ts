import {
    AreaSeries,
    HistogramSeries,
    LineSeries,
    LineStyle,
    LineType,
    type IChartApi,
    type ISeriesApi,
    type SeriesType,
} from "lightweight-charts";
import type { LineStyleName, PlotType } from "../schema";
import { withAlpha, type PlotStyleR } from "../style";

export const LWC_LINE_STYLE: Record<LineStyleName, LineStyle> = {
  solid: LineStyle.Solid,
  dashed: LineStyle.Dashed,
  dotted: LineStyle.Dotted,
};

/** Id thang giá LWC: phải/trái là thang của pane; "none" = thang riêng ẩn của indicator (overlay). */
export const scaleId = (scale: "right" | "left" | "none", uid: string): string => (scale === "none" ? `ov-${uid}` : scale);

/** Dựng series cho một plot theo kiểu của nó (đổi kiểu = dựng lại series). Tuỳ chọn hiển thị đặt sau bằng `plotOptions`. */
export function addPlotSeries(chart: IChartApi, type: PlotType, paneIndex: number, title: string, priceScaleId = "right"): ISeriesApi<SeriesType> {
  const common = { priceLineVisible: false, title, priceScaleId };
  switch (type) {
    case "histogram":
      return chart.addSeries(HistogramSeries, { ...common, priceFormat: { type: "volume" } }, paneIndex) as ISeriesApi<SeriesType>;
    case "area":
      return chart.addSeries(AreaSeries, common, paneIndex) as ISeriesApi<SeriesType>;
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
    case "area":
      return { lineColor: st.color, topColor: withAlpha(st.color, 0.35), bottomColor: withAlpha(st.color, 0), lineWidth, lineStyle: LWC_LINE_STYLE[st.lineStyle] };
    case "circles":
      return { color: st.color, lineVisible: false, pointMarkersVisible: true, pointMarkersRadius: st.width + 1 };
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
