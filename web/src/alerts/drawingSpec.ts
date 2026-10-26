import { timeToLogical } from "@/drawings/coords";
import { optOf, SPEC } from "@/drawings/tools";
import type { Drawing } from "@/drawings/types";
import type { AlertCond, AlertDrawing } from "@/lib/alertsApi";
import type { Bar } from "@/lib/api";

// Alert trên hình vẽ (docs/alerts-plan.md Phase 2). Web giữ bản sao toạ độ hình trong alert (backend không đọc layout); công thức giá ở nến hiện tại là bản port của
// backend/app/geometry.py và dùng cùng `timeToLogical` với cách chart vẽ hình: đường thẳng trong không gian (chỉ số nến, giá hoặc ln giá).

export type ShapeKind = "line" | "channel" | "rect";
/** Công cụ vẽ tạo được alert: loại hình học + số điểm neo (trùng backend geometry.SUPPORTED). */
export const ALERT_SHAPES: Record<string, { kind: ShapeKind; n: number }> = {
  trendline: { kind: "line", n: 2 },
  ray: { kind: "line", n: 2 },
  extended: { kind: "line", n: 2 },
  infoline: { kind: "line", n: 2 },
  hline: { kind: "line", n: 1 },
  hray: { kind: "line", n: 1 },
  channel: { kind: "channel", n: 3 },
  rect: { kind: "rect", n: 2 },
};

export const supportsAlert = (type: string) => type in ALERT_SHAPES;
/** Điều kiện của đường (cắt / trên / dưới) và của dải giá (kênh, hình chữ nhật). */
export const LINE_CONDS: AlertCond[] = ["cross", "cross_up", "cross_down", "gt", "lt"];
export const BAND_CONDS: AlertCond[] = ["cross", "enter", "exit", "inside", "outside"];
export const condsFor = (d: Pick<AlertDrawing, "type"> | null): AlertCond[] => (d && ALERT_SHAPES[d.type]?.kind !== "line" ? BAND_CONDS : LINE_CONDS);
export const defaultCondFor = (d: Pick<AlertDrawing, "type"> | null): AlertCond => (d && ALERT_SHAPES[d.type]?.kind !== "line" ? "enter" : "cross");

export type SpecCtx = { layout: string; log: boolean };
const EXT = ["none", "left", "right", "both"] as const;

/** Bản sao hình để gắn vào alert; null nếu loại hình chưa hỗ trợ hoặc thiếu điểm. */
export function specFromDrawing(d: Drawing, ctx: SpecCtx): AlertDrawing | null {
  const shape = ALERT_SHAPES[d.type];
  if (!shape || d.points.length < shape.n) return null;
  const ext = String(optOf(d, "extend") ?? "none");
  return {
    id: d.id,
    layout: ctx.layout,
    type: d.type,
    label: SPEC[d.type]?.label ?? d.type,
    pts: d.points.slice(0, shape.n).map((p) => [Math.round(p.time), p.price] as [number, number]),
    ext: (EXT as readonly string[]).includes(ext) && shape.n > 1 ? (ext as AlertDrawing["ext"]) : "none",
    log: ctx.log,
  };
}

/** Khoá hình học để biết hình đã đổi chưa (điểm neo + kiểu kéo dài); màu / độ dày / chữ không ảnh hưởng alert. */
export const geometrySig = (s: Pick<AlertDrawing, "type" | "pts" | "ext"> & Partial<AlertDrawing>) => JSON.stringify([s.type, s.pts, s.ext]);

export type Geo = { state: "ok" | "wait" | "done"; lo: number; hi: number };

/** Dải giá [lo, hi] của hình ở chỉ số nến `lNow` (`ls` = chỉ số nến của từng điểm neo, cùng gốc): bản port của backend geometry.geometry. */
export function geometryAt(spec: AlertDrawing, ls: number[], lNow: number): Geo {
  const shape = ALERT_SHAPES[spec.type];
  const none = (state: Geo["state"]): Geo => ({ state, lo: 0, hi: 0 });
  const fwd = spec.ext === "right" || spec.ext === "both";
  const back = spec.ext === "left" || spec.ext === "both";
  const bounded = (l0: number, l1: number): Geo["state"] | null => (lNow < l0 && !back ? "wait" : lNow > l1 && !fwd ? "done" : null);
  const pts = spec.pts;
  if (shape.n === 1) return spec.type === "hray" && lNow < ls[0] ? none("wait") : { state: "ok", lo: pts[0][1], hi: pts[0][1] };
  if (shape.kind === "rect") {
    const st = bounded(Math.min(ls[0], ls[1]), Math.max(ls[0], ls[1]));
    return { state: st ?? "ok", lo: Math.min(pts[0][1], pts[1][1]), hi: Math.max(pts[0][1], pts[1][1]) };
  }
  const log = spec.log && pts.every(([, p]) => p > 0);
  const g = (v: number) => (log ? Math.log(v) : v);
  const gi = (v: number) => (log ? Math.exp(v) : v);
  const [[la, pa], [lb, pb]] = [[ls[0], pts[0][1]], [ls[1], pts[1][1]]].sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const st = bounded(la, lb);
  if (st) return none(st);
  const slope = lb !== la ? (g(pb) - g(pa)) / (lb - la) : 0;
  const base = g(pa) + slope * (lNow - la);
  if (shape.kind === "line") return { state: "ok", lo: gi(base), hi: gi(base) };
  const off = g(pts[2][1]) - (g(pa) + slope * (ls[2] - la));
  const v1 = gi(base), v2 = gi(base + off);
  return { state: "ok", lo: Math.min(v1, v2), hi: Math.max(v1, v2) };
}

/** Dải giá của hình ở nến đang chạy theo nến của chart (nến cuối của `bars` là nến đang chạy): để dialog cho xem "hiện đang ở ...". null khi chưa có nến. */
export function levelNow(spec: AlertDrawing, bars: Bar[], step: number): Geo | null {
  if (bars.length === 0) return null;
  const ls = spec.pts.map(([t]) => timeToLogical(bars, step, t));
  if (ls.some((l) => l === null)) return null;
  return geometryAt(spec, ls as number[], bars.length - 1);
}

/** Mô tả dải / mức cho thông báo: "4001.2" hoặc "4000–4010". */
export const spanText = (lo: number, hi: number, fmt: (v: number) => string) => (lo === hi ? fmt(lo) : `${fmt(lo)}–${fmt(hi)}`);
