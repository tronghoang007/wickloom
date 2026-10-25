import { profileLevels, type LineKind, type Profile } from "@/volumeProfile/compute";
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
import type { LineStyleName, PlacedProfile, ProfileSet, ProfileStyle } from "../schema";

export type RowSeg = { x0: number; x1: number; color: string; alpha: number };
export type RowLabel = { x: number; text: string; align: "left" | "right" };
/** `labels`: nhãn riêng của row (Delta + Total: delta bên trái, total bên phải); không có thì một nhãn `shown` ở cuối thanh. */
export type RowLayout = { i: number; priceLo: number; priceHi: number; segs: RowSeg[]; len: number; shown: number; labels?: RowLabel[] };
/** `axis`: hoành độ trục giữa của Delta + Total (delta kéo sang trái, total sang phải). */
export type ProfileLayout = { rows: RowLayout[]; lines: { kind: LineKind; price: number }[]; base: number; dir: 1 | -1; axis?: number };

const VA_ALPHA = 0.75;
const OUT_ALPHA = 0.4;

/** Bố cục histogram của một profile trong khoảng ngang [left, right] (cùng đơn vị): mỗi row là một hoặc hai đoạn ngang (Up/Down) hay một đoạn (Total / Delta),
 *  hoặc hai đoạn ngược chiều quanh một trục (Delta + Total: bề rộng histogram chia đôi, delta theo |delta| / row lệch nhất sang trái, total theo volume / row lớn nhất sang phải);
 *  row nằm trong Value Area đậm hơn; kèm giá POC / VAH / VAL. Cùng cách vẽ với FRVP / AVP của drawings. */
export function layoutProfile(vp: Profile, st: ProfileStyle, left: number, right: number): ProfileLayout {
  const { lo, hi, size, N, up, dn, total, mv, vl, vh } = vp;
  const histW = Math.max(20, ((right - left) * st.width) / 100);
  const dir: 1 | -1 = st.place === "right" ? -1 : 1;
  const base = dir === 1 ? left : right;
  const delta = up.map((u, i) => u - dn[i]);
  const maxDelta = Math.max(...delta.map(Math.abs));
  const axis = (dir === 1 ? base : base - histW) + histW / 2;
  const rows: RowLayout[] = [];
  for (let i = 0; i < N; i++) {
    const inVa = i >= vl && i <= vh;
    const alpha = inVa ? VA_ALPHA : OUT_ALPHA;
    const upColor = inVa ? st.vaUp : st.up;
    const downColor = inVa ? st.vaDown : st.down;
    const segs: RowSeg[] = [];
    let len = (total[i] / mv) * histW;
    let labels: RowLabel[] | undefined;
    if (st.volume === "deltatotal") {
      const lenD = maxDelta > 0 ? (Math.abs(delta[i]) / maxDelta) * (histW / 2) : 0;
      len = (total[i] / mv) * (histW / 2);
      if (lenD > 0) segs.push({ x0: axis, x1: axis - lenD, color: delta[i] > 0 ? upColor : downColor, alpha });
      if (len > 0) segs.push({ x0: axis, x1: axis + len, color: upColor, alpha });
      labels = [
        ...(Math.round(delta[i]) !== 0 ? [{ x: axis - lenD - 3, text: String(Math.round(delta[i])), align: "right" as const }] : []),
        ...(Math.round(total[i]) !== 0 ? [{ x: axis + len + 3, text: String(Math.round(total[i])), align: "left" as const }] : []),
      ];
    } else if (st.volume === "delta") {
      len = maxDelta > 0 ? (Math.abs(delta[i]) / maxDelta) * histW : 0;
      if (len > 0) segs.push({ x0: base, x1: base + dir * len, color: delta[i] > 0 ? upColor : downColor, alpha });
    } else if (st.volume === "total") {
      segs.push({ x0: base, x1: base + dir * len, color: upColor, alpha });
    } else {
      const wUp = (up[i] / mv) * histW;
      const wDn = (dn[i] / mv) * histW;
      if (wUp > 0) segs.push({ x0: base, x1: base + dir * wUp, color: upColor, alpha });
      if (wDn > 0) segs.push({ x0: base + dir * wUp, x1: base + dir * (wUp + wDn), color: downColor, alpha });
    }
    rows.push({ i, priceLo: lo + size * i, priceHi: Math.min(hi, lo + size * (i + 1)), segs, len, shown: st.volume === "delta" ? delta[i] : total[i], ...(labels ? { labels } : {}) });
  }
  return {
    rows,
    base,
    dir,
    ...(st.volume === "deltatotal" ? { axis } : {}),
    lines: profileLevels(vp),
  };
}

/** Hoành độ cuối của đường `kind`: ghim (Visible Range) thì hết pane; Extend thì tới nến đầu tiên cắt qua mức (`p.end`, như TV "extend right"), chưa nến nào cắt thì hết pane; không thì hết phiên (`right`). */
export function lineEndX(p: PlacedProfile, kind: LineKind, st: ProfileStyle, right: number, W: number, xOf: (logical: number) => number | null): number {
  if (st.pinned) return W;
  if (!st.extend) return right;
  const k = p.end?.[kind];
  return (k === undefined ? null : xOf(k)) ?? W;
}

const dash = (style: LineStyleName, w: number): number[] => (style === "dashed" ? [6 * w, 6 * w] : style === "dotted" ? [w, 3 * w] : []);

/** Vẽ volume profile của indicator: mỗi phiên một histogram ở đầu / cuối phiên, hoặc một profile ghim vào mép pane (Visible Range). */
export class ProfilePrimitive implements ISeriesPrimitive<Time> {
  private data: ProfileSet | null = null;
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

  set(data: ProfileSet | null) {
    this.data = data;
    this.redraw?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  private view: IPrimitivePaneView = {
    zOrder: () => "bottom", // sau nến: histogram không che nến
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) => {
        const d = this.data;
        const chart = this.chart;
        const series = this.series;
        if (!d || !chart || !series || d.profiles.length === 0) return;
        const ts = chart.timeScale();
        const st = d.style;
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          const W = bitmapSize.width / hpr;
          for (const p of d.profiles) {
            let left = 0;
            let right = W;
            if (!st.pinned) {
              const xa = ts.logicalToCoordinate(p.x1 as Logical);
              const xb = ts.logicalToCoordinate(p.x2 as Logical);
              const xn = ts.logicalToCoordinate((p.x1 + 1) as Logical);
              if (xa === null || xb === null || xn === null) continue;
              const half = Math.abs(xn - xa) / 2;
              left = xa - half;
              right = xb + half;
              if (right < 0 || left > W) continue;
            }
            const lay = layoutProfile(p, st, left, right);
            ctx.textBaseline = "middle";
            ctx.font = `${9 * vpr}px -apple-system, "Trebuchet MS", sans-serif`;
            ctx.textAlign = lay.dir === 1 ? "left" : "right";
            for (const r of lay.rows) {
              const yb = series.priceToCoordinate(r.priceLo);
              const yt = series.priceToCoordinate(r.priceHi);
              if (yb === null || yt === null) continue;
              const top = Math.min(yb, yt);
              const bottom = Math.max(yb, yt);
              const barBottom = bottom - top >= 3 ? bottom - 1 : bottom; // khe 1px giữa các thanh khi row đủ cao, như TV
              for (const s of r.segs) {
                ctx.globalAlpha = s.alpha;
                ctx.fillStyle = s.color;
                ctx.fillRect(Math.min(s.x0, s.x1) * hpr, top * vpr, Math.abs(s.x1 - s.x0) * hpr, (barBottom - top) * vpr);
              }
              ctx.globalAlpha = 1;
              if (st.values && r.labels) {
                ctx.fillStyle = "#b2b5be";
                for (const l of r.labels) {
                  ctx.textAlign = l.align;
                  ctx.fillText(l.text, l.x * hpr, ((yb + yt) / 2) * vpr);
                }
                ctx.textAlign = lay.dir === 1 ? "left" : "right";
              } else if (st.values && Math.round(r.shown) !== 0) {
                ctx.fillStyle = "#b2b5be";
                ctx.fillText(String(Math.round(r.shown)), (lay.base + lay.dir * (r.len + 3)) * hpr, ((yb + yt) / 2) * vpr);
              }
            }
            if (lay.axis !== undefined && lay.rows.length > 0) {
              // trục giữa của Delta + Total: nét mảnh từ đáy row thấp nhất tới đỉnh row cao nhất
              const yLow = series.priceToCoordinate(lay.rows[0].priceLo);
              const yHigh = series.priceToCoordinate(lay.rows[lay.rows.length - 1].priceHi);
              if (yLow !== null && yHigh !== null) {
                ctx.strokeStyle = "#787b86";
                ctx.lineWidth = Math.max(1, Math.round(hpr));
                ctx.setLineDash([]);
                ctx.beginPath();
                ctx.moveTo(Math.round(lay.axis * hpr) + 0.5, yLow * vpr);
                ctx.lineTo(Math.round(lay.axis * hpr) + 0.5, yHigh * vpr);
                ctx.stroke();
              }
            }
            ctx.setLineDash([]);
            for (const l of lay.lines) {
              const cfg = st[l.kind];
              const y = series.priceToCoordinate(l.price);
              if (!cfg.show || y === null) continue;
              const w = Math.max(1, Math.round(cfg.width * hpr));
              ctx.strokeStyle = cfg.color;
              ctx.lineWidth = w;
              ctx.setLineDash(dash(cfg.style, w));
              ctx.beginPath();
              ctx.moveTo(left * hpr, y * vpr);
              ctx.lineTo(lineEndX(p, l.kind, st, right, W, (k) => ts.logicalToCoordinate(k as Logical)) * hpr, y * vpr);
              ctx.stroke();
            }
            ctx.setLineDash([]);
          }
        });
      },
    }),
  };
}
