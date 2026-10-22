import {
    customSeriesDefaultOptions,
    type CustomData,
    type CustomSeriesOptions,
    type CustomSeriesWhitespaceData,
    type ICustomSeriesPaneRenderer,
    type ICustomSeriesPaneView,
    type PaneRendererCustomData,
    type Time,
} from "lightweight-charts";

export type CrossData = CustomData<Time> & { value: number };
export type CrossOptions = CustomSeriesOptions & { color: string; size: number; thickness: number };
export type LineBreakOptions = CustomSeriesOptions & { color: string; thickness: number; dash: "solid" | "dashed" | "dotted" };

// Series tuỳ biến cho kiểu plot mà line của LWC không có (Pine plot.style_cross, plot.style_linebr).

/** Dấu "+" ở mỗi điểm (`plot.style_cross` của Pine: Parabolic SAR). Chỉ vẽ các điểm trong vùng nhìn. */
class CrossRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, CrossData> | null = null;
  private options: CrossOptions | null = null;

  update(data: PaneRendererCustomData<Time, CrossData>, options: CrossOptions) {
    this.data = data;
    this.options = options;
  }

  draw: ICustomSeriesPaneRenderer["draw"] = (target, priceConverter) => {
    const { data, options } = this;
    if (!data || !options || !data.visibleRange) return;
    const { from, to } = data.visibleRange;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
      ctx.strokeStyle = options.color;
      ctx.lineWidth = Math.max(1, Math.round(options.thickness * hpr));
      const r = options.size * hpr; // nửa cạnh dấu +
      const rv = options.size * vpr;
      ctx.beginPath();
      for (let i = Math.max(0, from); i <= Math.min(data.bars.length - 1, to); i++) {
        const b = data.bars[i];
        const y = priceConverter(b.originalData.value);
        if (y === null) continue;
        const px = b.x * hpr;
        const py = y * vpr;
        ctx.moveTo(px - r, py);
        ctx.lineTo(px + r, py);
        ctx.moveTo(px, py - rv);
        ctx.lineTo(px, py + rv);
      }
      ctx.stroke();
    });
  };
}

export class CrossSeries implements ICustomSeriesPaneView<Time, CrossData, CrossOptions> {
  private readonly rend = new CrossRenderer();
  renderer() {
    return this.rend;
  }
  update(data: PaneRendererCustomData<Time, CrossData>, options: CrossOptions) {
    this.rend.update(data, options);
  }
  priceValueBuilder(row: CrossData): [number] {
    return [row.value];
  }
  isWhitespace(data: CrossData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return (data as CrossData).value === undefined;
  }
  defaultOptions(): CrossOptions {
    return { ...customSeriesDefaultOptions, color: "#2962ff", size: 3, thickness: 1 };
  }
}

/** Nét dài theo độ dày w (px bitmap), cùng nhịp với nét của line thường. */
const dashPattern = (dash: LineBreakOptions["dash"], w: number): number[] => (dash === "dashed" ? [6 * w, 6 * w] : dash === "dotted" ? [w, 2 * w] : []);

/** Line đứt ở chỗ không có giá trị (`plot.style_linebr`): LWC nối thẳng hai điểm có giá trị dù giữa chúng là whitespace. */
class LineBreakRenderer implements ICustomSeriesPaneRenderer {
  private data: PaneRendererCustomData<Time, CrossData> | null = null;
  private options: LineBreakOptions | null = null;

  update(data: PaneRendererCustomData<Time, CrossData>, options: LineBreakOptions) {
    this.data = data;
    this.options = options;
  }

  draw: ICustomSeriesPaneRenderer["draw"] = (target, priceConverter) => {
    const { data, options } = this;
    if (!data || !options || !data.visibleRange) return;
    const { from, to } = data.visibleRange;
    target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
      const w = Math.max(1, Math.round(options.thickness * hpr));
      ctx.strokeStyle = options.color;
      ctx.lineWidth = w;
      ctx.lineJoin = "round";
      ctx.setLineDash(dashPattern(options.dash, w));
      ctx.beginPath();
      let prev = -2; // chỉ số logic của điểm trước; liền kề (+1) mới nối
      for (let i = Math.max(0, from - 1); i <= Math.min(data.bars.length - 1, to + 1); i++) {
        const b = data.bars[i];
        const y = b.originalData.value === undefined ? null : priceConverter(b.originalData.value);
        if (y === null) {
          prev = -2;
          continue;
        }
        if (b.time - prev === 1) ctx.lineTo(b.x * hpr, y * vpr);
        else ctx.moveTo(b.x * hpr, y * vpr);
        prev = b.time;
      }
      ctx.stroke();
    });
  };
}

export class LineBreakSeries implements ICustomSeriesPaneView<Time, CrossData, LineBreakOptions> {
  private readonly rend = new LineBreakRenderer();
  renderer() {
    return this.rend;
  }
  update(data: PaneRendererCustomData<Time, CrossData>, options: LineBreakOptions) {
    this.rend.update(data, options);
  }
  priceValueBuilder(row: CrossData): [number] {
    return [row.value];
  }
  isWhitespace(data: CrossData | CustomSeriesWhitespaceData<Time>): data is CustomSeriesWhitespaceData<Time> {
    return (data as CrossData).value === undefined;
  }
  defaultOptions(): LineBreakOptions {
    return { ...customSeriesDefaultOptions, color: "#2962ff", thickness: 1, dash: "solid" };
  }
}
