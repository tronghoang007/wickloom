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
import { fpText } from "../defs/footprint";
import type { FootprintSet, FpBar, FpRow, FpStyle, FpType } from "../schema";

// Vẽ Volume footprint (xem defs/footprint.ts): mỗi nến một cột ô theo row giá, nến mảnh ở giữa (Bid x Ask) hoặc bên trái (các kiểu một cột), imbalance, POC, Value Area, Info box.
// Hình học và giá trị ô là hàm thuần (test được); phần canvas chỉ ghép chúng lại.

export type FpCol = { x0: number; x1: number; side: "left" | "right" }; // side: cột nằm bên nào của nến (căn chữ / chiều thanh Profile)
export type FpGeom = { candleX: number; candleW: number; cols: FpCol[] };

/** Hình học ngang của một nến có tâm `x` (px) khi hai nến cách nhau `spacing` px. Bid x Ask: nến giữa, Sell bên trái, Buy bên phải;
 *  Delta / Volume: nến sát mép trái, một cột bên phải; Delta + Volume: hai cột bên phải nến (delta rồi total). */
export function fpGeometry(x: number, spacing: number, type: FpType): FpGeom {
  const half = spacing * 0.46;
  const candleW = Math.max(1, Math.min(6, Math.round(spacing * 0.08)));
  if (type === "bidask") {
    const gap = candleW / 2 + 1;
    return { candleX: x, candleW, cols: [{ x0: x - half, x1: x - gap, side: "left" }, { x0: x + gap, x1: x + half, side: "right" }] };
  }
  const candleX = x - half + candleW / 2;
  const start = candleX + candleW / 2 + 1;
  if (type === "deltavol") {
    const mid = (start + x + half) / 2;
    return { candleX, candleW, cols: [{ x0: start, x1: mid - 1, side: "right" }, { x0: mid + 1, x1: x + half, side: "right" }] };
  }
  return { candleX, candleW, cols: [{ x0: start, x1: x + half, side: "right" }] };
}

/** Giá trị hiển thị và bên tô màu của cột `col` ở row `r`: bidask = sell | buy; delta = up − down; volume = tổng; deltavol = delta | tổng. Màu theo dấu delta / bên nhiều volume hơn. */
export function fpCell(type: FpType, col: number, r: FpRow): { v: number; side: "buy" | "sell" } {
  const delta = r.up - r.dn;
  const total = r.up + r.dn;
  const dominant = r.up >= r.dn ? "buy" : "sell";
  switch (type) {
    case "bidask":
      return col === 0 ? { v: r.dn, side: "sell" } : { v: r.up, side: "buy" };
    case "delta":
      return { v: delta, side: delta >= 0 ? "buy" : "sell" };
    case "volume":
      return { v: total, side: dominant };
    default:
      return col === 0 ? { v: delta, side: delta >= 0 ? "buy" : "sell" } : { v: total, side: dominant };
  }
}

/** Số lớn nhất theo |giá trị| của từng cột trong nến (chuẩn hoá bề rộng thanh Profile và độ đậm nền). */
export function colMaxima(type: FpType, rows: FpRow[], nCols: number): number[] {
  return Array.from({ length: nCols }, (_, c) => Math.max(0, ...rows.map((r) => Math.abs(fpCell(type, c, r).v))));
}

/** Tổng volume và delta của nến (Info box). */
export function fpTotals(rows: FpRow[]): { total: number; delta: number } {
  return rows.reduce((a, r) => ({ total: a.total + r.up + r.dn, delta: a.delta + r.up - r.dn }), { total: 0, delta: 0 });
}

const FADE_MIN = 0.12;
const FADE_RANGE = 0.58;
const FIXED_ALPHA = 0.4;
const IMB_ALPHA = 0.9;
const IMB_TEXT = "#10131a";

/** Độ đậm nền ô theo kiểu tô màu: fading = FADE_MIN..FADE_MIN+FADE_RANGE theo phần của số lớn nhất, fixed = một mức, none = không nền. */
export function cellAlpha(mode: FpStyle["color"], share: number): number {
  return mode === "none" ? 0 : mode === "fixed" ? FIXED_ALPHA : FADE_MIN + FADE_RANGE * Math.min(1, Math.max(0, share));
}

const FONT = '-apple-system, "Trebuchet MS", sans-serif';

export class FootprintPrimitive implements ISeriesPrimitive<Time> {
  private data: FootprintSet | null = null;
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

  set(data: FootprintSet | null) {
    this.data = data;
    this.redraw?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  private view: IPrimitivePaneView = {
    zOrder: () => "normal",
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) => {
        const d = this.data;
        const chart = this.chart;
        const series = this.series;
        if (!d || !chart || !series || d.bars.length === 0) return;
        const ts = chart.timeScale();
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          const W = bitmapSize.width / hpr;
          for (const b of d.bars) {
            const x = ts.logicalToCoordinate(b.x as Logical);
            const xn = ts.logicalToCoordinate((b.x + 1) as Logical);
            if (x === null || xn === null) continue;
            const spacing = Math.abs(xn - x);
            if (x < -spacing || x > W + spacing) continue;
            drawBar(ctx, series, b, d.style, x, spacing, hpr, vpr);
          }
        });
      },
    }),
  };
}

/** Nến mảnh: bấc 1px + thân `w` px, màu nến tăng / giảm. */
function drawCandle(ctx: CanvasRenderingContext2D, series: ISeriesApi<SeriesType>, b: FpBar, st: FpStyle, cx: number, w: number, hpr: number, vpr: number) {
  const yh = series.priceToCoordinate(b.h);
  const yl = series.priceToCoordinate(b.l);
  const yo = series.priceToCoordinate(b.o);
  const yc = series.priceToCoordinate(b.c);
  if (yh === null || yl === null || yo === null || yc === null) return;
  ctx.fillStyle = b.c >= b.o ? st.up : st.down;
  const px = Math.round(cx * hpr);
  const wickW = Math.max(1, Math.round(hpr));
  ctx.fillRect(px - Math.floor(wickW / 2), Math.min(yh, yl) * vpr, wickW, Math.max(1, Math.abs(yl - yh) * vpr));
  const bodyW = Math.max(wickW, Math.round(w * hpr));
  ctx.fillRect(px - Math.floor(bodyW / 2), Math.min(yo, yc) * vpr, bodyW, Math.max(1, Math.abs(yc - yo) * vpr));
}

function drawBar(ctx: CanvasRenderingContext2D, series: ISeriesApi<SeriesType>, b: FpBar, st: FpStyle, x: number, spacing: number, hpr: number, vpr: number) {
  // quá hẹp để có ô: chỉ nến (thân rộng như nến thường)
  if (spacing < 8 || b.rows.length === 0) {
    drawCandle(ctx, series, b, st, x, Math.max(1, spacing * 0.6), hpr, vpr);
    return;
  }
  const geo = fpGeometry(x, spacing, st.type);
  const half = spacing * 0.46;
  const maxima = colMaxima(st.type, b.rows, geo.cols.length);
  const price = (p: number) => series.priceToCoordinate(p);
  const rowBox = (r: FpRow) => {
    const yb = price(r.p);
    const yt = price(r.p + b.size);
    return yb === null || yt === null ? null : { top: Math.min(yb, yt), bottom: Math.max(yb, yt) };
  };
  const fillX = (x0: number, x1: number, top: number, bottom: number, color: string, alpha: number) => {
    if (alpha <= 0 || x1 <= x0) return;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x0 * hpr), Math.round(top * vpr), Math.max(1, Math.round((x1 - x0) * hpr)), Math.max(1, Math.round((bottom - top) * vpr)));
    ctx.globalAlpha = 1;
  };
  const colorOf = (side: "buy" | "sell") => (side === "buy" ? st.buy : st.sell);
  const imbOf = (i: number, col: FpCol): { color: string; stack: boolean } | null => {
    if (!st.imbalance) return null;
    // Bid x Ask: Buy imbalance ở cột phải, Sell imbalance ở cột trái; các kiểu khác: Buy ở mép phải của cột, Sell ở mép trái
    if (st.type === "bidask") return col.side === "right" ? (b.buyImb[i] ? { color: st.imbBuy, stack: b.stackBuy[i] } : null) : b.sellImb[i] ? { color: st.imbSell, stack: b.stackSell[i] } : null;
    return null;
  };

  ctx.textBaseline = "middle";
  b.rows.forEach((r, i) => {
    const box = rowBox(r);
    if (!box) return;
    const h = box.bottom - box.top;
    const gap = h >= 4 ? 1 : 0; // khe 1px giữa các ô khi đủ cao
    const bottom = box.bottom - gap;
    geo.cols.forEach((col, ci) => {
      const { v, side } = fpCell(st.type, ci, r);
      const share = maxima[ci] > 0 ? Math.abs(v) / maxima[ci] : 0;
      const w = col.x1 - col.x0;
      const bar = st.mode === "profile" ? w * share : w;
      const imb = imbOf(i, col);
      // nền: Profile = thanh dài theo volume từ mép trong (sát nến) ra ngoài; Box = cả ô
      if (v !== 0 || imb) {
        const alpha = imb ? IMB_ALPHA : cellAlpha(st.color, share);
        const color = imb ? imb.color : colorOf(side);
        if (st.mode === "box" || imb) fillX(col.x0, col.x1, box.top, bottom, color, alpha);
        else if (col.side === "left") fillX(col.x1 - bar, col.x1, box.top, bottom, color, alpha);
        else fillX(col.x0, col.x0 + bar, box.top, bottom, color, alpha);
      }
      if (imb?.stack) {
        const edge = col.side === "left" ? col.x0 : col.x1 - 2;
        fillX(edge, edge + 2, box.top, bottom, imb.color, 1);
      }
      // chữ: cỡ theo chiều cao row, bỏ khi không vừa
      if (v === 0 || h < 7 || w < 14) return;
      const px = Math.max(6, Math.min(st.textSize, Math.floor(h * 0.8)));
      ctx.font = `${Math.round(px * vpr)}px ${FONT}`;
      const text = fpText(v, st.textFormat, (s) => ctx.measureText(s).width / hpr <= w - 3);
      if (ctx.measureText(text).width / hpr > w - 2) return;
      ctx.fillStyle = imb ? IMB_TEXT : st.text;
      ctx.textAlign = col.side === "left" ? "right" : "left";
      ctx.fillText(text, (col.side === "left" ? col.x1 - 2 : col.x0 + 2) * hpr, ((box.top + bottom) / 2) * vpr);
    });
  });

  const left = x - half;
  const right = x + half;
  // POC: khung quanh row có volume lớn nhất
  if (st.poc && b.poc >= 0) {
    const box = rowBox(b.rows[b.poc]);
    if (box) {
      ctx.strokeStyle = st.pocColor;
      ctx.lineWidth = Math.max(1, Math.round(1.5 * hpr));
      ctx.setLineDash([]);
      ctx.strokeRect(Math.round(left * hpr) + 0.5, Math.round(box.top * vpr) + 0.5, Math.round((right - left) * hpr), Math.max(1, Math.round((box.bottom - box.top) * vpr)));
    }
  }
  // Value Area: vạch trên của row cao nhất và vạch dưới của row thấp nhất
  if (st.va && b.vl >= 0 && b.vh >= 0) {
    const hi = rowBox(b.rows[b.vh]);
    const lo = rowBox(b.rows[b.vl]);
    ctx.strokeStyle = st.vaColor;
    ctx.lineWidth = Math.max(1, Math.round(hpr));
    ctx.setLineDash([4 * hpr, 3 * hpr]);
    for (const y of [hi?.top, lo?.bottom]) {
      if (y === undefined) continue;
      ctx.beginPath();
      ctx.moveTo(Math.round(left * hpr), Math.round(y * vpr) + 0.5);
      ctx.lineTo(Math.round(right * hpr), Math.round(y * vpr) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  drawCandle(ctx, series, b, st, geo.candleX, geo.candleW, hpr, vpr);

  // Info box dưới nến: tổng volume và delta
  if (st.summary && spacing >= 36) {
    const yl = price(b.l);
    const low = Math.max(...b.rows.map((r) => price(r.p) ?? 0), yl ?? 0);
    if (yl !== null) {
      const { total, delta } = fpTotals(b.rows);
      const px = Math.max(7, Math.min(st.textSize, 11));
      ctx.font = `${Math.round(px * vpr)}px ${FONT}`;
      ctx.textAlign = "center";
      const lines: [string, string][] = [[fpText(total, "auto"), st.text], [`${delta > 0 ? "+" : ""}${fpText(delta, "auto")}`, delta >= 0 ? st.buy : st.sell]];
      lines.forEach(([text, color], k) => {
        ctx.fillStyle = color;
        ctx.fillText(text, x * hpr, (low + 6 + px * (k + 0.7) * 1.2) * vpr);
      });
    }
  }
}
