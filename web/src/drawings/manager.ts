import { TF_SECONDS, fetchBars, type Bar } from "@/lib/api";
import { DrawingDoc, acquireDoc, releaseDoc, type DocView } from "./doc";
import { noteGuestDrawing } from "./storage";
import { crosshairLabel } from "@/lib/timefmt";
import type {
    IChartApi,
    IPrimitivePaneRenderer,
    IPrimitivePaneView,
    ISeriesApi,
    ISeriesPrimitive,
    ISeriesPrimitiveAxisView,
    SeriesAttachedParameter,
    SeriesType,
    Time,
} from "lightweight-charts";
import { PriceScaleMode } from "lightweight-charts";
import { barsBetween, logicalToTime, shiftAnchors, snapAngle, timeToLogical } from "./coords";
import { drawShapes, hitShapes, type Pt, type Shape } from "./shapes";
import { isActivePane, useLayoutStore } from "@/store/layout";
import type { DrawPane, Pane } from "@/store/paneStores";
import { DRAW_PANE_KEYS, drawingGlobal, type DrawingGlobal, type MagnetMode } from "./store";
import { visibleOn } from "./visibility";
import { defaultOpts, GROUPS, profileSpan, SPEC, TABLE_COL_W, tableCellAt, tableCells, tableRowH, type Ctx, type OneClickView } from "./tools";
import type { Anchor, Drawing, DrawingType } from "./types";

type Opts = {
  pane: Pane; // chart (pane) mà manager này vẽ lên: hình vẽ, hình đang chọn, hộp thoại nằm trong pane.draw
  chart: IChartApi;
  container: HTMLElement;
  getBars: () => Bar[];
  getDisplayBars?: () => Bar[]; // nến đang vẽ trên chart (Heikin Ashi...) cho magnet; mặc định = getBars
  getTf: () => string;
  getDigits: () => number;
  getTickSize: () => number;
};

type Hit = { kind: "point"; index: number } | { kind: "body" };

// Trạng thái tương tác: mỗi lúc chỉ ở 1 trạng thái. Hover tính riêng (hoveredId).
// before: ảnh chụp để undo, chỉ đưa vào undo khi thật sự có kéo (click chọn thì không).
type Mode =
  | { k: "idle" }
  // pressed: đang giữ chuột vẽ tay. downAt: chỗ nhấn điểm đầu, nhả xa chỗ đó = đặt điểm 2 (nhấn-kéo-thả)
  | { k: "drafting"; d: Drawing; placed: number; pressed: boolean; downAt: Pt | null }
  | { k: "dragPoint"; id: string; index: number; before: string; moved: boolean }
  | { k: "dragBody"; id: string; start: Pt; orig: Anchor[]; before: string; moved: boolean; a0?: Pt }; // a0: vị trí (tỉ lệ khung) của hình đang ghim

// Khung nhìn hiện tại; key đổi khi cuộn/zoom/đổi trục giá/có nến mới.
type View = { w: number; h: number; bars: Bar[]; step: number; key: string };
type Built = { key: string; c: Ctx; shapes: Shape[] };

type Mods = { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean };

const LOWER_TFS = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"]; // như danh sách khung của TV (backend không có M3)
const HANDLE_R = 8;
const DRAG_MIN = 5; // px: nhả chuột xa hơn chỗ nhấn mới tính là nhấn-kéo-thả
const AXIS_BG = "#2962ff";

export class DrawingManager implements ISeriesPrimitive<Time>, DocView {
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  // Hình vẽ, undo/redo và lưu trữ thuộc DrawingDoc của symbol đang mở, dùng chung với các chart khác cùng symbol.
  // Các accessor dưới đây giữ nguyên cách viết `this.drawings = ...` của code cũ.
  private doc: DrawingDoc = new DrawingDoc(null); // chưa mở symbol nào
  private get drawings(): Drawing[] { return this.doc.drawings; }
  private set drawings(v: Drawing[]) { this.doc.drawings = v; }
  private get kept(): unknown[] { return this.doc.kept; }
  private set kept(v: unknown[]) { this.doc.kept = v; }
  private get undoStack(): string[] { return this.doc.undoStack; }
  private set undoStack(v: string[]) { this.doc.undoStack = v; }
  private get redoStack(): string[] { return this.doc.redoStack; }
  private set redoStack(v: string[]) { this.doc.redoStack = v; }
  private cache = new WeakMap<Drawing, Built>();
  private profileBars = new Map<string, { bars: Bar[]; step: number }>(); // nến khung nhỏ của VP + giây mỗi nến
  private profileKeys = new Map<string, string>();
  private profileVer = 0;
  private hoveredId: string | null = null;
  private mode: Mode = { k: "idle" };
  private chartLock: { handleScroll: unknown; handleScale: unknown } | null = null;
  private pendingText: string | undefined;
  private symbol = "";
  private unsub: () => void;
  private stCache: { g: unknown; p: unknown; v: DrawingGlobal & DrawPane } | null = null;

  // Trạng thái công cụ dùng chung (tool, magnet...) gộp với trạng thái của pane này (hình đang chọn...): cùng hình dạng
  // với store trước khi tách theo pane. Cache theo tham chiếu nên gọi trong pointermove không cấp phát lại.
  private get st(): DrawingGlobal & DrawPane {
    const g = drawingGlobal.getState();
    const p = this.o.pane.draw.getState();
    if (!this.stCache || this.stCache.g !== g || this.stCache.p !== p) this.stCache = { g, p, v: { ...g, ...p } };
    return this.stCache.v;
  }

  private setSt(patch: Partial<DrawingGlobal & DrawPane>) {
    const keys = new Set<string>(DRAW_PANE_KEYS);
    const paneP: Record<string, unknown> = {};
    const globalP: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) (keys.has(k) ? paneP : globalP)[k] = v;
    if (Object.keys(paneP).length) this.o.pane.draw.setState(paneP as Partial<DrawPane>);
    if (Object.keys(globalP).length) drawingGlobal.setState(globalP as Partial<DrawingGlobal>);
  }

  constructor(private o: Opts) {
    o.container.addEventListener("pointerdown", this.onDown, true);
    o.container.addEventListener("pointermove", this.onMove, true);
    o.container.addEventListener("pointerleave", this.onLeave);
    o.container.addEventListener("dblclick", this.onDbl, true);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKey);
    o.pane.draw.setState({ api: this });
    const offGlobal = drawingGlobal.subscribe(() => this.refresh());
    const offPane = o.pane.draw.subscribe(() => this.refresh());
    this.unsub = () => {
      offGlobal();
      offPane();
    };
  }

  destroy() {
    this.o.container.removeEventListener("pointerdown", this.onDown, true);
    this.o.container.removeEventListener("pointermove", this.onMove, true);
    this.o.container.removeEventListener("pointerleave", this.onLeave);
    this.o.container.removeEventListener("dblclick", this.onDbl, true);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    this.unsub();
    this.unlockChart();
    releaseDoc(this.doc, this);
    this.o.pane.draw.setState({ api: null, drawings: [], selectedId: null });
  }

  // --- primitive ---
  attachTo(series: ISeriesApi<SeriesType>) {
    try { this.series?.detachPrimitive(this); } catch { /* series cũ đã bị remove */ }
    this.series = series;
    series.attachPrimitive(this);
  }
  attached(p: SeriesAttachedParameter<Time>) { this.redraw = p.requestUpdate; }
  detached() { this.redraw = null; }
  paneViews(): readonly IPrimitivePaneView[] { return [this.paneView]; }
  // Như TV: hình đang chọn / đang vẽ có nhãn giá và thời gian của từng điểm trên 2 trục,
  // kèm dải tô giữa điểm thấp nhất và cao nhất.
  updateAllViews() {
    this.axis = [];
    this.timeAxis = [];
    this.bands = { price: null, time: null };
    const st = this.st;
    if (st.hideAll || !this.series) return;
    const v = this.view();
    // Nhãn trục luôn hiện (vd "Price label" của Horizontal line/ray), kể cả hình không chọn
    for (const x of this.drawings) {
      if (x.id === st.selectedId || !this.shown(x)) continue;
      for (const s of this.built(x, v)?.shapes ?? []) {
        if (s.k === "axis" && s.always) this.axis.push({ coordinate: () => s.y, text: () => s.text, textColor: () => s.color, backColor: () => s.bg });
      }
    }
    const m = this.mode;
    const d = m.k === "drafting" ? { ...m.d, points: m.d.points.slice(0, m.placed + 1) } : this.selected();
    if (!d || !this.shown(d)) return;
    const spec = SPEC[d.type];
    if (!spec || this.pinned(d)) return; // hình đang ghim: không có nhãn thời gian / giá trên trục
    if (m.k !== "drafting") {
      const b = this.built(d, v);
      for (const s of b?.shapes ?? []) {
        if (s.k === "axis") this.axis.push({ coordinate: () => s.y, text: () => s.text, textColor: () => s.color, backColor: () => s.bg });
      }
    }
    const label = (coordinate: number, text: string): ISeriesPrimitiveAxisView =>
      ({ coordinate: () => coordinate, text: () => text, textColor: () => "#ffffff", backColor: () => AXIS_BG });
    const digits = this.o.getDigits();
    if (spec.axes !== "time") {
      const ys: number[] = [];
      for (const price of new Set(d.points.map((a) => a.price))) {
        const y = this.series.priceToCoordinate(price);
        if (y === null) continue;
        ys.push(y);
        // đã có nhãn của chính hình ở đúng giá này (Price label) thì không chồng thêm
        if (!this.axis.some((v) => Math.abs(v.coordinate() - y) < 0.5)) this.axis.push(label(y, price.toFixed(digits)));
      }
      if (ys.length > 1) this.bands.price = [Math.min(...ys), Math.max(...ys)];
    }
    if (spec.axes !== "price") {
      const xs: number[] = [];
      for (const t of new Set(d.points.map((a) => a.time))) {
        const x = this.timeToX(t);
        if (x === null) continue;
        xs.push(x);
        this.timeAxis.push(label(x, crosshairLabel(t)));
      }
      if (xs.length > 1) this.bands.time = [Math.min(...xs), Math.max(...xs)];
    }
  }
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] { return this.axis; }
  timeAxisViews(): readonly ISeriesPrimitiveAxisView[] { return this.timeAxis; }
  priceAxisPaneViews(): readonly IPrimitivePaneView[] { return [this.bandView("price")]; }
  timeAxisPaneViews(): readonly IPrimitivePaneView[] { return [this.bandView("time")]; }
  private axis: ISeriesPrimitiveAxisView[] = [];
  private timeAxis: ISeriesPrimitiveAxisView[] = [];
  private bands: { price: [number, number] | null; time: [number, number] | null } = { price: null, time: null };

  private bandView(which: "price" | "time"): IPrimitivePaneView {
    return {
      zOrder: () => "bottom",
      renderer: (): IPrimitivePaneRenderer => ({
        draw: (target) => {
          const band = this.bands[which];
          if (!band) return;
          target.useMediaCoordinateSpace(({ context, mediaSize }) => {
            context.fillStyle = "rgba(41, 98, 255, 0.25)";
            if (which === "price") context.fillRect(0, band[0], mediaSize.width, band[1] - band[0]);
            else context.fillRect(band[0], 0, band[1] - band[0], mediaSize.height);
          });
        },
      }),
    };
  }
  refresh() {
    // VP cần nến khung nhỏ: tải lại khi đổi khung chart, bật Extend Right, hoặc có nến mới (tự bỏ qua nếu không đổi)
    for (const d of this.drawings) this.prefetchProfileBars(d);
    this.redraw?.();
  }

  private paneView: IPrimitivePaneView = {
    zOrder: () => "top",
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) => {
        // Bitmap space: shapes.ts bắt nét ngang/dọc vào lưới pixel thiết bị (nét 1px không nhòe)
        target.useBitmapCoordinateSpace(({ context, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          const st = this.st;
          if (st.hideAll) return;
          context.save();
          context.scale(hpr, vpr);
          const v = this.view();
          for (const d of this.drawings) {
            if (!this.shown(d)) continue;
            const b = this.built(d, v);
            if (!b) continue;
            drawShapes(context, b.shapes, d, hpr);
            if (d.id === st.selectedId) this.drawHandles(context, d, b.c);
          }
          if (this.mode.k === "drafting") {
            const d = this.mode.d;
            const c = this.ctx(d, v, true);
            if (c) drawShapes(context, this.shapes(d, c), d, hpr);
          }
          context.restore();
        });
      },
    }),
  };

  private drawHandles(ctx: CanvasRenderingContext2D, d: Drawing, c: Ctx) {
    ctx.save();
    ctx.fillStyle = "rgba(15,15,15,0.55)";
    ctx.strokeStyle = "#2962ff";
    ctx.lineWidth = 2;
    for (const p of this.handlePts(d, c)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  // --- tọa độ ---
  private step() { return TF_SECONDS[this.o.getTf()] ?? 60; }

  private timeToLogical(t: number): number | null {
    return timeToLogical(this.o.getBars(), this.step(), t);
  }

  private logicalToTime(l: number): number | null {
    return logicalToTime(this.o.getBars(), this.step(), l);
  }

  private timeToX(t: number): number | null {
    const l = this.timeToLogical(t);
    if (l === null) return null;
    // logicalToCoordinate không ổn định với số thực -> nội suy giữa 2 chỉ số nguyên
    const ts = this.o.chart.timeScale();
    const i = Math.floor(l);
    const x0 = ts.logicalToCoordinate(i as never);
    if (x0 === null || i === l) return x0;
    const x1 = ts.logicalToCoordinate((i + 1) as never);
    return x1 === null ? x0 : x0 + (x1 - x0) * (l - i);
  }

  private toPx(a: Anchor): Pt | null {
    const x = this.timeToX(a.time);
    const y = this.series?.priceToCoordinate(a.price) ?? null;
    return x === null || y === null ? null : { x, y };
  }

  // magnet: null = tắt; weak = chỉ hút khi cách OHLC < 20px; strong = luôn hút về OHLC gần nhất
  private fromPx(p: Pt, magnet: MagnetMode | null = null): Anchor | null {
    if (!this.series) return null;
    const l = this.o.chart.timeScale().coordinateToLogical(p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (l === null || price === null) return null;
    const time = this.logicalToTime(l);
    if (time === null) return null;
    let pr = price as number;
    if (magnet) {
      // hút về OHLC của nến đang thấy (Heikin Ashi thì là giá HA, không phải giá gốc)
      const bar = (this.o.getDisplayBars?.() ?? this.o.getBars())[Math.round(l)];
      if (bar) {
        const best = [bar.o, bar.h, bar.l, bar.c]
          .map((v) => ({ v, d: Math.abs((this.series!.priceToCoordinate(v) ?? 1e9) - p.y) }))
          .sort((a, b) => a.d - b.d)[0];
        if (magnet === "strong" || best.d < 20) pr = best.v;
      }
    }
    return { time, price: pr };
  }

  // Điểm neo dưới con trỏ khi vẽ / kéo điểm, như TV:
  // - Shift: khóa hướng từ ref về ngang / dọc / 45° (bỏ qua magnet)
  // - Ctrl/Cmd: đảo magnet trong lúc giữ phím
  // - Shift với Rectangle/Ellipse (spec.shift = "square"): vuông / tròn trên màn hình, cạnh = cạnh dài
  private anchorAt(p: Pt, e: Mods, ref?: Anchor | null, square = false): Anchor | null {
    if (e.shiftKey && ref) {
      const r = this.toPx(ref);
      if (r && square) {
        const dx = p.x - r.x, dy = p.y - r.y, side = Math.max(Math.abs(dx), Math.abs(dy));
        return this.fromPx({ x: r.x + (Math.sign(dx) || 1) * side, y: r.y + (Math.sign(dy) || 1) * side });
      }
      if (r) {
        const s = snapAngle(p, r);
        const a = this.fromPx(s.p);
        if (a && s.axis === "h") a.price = ref.price;
        if (a && s.axis === "v") a.time = ref.time;
        return a;
      }
    }
    const st = this.st;
    return this.fromPx(p, st.magnet !== (e.ctrlKey || e.metaKey) ? st.magnetMode : null);
  }

  // Tool khóa góc được bằng Shift: hình nối các điểm, không có ràng buộc riêng
  private shiftable(type: DrawingType) {
    const spec = SPEC[type];
    return spec.n !== -1 && spec.n !== 1 && !spec.constrain && !spec.oneClick;
  }

  // Khung đang xem cho tool tạo bằng 1 click (Position: kích thước theo biên độ nến đang thấy)
  private oneClickView(span: number): OneClickView {
    const bars = this.o.getBars(), step = this.step();
    const r = this.o.chart.timeScale().getVisibleLogicalRange();
    const i0 = Math.max(0, Math.ceil(r?.from ?? 0)), i1 = Math.min(bars.length - 1, Math.floor(r?.to ?? bars.length - 1));
    const vis = bars.slice(i0, i1 + 1);
    return {
      span,
      hiLo: vis.length ? Math.max(...vis.map((b) => b.h)) - Math.min(...vis.map((b) => b.l)) : 0,
      visibleBars: vis.length,
      tick: this.tick(),
      addBars: (t, n) => shiftAnchors(bars, step, [{ time: t, price: 0 }], n, 0)?.[0].time ?? t + n * step,
    };
  }

  private draftRef(m: Extract<Mode, { k: "drafting" }>) {
    return this.shiftable(m.d.type) && m.placed > 0 ? m.d.points[m.placed - 1] : null;
  }

  private view(): View {
    const { w, h } = this.paneSize();
    const bars = this.o.getBars();
    const step = this.step();
    const r = this.o.chart.timeScale().getVisibleLogicalRange();
    const s = this.series;
    const last = bars[bars.length - 1];
    // Giá ở 3 điểm trên trục: bắt được cả cuộn/zoom giá lẫn đổi linear <-> log
    const key = [
      w, h, r?.from, r?.to, s?.coordinateToPrice(0), s?.coordinateToPrice(h / 2), s?.coordinateToPrice(h),
      bars.length, bars[0]?.t, last?.t, last?.h, last?.l, last?.c, step, this.o.getDigits(), this.o.getTickSize(), this.profileVer,
    ].join("|");
    return { w, h, bars, step, key };
  }

  private ctx(d: Drawing, v: View, pad = false): Ctx | null {
    const spec = SPEC[d.type];
    if (!spec || spec.disabled || !this.series) return null;
    const p: Pt[] = [];
    const pin = this.pinned(d);
    if (pin) p.push({ x: pin.x * v.w, y: pin.y * v.h });
    else for (const a of d.points) {
      const q = this.toPx(a);
      if (!q) return null;
      p.push(q);
    }
    const need = spec.n > 0 ? spec.n : 2;
    if (p.length < need) {
      if (!pad || p.length === 0) return null;
      while (p.length < need) p.push(p[p.length - 1]);
    }
    const series = this.series;
    const digits = this.o.getDigits();
    const { bars, step } = v;
    return {
      d: pad && d.points.length < need ? { ...d, points: [...d.points, ...Array(need - d.points.length).fill(d.points[d.points.length - 1])] } : d,
      p,
      w: v.w,
      h: v.h,
      bars,
      profileBars: this.profileBars.get(d.id)?.bars,
      profileStep: this.profileBars.get(d.id)?.step,
      tickSize: this.o.getTickSize(),
      hovered: d.id === this.hoveredId,
      selected: d.id === this.st.selectedId,
      dragging: this.dragging(d),
      step,
      barsBetween: (t0, t1) => barsBetween(bars, step, t0, t1),
      X: (t) => this.timeToX(t),
      Y: (price) => (series.priceToCoordinate(price) as number | null) ?? null,
      fp: (v) => v.toFixed(digits), // như TV: đủ số lẻ theo tick
      digits,
      log: series.priceScale().options().mode === PriceScaleMode.Logarithmic,
    };
  }

  private shapes(d: Drawing, c: Ctx): Shape[] {
    try {
      return SPEC[d.type].build(c);
    } catch {
      return [];
    }
  }

  // Shape của drawing đã lưu chỉ build lại khi drawing / khung nhìn / hover / chọn đổi.
  // Trước đây mỗi frame và mỗi lần di chuột đều build lại tất cả (VP, VWAP lặp toàn bộ nến).
  private built(d: Drawing, v: View): Built | null {
    const key = `${v.key}|${d.id === this.hoveredId}|${d.id === this.st.selectedId}|${this.dragging(d)}`;
    const hit = this.cache.get(d);
    if (hit?.key === key) return hit;
    const c = this.ctx(d, v);
    if (!c) return null;
    const b = { key, c, shapes: this.shapes(d, c) };
    this.cache.set(d, b);
    return b;
  }

  // Đang vẽ dở hình này, hoặc đang kéo nó thật sự (click chọn không tính)
  private dragging(d: Drawing) {
    const m = this.mode;
    return m.k === "drafting" ? m.d.id === d.id : (m.k === "dragPoint" || m.k === "dragBody") && m.id === d.id && m.moved;
  }

  // Ẩn tay (Hide) hoặc không hiện ở khung thời gian đang xem (Visibility)
  private shown(d: Drawing) {
    return !d.hidden && visibleOn(d.visibility, this.o.getTf());
  }

  private handlePts(d: Drawing, c: Ctx): Pt[] {
    return SPEC[d.type].handles?.(c) ?? c.p.slice(0, d.points.length);
  }

  // --- tương tác ---
  private rel(e: PointerEvent | MouseEvent): Pt {
    const r = this.o.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private paneSize() {
    return { w: this.o.chart.timeScale().width(), h: this.o.chart.paneSize(0).height };
  }

  // Hình đang ghim (Anchor của TV): vị trí theo tỉ lệ khung chart, không theo thời gian / giá
  private pinned(d: Drawing): Pt | null {
    return SPEC[d.type]?.anchorable && d.opts?.anchored ? { x: Number(d.opts.ax) || 0, y: Number(d.opts.ay) || 0 } : null;
  }

  private inPane(p: Pt) {
    const s = this.paneSize();
    return p.x >= 0 && p.x <= s.w && p.y >= 0 && p.y <= s.h;
  }

  private hitAt(p: Pt): { d: Drawing; hit: Hit } | null {
    const st = this.st;
    if (st.hideAll) return null;
    const v = this.view();
    const sel = this.selected();
    if (sel && this.shown(sel)) {
      const b = this.built(sel, v);
      const i = b ? this.handlePts(sel, b.c).findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= HANDLE_R) : -1;
      // handle riêng mà tool không định nghĩa cách kéo (hline, vline) = kéo cả hình
      const spec = SPEC[sel.type];
      if (i >= 0) return { d: sel, hit: spec.handles && !spec.moveHandle ? { kind: "body" } : { kind: "point", index: i } };
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (!this.shown(d)) continue;
      const b = this.built(d, v);
      if (b && hitShapes(b.shapes, p)) return { d, hit: { kind: "body" } };
    }
    return null;
  }

  private consume(e: Event) { e.preventDefault(); e.stopPropagation(); }

  // LWC nghe mouse*/touch* chứ không nghe pointer*: preventDefault pointerdown chỉ chặn được
  // chuột. Tắt pan/zoom của chart trong lúc nhấn để vẽ/kéo trên màn hình cảm ứng không trôi chart.
  private lockChart() {
    if (this.chartLock) return;
    // Phải sao chép: applyOptions của LWC merge vào chính object con mà options() trả về
    const { handleScroll, handleScale } = this.o.chart.options();
    this.chartLock = structuredClone({ handleScroll, handleScale });
    this.o.chart.applyOptions({ handleScroll: false, handleScale: false });
  }

  private unlockChart() {
    if (!this.chartLock) return;
    this.o.chart.applyOptions(this.chartLock as never);
    this.chartLock = null;
  }

  private newDraft(type: DrawingType): Drawing {
    const st = SPEC[type].style ?? {};
    const saved = this.st.toolDefaults[type] ?? {};
    return {
      id: crypto.randomUUID(),
      type,
      points: [],
      color: saved.color ?? st.color ?? "#2962ff",
      width: saved.width ?? st.width ?? 2,
      dash: saved.dash !== undefined ? saved.dash : st.dash,
      textColor: saved.textColor ?? st.textColor,
      opts: saved.opts ? structuredClone(saved.opts) : undefined,
      locked: false,
      hidden: false,
      text: this.pendingText,
    };
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const p = this.rel(e);
    if (!this.inPane(p)) return;
    const st = this.st;
    const tool = st.tool;

    if (tool === "eraser") {
      this.consume(e);
      this.lockChart();
      const f = this.hitAt(p);
      if (f) {
        this.pushUndo();
        this.drawings = this.drawings.filter((x) => x !== f.d);
        this.commit();
      }
      return;
    }

    if (tool && SPEC[tool]) {
      this.consume(e);
      this.lockChart();
      this.place(tool, p, e);
      return;
    }

    if (st.lockAll) return;
    const found = this.hitAt(p);
    this.select(found?.d.id ?? null);
    if (found && !found.d.locked) {
      this.consume(e);
      this.lockChart();
      const { d, hit } = found;
      const before = this.snapshot();
      const pin = this.pinned(d);
      this.mode = hit.kind === "point" && !pin
        ? { k: "dragPoint", id: d.id, index: hit.index, before, moved: false }
        : { k: "dragBody", id: d.id, start: p, orig: d.points.map((q) => ({ ...q })), before, moved: false, a0: pin ?? undefined };
    }
  };

  // Click khi đang cầm tool: điểm đầu tạo draft, các điểm sau đặt tiếp tới khi đủ
  private place(tool: DrawingType, p: Pt, e: Mods) {
    const spec = SPEC[tool];
    const m = this.mode;
    const a = this.anchorAt(p, e, m.k === "drafting" ? this.draftRef(m) : null, spec.shift === "square");
    if (!a) return;
    if (m.k !== "drafting") {
      const d = this.newDraft(tool);
      if (spec.oneClick) {
        const top = this.series?.coordinateToPrice(0);
        const bot = this.series?.coordinateToPrice(this.o.container.clientHeight);
        const span = top != null && bot != null ? Math.abs(top - bot) : 0;
        return this.finish(d, spec.oneClick(a, this.oneClickView(span)));
      }
      if (spec.n === 1) return this.finish(d, [a]);
      d.points = spec.n === -1 ? [a] : [a, { ...a }];
      this.mode = { k: "drafting", d, placed: 1, pressed: spec.n === -1, downAt: p };
    } else {
      m.d.points[m.placed] = a;
      m.placed++;
      if (spec.n > 0 && m.placed === spec.n) return this.finish(m.d, m.d.points.slice(0, spec.n));
      m.d.points.push({ ...a });
    }
    this.refresh();
  }

  private onDbl = (e: MouseEvent) => {
    const m = this.mode;
    if (m.k === "idle") {
      // double-click vào hình có text: sửa text tại chỗ
      const p = this.rel(e);
      const f = this.st.tool ? null : this.hitAt(p);
      if (f && SPEC[f.d.type].prompt && !f.d.locked) {
        this.consume(e);
        this.startEdit(f.d.id, false);
      } else if (f && SPEC[f.d.type].grid && !f.d.locked) {
        // Table: sửa đúng ô được double-click
        const origin = this.built(f.d, this.view())?.c.p[0];
        const cell = origin && tableCellAt(f.d, origin, p);
        if (cell) {
          this.consume(e);
          this.startEdit(f.d.id, false, cell);
        }
      }
      return;
    }
    if (m.k !== "drafting" || SPEC[m.d.type]?.n !== 0) return;
    this.consume(e);
    let pts = m.d.points.slice(0, m.placed);
    const last = this.toPx(pts[pts.length - 1]), prev = pts.length > 1 ? this.toPx(pts[pts.length - 2]) : null;
    if (last && prev && Math.hypot(last.x - prev.x, last.y - prev.y) < 6) pts = pts.slice(0, -1);
    this.finishMulti(m.d, pts);
  };

  private finishMulti(d: Drawing, pts: Anchor[]) {
    if (pts.length < 2) return this.cancelDraft();
    this.finish(d, pts);
  }

  private cancelDraft() {
    if (this.mode.k === "drafting") this.mode = { k: "idle" };
    this.refresh();
  }

  private finish(draft: Drawing, points: Anchor[]) {
    const spec = SPEC[draft.type];
    this.mode = { k: "idle" };
    let d: Drawing = { ...draft, points };
    const st = this.st;
    if (spec.init) {
      const c = this.ctx(d, this.view());
      if (c) d = spec.init(d, c);
    }

    if (spec.action === "zoom") {
      const ts = this.o.chart.timeScale();
      const xs = points.map((a) => this.timeToLogical(a.time)).filter((v): v is number => v !== null);
      if (xs.length === 2 && Math.abs(xs[0] - xs[1]) > 1) ts.setVisibleLogicalRange({ from: Math.min(...xs), to: Math.max(...xs) });
      if (!st.stay) this.setSt({ tool: null });
      this.refresh();
      return;
    }

    // Text gõ ngay trên chart (InlineTextEditor) thay vì window.prompt
    if (spec.prompt && d.text === undefined) d.text = d.type === "text" ? "" : spec.prompt;
    if (!spec.ephemeral) this.pushUndo(); // Measure không vào undo
    this.drawings.push(d);
    this.prefetchProfileBars(d);
    if (!st.stay) this.setSt({ tool: null });
    this.select(d.id);
    this.commit();
    if (spec.prompt) this.startEdit(d.id, true);
    else if (spec.grid) this.startEdit(d.id, true, [0, 0]);
  }

  private onMove = (e: PointerEvent) => {
    const p = this.rel(e);
    const m = this.mode;
    if (m.k === "drafting") {
      const a = this.anchorAt(p, e, this.draftRef(m), SPEC[m.d.type].shift === "square");
      if (SPEC[m.d.type].n === -1) {
        if (m.pressed && a) { m.d.points.push(a); this.refresh(); }
      } else if (a) {
        m.d.points[m.placed] = a;
        this.refresh();
      }
      this.consume(e);
      return;
    }
    if (m.k === "dragPoint" || m.k === "dragBody") {
      this.consume(e);
      const d = this.drawings.find((x) => x.id === m.id);
      if (!d) return;
      if (m.k === "dragPoint") {
        const spec = SPEC[d.type];
        // Shift: so với điểm kề (handle riêng: chỉ 2 góc neo của rectangle, so với góc đối diện)
        const other = spec.moveHandle ? (m.index < 2 ? 1 - m.index : -1) : m.index > 0 ? m.index - 1 : 1;
        const ref = this.shiftable(d.type) && other >= 0 ? d.points[other] : null;
        const a = this.anchorAt(p, e, ref, spec.shift === "square");
        if (!a) return;
        let pts: Anchor[];
        if (spec.moveHandle) pts = spec.moveHandle(d.points, m.index, a);
        else {
          pts = d.points.map((q) => ({ ...q }));
          pts[m.index] = a;
          spec.constrain?.(pts, m.index, this.tick(), d.points);
        }
        this.moveTo(m, d, pts);
      } else if (m.a0) {
        // hình đang ghim: dịch theo pixel, giữ trong khung chart
        const { w, h } = this.paneSize();
        const ax = Math.min(1, Math.max(0, m.a0.x + (p.x - m.start.x) / w)), ay = Math.min(1, Math.max(0, m.a0.y + (p.y - m.start.y) / h));
        if (ax === d.opts?.ax && ay === d.opts?.ay) return;
        m.moved = true;
        this.put({ ...d, opts: { ...d.opts, ax, ay } });
        this.refresh();
      } else {
        // Như TV: cả hình dịch cùng 1 delta (số nến, giá), không cho magnet hút từng điểm
        const ts = this.o.chart.timeScale();
        const l0 = ts.coordinateToLogical(m.start.x), l1 = ts.coordinateToLogical(p.x);
        const p0 = this.series?.coordinateToPrice(m.start.y), p1 = this.series?.coordinateToPrice(p.y);
        if (l0 === null || l1 === null || p0 == null || p1 == null) return;
        const pts = shiftAnchors(this.o.getBars(), this.step(), m.orig, Math.round(l1 - l0), p1 - p0);
        if (pts) this.moveTo(m, d, pts);
      }
      return;
    }
    const st = this.st;
    const hit = this.inPane(p) ? this.hitAt(p) : null;
    const hoveredId = hit?.d.id ?? null;
    if (hoveredId !== this.hoveredId) {
      this.hoveredId = hoveredId;
      this.refresh();
    }
    this.o.container.style.cursor = st.tool === "eraser" ? "cell" : st.tool ? "crosshair" : !st.lockAll && hit ? "move" : "";
  };

  private moveTo(m: { moved: boolean }, d: Drawing, points: Anchor[]) {
    if (JSON.stringify(points) === JSON.stringify(d.points)) return;
    m.moved = true;
    this.put({ ...d, points });
    this.refresh();
  }

  private onLeave = () => {
    if (this.hoveredId === null) return;
    this.hoveredId = null;
    this.refresh();
  };

  private onUp = (e: PointerEvent) => {
    this.unlockChart();
    const m = this.mode;
    if (m.k === "drafting") {
      if (m.pressed) {
        const pts = m.d.points;
        if (pts.length >= 2) this.finish(m.d, pts); else this.cancelDraft();
      } else if (m.downAt) {
        // Nhấn điểm đầu, kéo rồi nhả: chỗ nhả là điểm thứ 2 (ngoài cách click từng điểm)
        const p = this.rel(e), far = Math.hypot(p.x - m.downAt.x, p.y - m.downAt.y) > DRAG_MIN;
        m.downAt = null;
        if (far && e.type === "pointerup") this.place(m.d.type, p, e);
      }
      return;
    }
    if (m.k !== "dragPoint" && m.k !== "dragBody") return;
    this.mode = { k: "idle" };
    if (!m.moved) return; // chỉ click chọn: không undo, không lưu
    const d = this.drawings.find((x) => x.id === m.id);
    if (d) this.prefetchProfileBars(d);
    this.pushUndo(m.before);
    this.commit();
  };

  private onKey = (e: KeyboardEvent) => {
    if (!isActivePane(this.o.pane.id)) return; // phím tắt chỉ tác động chart đang active
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
    const mod = e.metaKey || e.ctrlKey;
    const m = this.mode;
    if (e.key === "Escape") {
      this.cancelDraft();
      this.setSt({ tool: null });
      this.select(null);
    } else if (e.key === "Enter" && m.k === "drafting" && SPEC[m.d.type].n === 0) {
      this.finishMulti(m.d, m.d.points.slice(0, m.placed));
    } else if (e.key === "Delete" || e.key === "Backspace") {
      this.deleteSelected();
    } else if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) this.redo(); else this.undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      this.redo();
    }
  };

  // --- API cho UI ---
  setTool(tool: DrawingType | null, text?: string) {
    this.cancelDraft();
    this.pendingText = text;
    const patch: { tool: DrawingType | null; lastTool?: Record<string, string> } = { tool };
    const g = tool && GROUPS.find((x) => x.sections.some((s) => s.ids.includes(tool)));
    if (g && tool) patch.lastTool = { ...this.st.lastTool, [g.id]: tool };
    this.setSt(patch);
    this.refresh();
  }

  private selected() {
    const id = this.st.selectedId;
    return id === null ? undefined : this.drawings.find((d) => d.id === id);
  }

  // Thay drawing cùng id bằng object mới
  private put(next: Drawing) {
    const i = this.drawings.findIndex((x) => x.id === next.id);
    if (i >= 0) this.drawings[i] = next;
  }

  select(id: string | null) {
    const stale = this.drawings.filter((d) => SPEC[d.type]?.ephemeral && d.id !== id);
    if (stale.length) {
      this.drawings = this.drawings.filter((d) => !stale.includes(d));
      this.setSt({ drawings: [...this.drawings] });
    }
    this.setSt({ selectedId: id });
    this.refresh();
  }

  update(patch: Partial<Pick<Drawing, "color" | "width" | "dash" | "textColor" | "locked" | "hidden" | "text" | "visibility">> & { opts?: Drawing["opts"] }) {
    const d = this.selected();
    if (!d) return;
    this.pushUndo();
    const { opts, ...rest } = patch;
    const next: Drawing = { ...d, ...rest, opts: opts ? { ...d.opts, ...opts } : d.opts };
    this.put(next);
    this.commit();

    // Lưu setting làm mặc định cho các lần vẽ tiếp theo của tool này (giống TradingView)
    const { setToolDefault } = this.st;
    const savePatch: Partial<Pick<Drawing, "color" | "width" | "dash" | "textColor" | "opts">> = {};
    if (patch.color !== undefined) savePatch.color = patch.color;
    if (patch.width !== undefined) savePatch.width = patch.width;
    if (patch.dash !== undefined) savePatch.dash = patch.dash;
    if (patch.textColor !== undefined) savePatch.textColor = patch.textColor;
    if (opts !== undefined) savePatch.opts = defaultOpts(next.opts);
    if (Object.keys(savePatch).length > 0) {
      setToolDefault(d.type, savePatch);
    }
  }

  // Xem trước từ Settings: chart đổi ngay nhưng không vào undo, không lưu; Ok chốt (replaceSelected), đóng thì trả lại bản gốc
  preview(next: Drawing) {
    if (!this.drawings.some((x) => x.id === next.id)) return;
    this.put(next);
    this.setSt({ drawings: [...this.drawings] });
    this.refresh();
  }

  /** `orig`: bản trước khi mở Settings; trả về trước khi ghi undo để Ctrl+Z quay về đúng bản đó, không phải bản xem trước. */
  replaceSelected(next: Drawing, orig?: Drawing) {
    if (!this.drawings.some((x) => x.id === next.id)) return;
    if (orig) this.put(orig);
    // Position: lúc gõ trong Settings không kẹp; bấm Ok mới kẹp target/stop về đúng phía + tròn tick
    const spec = SPEC[next.type];
    if (spec?.panel === "position" && spec.constrain) {
      const pts = next.points.map((q) => ({ ...q }));
      spec.constrain(pts, 1, this.tick());
      spec.constrain(pts, 3, this.tick());
      next = { ...next, points: pts };
    }
    this.pushUndo();
    this.put(next);
    this.commit();

    // Lưu setting làm mặc định cho các lần vẽ tiếp theo của tool này
    const { setToolDefault } = this.st;
    setToolDefault(next.type, {
      color: next.color,
      width: next.width,
      dash: next.dash,
      textColor: next.textColor,
      opts: defaultOpts(next.opts),
    });
  }

  // Anchor của TV: ghim hình đang chọn cố định trên màn hình / bỏ ghim (về lại thời gian + giá ở chỗ đang đứng)
  toggleAnchor() {
    const d = this.selected();
    const b = d && SPEC[d.type]?.anchorable ? this.built(d, this.view()) : null;
    if (!d || !b) return;
    const { w, h } = this.paneSize();
    const at = b.c.p[0];
    let next: Drawing;
    if (this.pinned(d)) {
      const a = this.fromPx(at);
      if (!a) return;
      next = { ...d, points: [a, ...d.points.slice(1)], opts: { ...d.opts, anchored: false } };
    } else next = { ...d, opts: { ...d.opts, anchored: true, ax: at.x / w, ay: at.y / h } };
    this.pushUndo();
    this.put(next);
    this.commit();
  }

  // Table: thêm cột bên phải / hàng bên dưới
  tableAdd(what: "row" | "col") {
    const d = this.selected();
    if (!d || !SPEC[d.type]?.grid) return;
    const cells = tableCells(d);
    const [key, n] = what === "row" ? ["rows", cells.length + 1] : ["cols", cells[0].length + 1];
    this.pushUndo();
    this.put({ ...d, opts: { ...d.opts, [key]: n } });
    this.commit();
  }

  // --- sửa text inline ---
  startEdit(id: string, isNew: boolean, cell?: [number, number]) {
    this.select(id);
    this.setSt({ editing: { id, isNew, cell } });
  }

  // Góc trên-trái ô sửa text (tọa độ chart): điểm mang text của hình; Table: giữa cạnh trái của ô
  textAnchor(id: string): Pt | null {
    const d = this.drawings.find((x) => x.id === id);
    const b = d && this.built(d, this.view());
    if (!d || !b) return null;
    const cell = this.st.editing?.cell;
    if (cell) {
      const rh = tableRowH(d), o = b.c.p[0];
      return { x: o.x + TABLE_COL_W * cell[1] + 4, y: o.y + rh * cell[0] + rh / 2 };
    }
    return SPEC[d.type].n === 2 ? b.c.p[1] : b.c.p[0];
  }

  // text = null: hủy (Esc). Hình mới tạo mà hủy / để trống thì bỏ luôn, kể cả bước undo lúc tạo.
  endEdit(text: string | null) {
    const ed = this.st.editing;
    if (!ed) return;
    this.setSt({ editing: null });
    const d = this.drawings.find((x) => x.id === ed.id);
    if (!d) return;
    if (ed.cell) {
      // Table: Esc giữ nguyên ô (bảng mới tạo vẫn giữ lại, như TV)
      const cells = tableCells(d);
      const [r, k] = ed.cell;
      if (text === null || !cells[r] || cells[r][k] === text) return;
      cells[r][k] = text;
      if (!ed.isNew) this.pushUndo();
      this.put({ ...d, opts: { ...d.opts, cells: JSON.stringify(cells) } });
      this.commit();
      return;
    }
    const value = text === null ? d.text ?? "" : text.trim() ? text : d.type === "text" ? "" : SPEC[d.type].prompt ?? "";
    if (!value && d.type === "text") {
      if (ed.isNew) this.undoStack.pop(); else this.pushUndo();
      this.drawings = this.drawings.filter((x) => x !== d);
      this.setSt({ selectedId: null });
      this.commit();
      return;
    }
    if (value === d.text) return;
    if (!ed.isNew) this.pushUndo(); // hình mới: gộp vào bước undo lúc tạo
    this.put({ ...d, text: value });
    this.commit();
  }

  deleteSelected() {
    const d = this.selected();
    if (!d) return;
    this.pushUndo();
    this.drawings = this.drawings.filter((x) => x !== d);
    this.setSt({ selectedId: null });
    this.commit();
  }

  clearAll() {
    if (this.drawings.length === 0) return;
    this.pushUndo();
    this.drawings = [];
    this.setSt({ selectedId: null });
    this.commit();
  }

  cloneSelected() {
    const d = this.selected();
    if (!d) return;
    this.pushUndo();
    // như TV: bản sao nằm đúng chỗ bản gốc (trước đây dịch giá ×0.999)
    const c: Drawing = { ...d, id: crypto.randomUUID(), points: d.points.map((p) => ({ ...p })) };
    this.drawings.push(c);
    this.setSt({ selectedId: c.id });
    this.commit();
  }

  // Thứ tự vẽ = thứ tự mảng, hình ở cuối nằm trên cùng. forward / backward nhích 1 bậc như "Visual order" của TV.
  reorder(to: "front" | "back" | "forward" | "backward") {
    const d = this.selected();
    if (!d) return;
    const at = this.drawings.indexOf(d);
    const rest = this.drawings.filter((x) => x !== d);
    const next = to === "front" ? rest.length : to === "back" ? 0 : Math.max(0, Math.min(rest.length, at + (to === "forward" ? 1 : -1)));
    if (next === at) return;
    this.pushUndo();
    rest.splice(next, 0, d);
    this.drawings = rest;
    this.commit();
  }

  // Chuột phải: hình dưới con trỏ được chọn luôn (như TV) để menu và thanh nổi cùng nói về nó
  pickAt(e: MouseEvent): Drawing | null {
    const found = this.hitAt(this.rel(e));
    if (found) this.select(found.d.id);
    return found?.d ?? null;
  }

  // --- undo / redo ---
  private tick() {
    const t = this.o.getTickSize();
    return t > 0 ? t : 10 ** -this.o.getDigits();
  }

  // Measure (ephemeral) không thuộc lịch sử undo
  private snapshot() {
    return JSON.stringify(this.drawings.filter((d) => !SPEC[d.type]?.ephemeral));
  }

  private pushUndo(snap = this.snapshot()) {
    this.undoStack.push(snap);
    if (this.undoStack.length > 100) this.undoStack.shift();
    this.redoStack = [];
  }
  private restore(json: string) {
    this.drawings = JSON.parse(json);
    if (!this.selected()) this.setSt({ selectedId: null });
    this.commit();
  }
  undo() {
    const s = this.undoStack.pop();
    if (s === undefined) return;
    this.redoStack.push(this.snapshot());
    this.restore(s);
  }
  redo() {
    const s = this.redoStack.pop();
    if (s === undefined) return;
    this.undoStack.push(this.snapshot());
    this.restore(s);
  }

  // --- lưu trữ ---
  private commit() {
    this.setSt({ drawings: [...this.drawings] });
    this.refresh();
    this.doc.changed(this); // lên lịch lưu + các chart khác cùng symbol vẽ lại
    noteGuestDrawing();
  }

  /** Lưu ngay và đợi server trả lời (dùng trước khi đổi/đóng phiên đăng nhập). */
  flushSave(): Promise<void> {
    return this.doc.flush();
  }

  // --- DocView: DrawingDoc gọi khi hình đổi từ bên ngoài ---
  docChanged() {
    this.setSt({ drawings: [...this.drawings] });
    const sel = this.st.selectedId;
    if (sel !== null && !this.drawings.some((d) => d.id === sel)) this.setSt({ selectedId: null }); // hình đang chọn bị xoá ở chart khác
    for (const d of this.drawings) this.prefetchProfileBars(d);
    this.refresh();
  }

  docLoaded(known: Drawing[]) {
    for (const d of known) this.prefetchProfileBars(d);
    this.setSt({ drawings: [...this.drawings] });
    this.refresh();
  }

  docReset() {
    this.mode = { k: "idle" };
    this.unlockChart();
    this.profileBars.clear();
    this.profileKeys.clear();
    this.profileVer++;
    this.setSt({ drawings: [], selectedId: null });
    this.refresh();
  }

  private setProfileBars(id: string, bars: Bar[] | undefined, step = 0) {
    if (bars) this.profileBars.set(id, { bars, step }); else this.profileBars.delete(id);
    this.profileVer++;
  }

  // FRVP / AVP chia volume theo nến khung nhỏ như TV: khung đầu tiên trong M1…D1 (nhỏ hơn khung chart) mà khoảng
  // đó có dưới 5000 nến. Không có thì dùng nến của chart (tools.profileSource lo phần ghép).
  private prefetchProfileBars(d: Drawing) {
    if (!this.symbol || this.dragging(d)) return; // đang kéo: chỉ có vạch dọc, thả ra mới tải
    const symbol = this.symbol;
    const bars = this.o.getBars();
    const chartStep = this.step();
    const span = profileSpan(d, bars[bars.length - 1]?.t ?? 0);
    if (!span) return;
    const to = span.t1 + chartStep - 1; // gồm cả các nến khung nhỏ nằm trong nến cuối
    const base = `${symbol}|${chartStep}|${span.t0}`;
    const key = `${base}|${to}`;
    const prev = this.profileKeys.get(d.id);
    if (prev === key) return;
    this.profileKeys.set(d.id, key);
    // Chỉ dài thêm đuôi (có nến mới): giữ dữ liệu cũ tới khi tải xong, khỏi nháy về nến chart
    if (!prev?.startsWith(`${base}|`)) this.setProfileBars(d.id, undefined);
    void (async () => {
      let fine: { bars: Bar[]; step: number } | null = null;
      for (const tf of LOWER_TFS) {
        if (TF_SECONDS[tf] >= chartStep) break;
        const got = await fetchBars(symbol, tf, to, 5000, span.t0);
        if (this.profileKeys.get(d.id) !== key) return;
        if (got.length > 0 && got.length < 5000) {
          fine = { bars: got, step: TF_SECONDS[tf] };
          break;
        }
      }
      if (fine) this.setProfileBars(d.id, fine.bars, fine.step);
      else this.setProfileBars(d.id, undefined);
      this.refresh();
    })().catch(() => {
      if (this.profileKeys.get(d.id) === key) this.refresh();
    });
  }

  setSymbol(symbol: string) {
    // Đổi timeframe vẫn cùng symbol: giữ nguyên drawings, chỉ vẽ lại.
    if (symbol === this.symbol) { this.refresh(); return; }
    releaseDoc(this.doc, this); // view cuối của symbol cũ đi thì doc đó lưu nốt rồi đóng
    this.symbol = symbol;
    this.doc = acquireDoc(symbol, this, useLayoutStore.getState().layoutId); // chart khác đang mở symbol này thì dùng chung doc (đã nạp sẵn)
    this.profileBars.clear();
    this.profileKeys.clear();
    this.profileVer++;
    this.mode = { k: "idle" };
    this.unlockChart();
    this.setSt({ drawings: [...this.drawings], selectedId: null });
    for (const d of this.drawings) this.prefetchProfileBars(d);
    this.refresh();
  }
}
