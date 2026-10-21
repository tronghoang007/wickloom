import { API, TF_SECONDS, fetchBars, type Bar } from "@/lib/api";
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
import { barsBetween, logicalToTime, shiftAnchors, timeToLogical } from "./coords";
import { drawShapes, hitShapes, type Pt, type Shape } from "./shapes";
import { useDrawingStore } from "./store";
import { DrawingSync } from "./sync";
import { GROUPS, SPEC, type Ctx } from "./tools";
import type { Anchor, Drawing, DrawingType } from "./types";

type Opts = {
  chart: IChartApi;
  container: HTMLElement;
  getBars: () => Bar[];
  getTf: () => string;
  getDigits: () => number;
  getTickSize: () => number;
};

type Hit = { kind: "point"; index: number } | { kind: "body" };
// before: ảnh chụp để undo, chỉ đưa vào undo khi thật sự có kéo (click chọn thì không)
type Drag = { id: string; hit: Hit; start: Pt; orig: Anchor[]; before: string; moved: boolean };

const HANDLE_R = 8;

export class DrawingManager implements ISeriesPrimitive<Time> {
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;
  private drawings: Drawing[] = [];
  private kept: unknown[] = []; // item trên server có type app không biết: giữ nguyên khi lưu
  private profileBars = new Map<string, Bar[]>();
  private profileKeys = new Map<string, string>();
  private hoveredId: string | null = null;
  private draft: Drawing | null = null;
  private placed = 0;
  private pressed = false;
  private pendingText: string | undefined;
  private drag: Drag | null = null;
  private symbol = "";
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private sync = new DrawingSync({
    url: (symbol) => `${API}/drawings/${encodeURIComponent(symbol)}__default`,
    items: () => [...this.kept, ...this.drawings.filter((d) => !SPEC[d.type]?.ephemeral)],
    onLoad: (items) => this.onLoaded(items),
  });
  private unsub: () => void;

  constructor(private o: Opts) {
    o.container.addEventListener("pointerdown", this.onDown, true);
    o.container.addEventListener("pointermove", this.onMove, true);
    o.container.addEventListener("pointerleave", this.onLeave);
    o.container.addEventListener("dblclick", this.onDbl, true);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("keydown", this.onKey);
    useDrawingStore.setState({ api: this });
    this.unsub = useDrawingStore.subscribe(() => this.refresh());
  }

  destroy() {
    this.o.container.removeEventListener("pointerdown", this.onDown, true);
    this.o.container.removeEventListener("pointermove", this.onMove, true);
    this.o.container.removeEventListener("pointerleave", this.onLeave);
    this.o.container.removeEventListener("dblclick", this.onDbl, true);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("keydown", this.onKey);
    this.unsub();
    this.sync.close();
    useDrawingStore.setState({ api: null, drawings: [], selectedId: null });
  }

  // --- primitive ---
  attachTo(series: ISeriesApi<SeriesType>) {
    try { this.series?.detachPrimitive(this); } catch { /* series cũ đã bị remove */ }
    this.series = series;
    series.attachPrimitive(this);
  }
  attached(p: SeriesAttachedParameter<Time>) { this.redraw = p.requestUpdate; }
  detached() { this.redraw = null; }
  paneViews(): readonly IPrimitivePaneView[] { return [this.view]; }
  updateAllViews() {
    this.axis = [];
    const st = useDrawingStore.getState();
    const d = this.drawings.find((x) => x.id === st.selectedId);
    if (!d || d.hidden || st.hideAll) return;
    const { w, h } = this.paneSize();
    const c = this.ctx(d, w, h);
    if (!c) return;
    for (const s of this.shapes(d, c)) {
      if (s.k === "axis") this.axis.push({ coordinate: () => s.y, text: () => s.text, textColor: () => s.color, backColor: () => s.bg });
    }
  }
  priceAxisViews(): readonly ISeriesPrimitiveAxisView[] { return this.axis; }
  private axis: ISeriesPrimitiveAxisView[] = [];
  refresh() { this.redraw?.(); }

  private view: IPrimitivePaneView = {
    zOrder: () => "top",
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) => {
        target.useMediaCoordinateSpace(({ context, mediaSize }) => {
          const st = useDrawingStore.getState();
          if (st.hideAll) return;
          const all = this.draft ? [...this.drawings, this.draft] : this.drawings;
          for (const d of all) {
            if (d.hidden) continue;
            const c = this.ctx(d, mediaSize.width, mediaSize.height, d === this.draft);
            if (!c) continue;
            drawShapes(context, this.shapes(d, c), d);
            if (d.id === st.selectedId) this.drawHandles(context, d, c);
          }
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

  private fromPx(p: Pt): Anchor | null {
    if (!this.series) return null;
    const l = this.o.chart.timeScale().coordinateToLogical(p.x);
    const price = this.series.coordinateToPrice(p.y);
    if (l === null || price === null) return null;
    const time = this.logicalToTime(l);
    if (time === null) return null;
    let pr = price as number;
    if (useDrawingStore.getState().magnet) {
      const bar = this.o.getBars()[Math.round(l)];
      if (bar) {
        const best = [bar.o, bar.h, bar.l, bar.c]
          .map((v) => ({ v, d: Math.abs((this.series!.priceToCoordinate(v) ?? 1e9) - p.y) }))
          .sort((a, b) => a.d - b.d)[0];
        if (best.d < 20) pr = best.v;
      }
    }
    return { time, price: pr };
  }

  private ctx(d: Drawing, w: number, h: number, pad = false): Ctx | null {
    const spec = SPEC[d.type];
    if (!spec || spec.disabled || !this.series) return null;
    const p: Pt[] = [];
    for (const a of d.points) {
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
    const bars = this.o.getBars();
    const step = this.step();
    return {
      d: pad && d.points.length < need ? { ...d, points: [...d.points, ...Array(need - d.points.length).fill(d.points[d.points.length - 1])] } : d,
      p,
      w,
      h,
      bars,
      profileBars: this.profileBars.get(d.id),
      tickSize: this.o.getTickSize(),
      hovered: d.id === this.hoveredId,
      selected: d.id === useDrawingStore.getState().selectedId,
      step,
      barsBetween: (t0, t1) => barsBetween(bars, step, t0, t1),
      X: (t) => this.timeToX(t),
      Y: (price) => (series.priceToCoordinate(price) as number | null) ?? null,
      fp: (v) => v.toFixed(Math.abs(v) >= 100 ? Math.min(digits, 2) : digits),
      digits,
    };
  }

  private shapes(d: Drawing, c: Ctx): Shape[] {
    try {
      return SPEC[d.type].build(c);
    } catch {
      return [];
    }
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

  private inPane(p: Pt) {
    const s = this.paneSize();
    return p.x >= 0 && p.x <= s.w && p.y >= 0 && p.y <= s.h;
  }

  private hitAt(p: Pt): { d: Drawing; hit: Hit } | null {
    const st = useDrawingStore.getState();
    if (st.hideAll) return null;
    const { w, h } = this.paneSize();
    const cache = new Map<string, Ctx | null>();
    const get = (d: Drawing) => {
      if (!cache.has(d.id)) cache.set(d.id, this.ctx(d, w, h));
      return cache.get(d.id)!;
    };
    const sel = this.drawings.find((d) => d.id === st.selectedId);
    const handleHit = (d: Drawing): Hit | null => {
      const c = get(d);
      if (!c) return null;
      const hp = this.handlePts(d, c);
      const custom = !!SPEC[d.type].handles;
      const i = hp.findIndex((q) => Math.hypot(q.x - p.x, q.y - p.y) <= HANDLE_R);
      return i < 0 ? null : custom ? { kind: "body" } : { kind: "point", index: i };
    };
    if (sel && !sel.hidden) {
      const h2 = handleHit(sel);
      if (h2) return { d: sel, hit: h2 };
    }
    for (let i = this.drawings.length - 1; i >= 0; i--) {
      const d = this.drawings[i];
      if (d.hidden) continue;
      const c = get(d);
      if (!c) continue;
      if (hitShapes(this.shapes(d, c), p)) return { d, hit: { kind: "body" } };
    }
    return null;
  }

  private consume(e: Event) { e.preventDefault(); e.stopPropagation(); }

  private newDraft(type: DrawingType): Drawing {
    const st = SPEC[type].style ?? {};
    const saved = useDrawingStore.getState().toolDefaults[type] ?? {};
    return {
      id: crypto.randomUUID(),
      type,
      points: [],
      color: saved.color ?? st.color ?? "#2962ff",
      width: saved.width ?? st.width ?? 2,
      dash: saved.dash !== undefined ? saved.dash : st.dash,
      textColor: saved.textColor,
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
    const st = useDrawingStore.getState();
    const tool = st.tool;

    if (tool === "eraser") {
      this.consume(e);
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
      const spec = SPEC[tool];
      const a = this.fromPx(p);
      if (!a) return;
      if (!this.draft) {
        this.draft = this.newDraft(tool);
        if (spec.oneClick) {
          const top = this.series?.coordinateToPrice(0);
          const bot = this.series?.coordinateToPrice(this.o.container.clientHeight);
          const span = top != null && bot != null ? Math.abs(top - bot) : 0;
          return this.finish(spec.oneClick(a, this.step(), span));
        }
        this.draft.points = [a];
        this.placed = 1;
        if (spec.n === 1) return this.finish([a]);
        if (spec.n === -1) { this.pressed = true; this.refresh(); return; }
        this.draft.points.push({ ...a });
      } else {
        this.draft.points[this.placed] = a;
        this.placed++;
        if (spec.n > 0 && this.placed === spec.n) return this.finish(this.draft.points.slice(0, spec.n));
        this.draft.points.push({ ...a });
      }
      this.refresh();
      return;
    }

    if (st.lockAll) return;
    const found = this.hitAt(p);
    this.select(found?.d.id ?? null);
    if (found && !found.d.locked) {
      this.consume(e);
      this.drag = { id: found.d.id, hit: found.hit, start: p, orig: found.d.points.map((q) => ({ ...q })), before: this.snapshot(), moved: false };
    }
  };

  private onDbl = (e: MouseEvent) => {
    const spec = this.draft && SPEC[this.draft.type];
    if (!this.draft || !spec || spec.n !== 0) return;
    this.consume(e);
    let pts = this.draft.points.slice(0, this.placed);
    const last = this.toPx(pts[pts.length - 1]), prev = pts.length > 1 ? this.toPx(pts[pts.length - 2]) : null;
    if (last && prev && Math.hypot(last.x - prev.x, last.y - prev.y) < 6) pts = pts.slice(0, -1);
    this.finishMulti(pts);
  };

  private finishMulti(pts: Anchor[]) {
    if (pts.length < 2) return this.cancelDraft();
    this.finish(pts);
  }

  private cancelDraft() {
    this.draft = null;
    this.placed = 0;
    this.pressed = false;
    this.refresh();
  }

  private finish(points: Anchor[]) {
    const d = this.draft!;
    const spec = SPEC[d.type];
    this.draft = null;
    this.placed = 0;
    this.pressed = false;
    d.points = points;
    const st = useDrawingStore.getState();

    if (spec.action === "zoom") {
      const ts = this.o.chart.timeScale();
      const xs = points.map((a) => this.timeToLogical(a.time)).filter((v): v is number => v !== null);
      if (xs.length === 2 && Math.abs(xs[0] - xs[1]) > 1) ts.setVisibleLogicalRange({ from: Math.min(...xs), to: Math.max(...xs) });
      if (!st.stay) useDrawingStore.setState({ tool: null });
      this.refresh();
      return;
    }

    if (spec.prompt) {
      const t = window.prompt(spec.prompt, d.text ?? spec.prompt);
      if (t === null || (d.type === "text" && !t)) {
        useDrawingStore.setState({ tool: null });
        this.refresh();
        return;
      }
      d.text = t;
    }
    if (!spec.ephemeral) this.pushUndo(); // Measure không vào undo
    this.drawings.push(d);
    this.prefetchProfileBars(d);
    if (!st.stay) useDrawingStore.setState({ tool: null });
    this.select(d.id);
    this.commit();
  }

  private onMove = (e: PointerEvent) => {
    const p = this.rel(e);
    const spec = this.draft && SPEC[this.draft.type];
    if (this.draft && spec) {
      const a = this.fromPx(p);
      if (spec.n === -1) {
        if (this.pressed && a) { this.draft.points.push(a); this.refresh(); }
      } else if (a) {
        this.draft.points[this.placed] = a;
        this.refresh();
      }
      this.consume(e);
      return;
    }
    if (this.drag) {
      this.consume(e);
      const d = this.drawings.find((x) => x.id === this.drag!.id);
      if (!d) return;
      const { hit, start, orig } = this.drag;
      const prev = JSON.stringify(d.points);
      if (hit.kind === "point") {
        const a = this.fromPx(p);
        if (a) {
          d.points[hit.index] = a;
          SPEC[d.type].constrain?.(d.points, hit.index, this.tick());
        }
      } else {
        // Như TV: cả hình dịch cùng 1 delta (số nến, giá), không cho magnet hút từng điểm
        const ts = this.o.chart.timeScale();
        const l0 = ts.coordinateToLogical(start.x), l1 = ts.coordinateToLogical(p.x);
        const p0 = this.series?.coordinateToPrice(start.y), p1 = this.series?.coordinateToPrice(p.y);
        if (l0 !== null && l1 !== null && p0 != null && p1 != null) {
          const moved = shiftAnchors(this.o.getBars(), this.step(), orig, Math.round(l1 - l0), p1 - p0);
          if (moved) d.points = moved;
        }
      }
      if (JSON.stringify(d.points) !== prev) this.drag.moved = true;
      this.refresh();
      return;
    }
    const st = useDrawingStore.getState();
    const hit = this.inPane(p) ? this.hitAt(p) : null;
    const hoveredId = hit?.d.id ?? null;
    if (hoveredId !== this.hoveredId) {
      this.hoveredId = hoveredId;
      this.refresh();
    }
    this.o.container.style.cursor = st.tool === "eraser" ? "cell" : st.tool ? "crosshair" : !st.lockAll && hit ? "move" : "";
  };

  private onLeave = () => {
    if (this.hoveredId === null) return;
    this.hoveredId = null;
    this.refresh();
  };

  private onUp = () => {
    if (this.draft && SPEC[this.draft.type].n === -1 && this.pressed) {
      const pts = this.draft.points;
      return pts.length >= 2 ? this.finish(pts) : this.cancelDraft();
    }
    if (!this.drag) return;
    const { id, before, moved } = this.drag;
    this.drag = null;
    if (!moved) return; // chỉ click chọn: không undo, không lưu
    const d = this.drawings.find((x) => x.id === id);
    if (d) this.prefetchProfileBars(d);
    this.pushUndo(before);
    this.commit();
  };

  private onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement;
    if (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT") return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "Escape") {
      this.cancelDraft();
      useDrawingStore.setState({ tool: null });
      this.select(null);
    } else if (e.key === "Enter" && this.draft && SPEC[this.draft.type].n === 0) {
      this.finishMulti(this.draft.points.slice(0, this.placed));
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
    if (g && tool) patch.lastTool = { ...useDrawingStore.getState().lastTool, [g.id]: tool };
    useDrawingStore.setState(patch);
    this.refresh();
  }

  private selected() {
    return this.drawings.find((d) => d.id === useDrawingStore.getState().selectedId);
  }

  select(id: string | null) {
    const stale = this.drawings.filter((d) => SPEC[d.type]?.ephemeral && d.id !== id);
    if (stale.length) {
      this.drawings = this.drawings.filter((d) => !stale.includes(d));
      useDrawingStore.setState({ drawings: [...this.drawings] });
    }
    useDrawingStore.setState({ selectedId: id });
    this.refresh();
  }

  update(patch: Partial<Pick<Drawing, "color" | "width" | "dash" | "textColor" | "locked" | "hidden" | "text">> & { opts?: Drawing["opts"] }) {
    const d = this.selected();
    if (!d) return;
    this.pushUndo();
    const { opts, ...rest } = patch;
    Object.assign(d, rest);
    if (opts) d.opts = { ...d.opts, ...opts };
    this.commit();

    // Lưu setting làm mặc định cho các lần vẽ tiếp theo của tool này (giống TradingView)
    const { setToolDefault } = useDrawingStore.getState();
    const savePatch: Partial<Pick<Drawing, "color" | "width" | "dash" | "textColor" | "opts">> = {};
    if (patch.color !== undefined) savePatch.color = patch.color;
    if (patch.width !== undefined) savePatch.width = patch.width;
    if (patch.dash !== undefined) savePatch.dash = patch.dash;
    if (patch.textColor !== undefined) savePatch.textColor = patch.textColor;
    if (opts !== undefined) savePatch.opts = { ...d.opts };
    if (Object.keys(savePatch).length > 0) {
      setToolDefault(d.type, savePatch);
    }
  }

  replaceSelected(next: Drawing) {
    const i = this.drawings.findIndex((x) => x.id === next.id);
    if (i < 0) return;
    this.pushUndo();
    this.drawings[i] = next;
    this.commit();

    // Lưu setting làm mặc định cho các lần vẽ tiếp theo của tool này
    const { setToolDefault } = useDrawingStore.getState();
    setToolDefault(next.type, {
      color: next.color,
      width: next.width,
      dash: next.dash,
      textColor: next.textColor,
      opts: next.opts ? { ...next.opts } : undefined,
    });
  }

  deleteSelected() {
    const d = this.selected();
    if (!d) return;
    this.pushUndo();
    this.drawings = this.drawings.filter((x) => x !== d);
    useDrawingStore.setState({ selectedId: null });
    this.commit();
  }

  clearAll() {
    if (this.drawings.length === 0) return;
    this.pushUndo();
    this.drawings = [];
    useDrawingStore.setState({ selectedId: null });
    this.commit();
  }

  cloneSelected() {
    const d = this.selected();
    if (!d) return;
    this.pushUndo();
    const c: Drawing = { ...d, id: crypto.randomUUID(), points: d.points.map((p) => ({ time: p.time, price: p.price * 0.999 })) };
    this.drawings.push(c);
    useDrawingStore.setState({ selectedId: c.id });
    this.commit();
  }

  reorder(to: "front" | "back") {
    const d = this.selected();
    if (!d) return;
    this.pushUndo();
    this.drawings = this.drawings.filter((x) => x !== d);
    if (to === "front") this.drawings.push(d); else this.drawings.unshift(d);
    this.commit();
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
    if (!this.selected()) useDrawingStore.setState({ selectedId: null });
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
    useDrawingStore.setState({ drawings: [...this.drawings] });
    this.refresh();
    this.sync.schedule();
  }

  private prefetchProfileBars(d: Drawing) {
    if (d.type !== "frvp" || d.points.length < 2 || !this.symbol) return;
    const t0 = Math.min(d.points[0].time, d.points[1].time);
    const t1 = Math.max(d.points[0].time, d.points[1].time);
    const lowerTfs = ["M1", "M5", "M15", "M30", "H1", "H4", "D1"];
    const key = `${this.symbol}|${t0}|${t1}`;
    if (this.profileKeys.get(d.id) === key) return;
    this.profileKeys.set(d.id, key);
    this.profileBars.delete(d.id);
    void (async () => {
      for (const tf of lowerTfs) {
        if (this.profileKeys.get(d.id) !== key) return;
        const bars = await fetchBars(this.symbol, tf, t1, 5000, t0);
        if (bars.length > 0 && bars.length < 5000) {
          this.profileBars.set(d.id, bars);
          break;
        }
      }
      if (this.profileKeys.get(d.id) === key) this.refresh();
    })().catch(() => {
      if (this.profileKeys.get(d.id) === key) this.refresh();
    });
  }

  setSymbol(symbol: string) {
    // Đổi timeframe vẫn cùng symbol: giữ nguyên drawings, chỉ vẽ lại.
    if (symbol === this.symbol) { this.refresh(); return; }
    this.sync.open(symbol); // lưu nốt symbol cũ rồi mới load symbol mới
    this.symbol = symbol;
    this.drawings = [];
    this.kept = [];
    this.profileBars.clear();
    this.profileKeys.clear();
    this.draft = null;
    this.drag = null;
    this.undoStack = [];
    this.redoStack = [];
    useDrawingStore.setState({ drawings: [], selectedId: null });
    this.refresh();
  }

  // Bản trên server về: đặt dưới các hình đã vẽ trong lúc chờ load
  private onLoaded(items: unknown[]) {
    const known: Drawing[] = [];
    this.kept = [];
    for (const it of items) {
      const d = it as Drawing;
      const spec = d && SPEC[d.type];
      if (spec && Array.isArray(d.points) && d.points.length >= spec.n) known.push(d);
      else this.kept.push(it);
    }
    this.drawings = [...known, ...this.drawings];
    // ảnh chụp undo cũ chưa có bản server: undo về đó sẽ xóa mất drawings
    this.undoStack = [];
    this.redoStack = [];
    for (const d of known) this.prefetchProfileBars(d);
    useDrawingStore.setState({ drawings: [...this.drawings] });
    this.refresh();
  }
}
