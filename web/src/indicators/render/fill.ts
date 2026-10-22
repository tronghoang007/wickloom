import type {
    IPrimitivePaneRenderer,
    IPrimitivePaneView,
    IChartApiBase,
    ISeriesApi,
    ISeriesPrimitive,
    Logical,
    SeriesAttachedParameter,
    SeriesType,
    Time,
} from "lightweight-charts";
import type { Num } from "../ta";

/** Một đầu của vùng tô: chuỗi giá theo từng nến (plot) hoặc hằng số (level). */
export type FillEdge = Num | number;
/** `colorDown`: màu của nến mà đầu a không cao hơn đầu b (xem `FillDef.colorDown`); không có thì một màu `color` cho cả vùng. */
export type FillData = { a: FillEdge; b: FillEdge; color: string; colorDown?: string };

const at = (e: FillEdge, i: number): number => (typeof e === "number" ? e : (e[i] ?? NaN));
const len = (e: FillEdge): number => (typeof e === "number" ? Infinity : e.length);

/** Tô nền giữa hai plot / hai level (fill của Pine). Gắn vào series neo; chỉ vẽ phần đang nhìn thấy, đứt đoạn ở chỗ na. */
export class FillPrimitive implements ISeriesPrimitive<Time> {
  private data: FillData | null = null;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series;
    this.redraw = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.redraw = null;
  }

  set(data: FillData | null) {
    this.data = data;
    this.redraw?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  private view: IPrimitivePaneView = {
    zOrder: () => "bottom",
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) => {
        const d = this.data;
        const chart = this.chart;
        const series = this.series;
        if (!d || !chart || !series) return;
        const ts = chart.timeScale();
        const range = ts.getVisibleLogicalRange();
        if (!range) return;
        const n = Math.min(len(d.a), len(d.b));
        const from = Math.max(0, Math.floor(range.from) - 1);
        const to = Number.isFinite(n) ? Math.min(n - 1, Math.ceil(range.to) + 1) : Math.ceil(range.to) + 1;
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          let run: { x: number; a: number; b: number }[] = [];
          let runColor = d.color;
          const flush = () => {
            if (run.length >= 2) {
              context.fillStyle = runColor;
              context.beginPath();
              context.moveTo(run[0].x, run[0].a);
              for (let k = 1; k < run.length; k++) context.lineTo(run[k].x, run[k].a);
              for (let k = run.length - 1; k >= 0; k--) context.lineTo(run[k].x, run[k].b);
              context.closePath();
              context.fill();
            }
            run = [];
          };
          for (let i = from; i <= to; i++) {
            const va = at(d.a, i);
            const vb = at(d.b, i);
            const x = ts.logicalToCoordinate(i as Logical);
            const ya = Number.isNaN(va) ? null : series.priceToCoordinate(va);
            const yb = Number.isNaN(vb) ? null : series.priceToCoordinate(vb);
            if (x === null || ya === null || yb === null) {
              flush();
              continue;
            }
            // đổi màu giữa chừng: đoạn mới bắt đầu từ điểm cuối của đoạn trước nên không hở
            const color = d.colorDown !== undefined && !(va > vb) ? d.colorDown : d.color;
            if (run.length >= 2 && color !== runColor) {
              const last = run[run.length - 1];
              flush();
              run = [last];
            }
            if (run.length <= 1) runColor = color;
            run.push({ x: x * hpr, a: ya * vpr, b: yb * vpr });
          }
          flush();
        });
      },
    }),
  };
}
