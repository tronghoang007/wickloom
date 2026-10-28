import type { Bar } from "@/lib/api";
import type { CalendarOpts } from "./calendar";
import { resolveInputs, type IndicatorInstance } from "./instance";
import { sanitizeObjects } from "./objects";
import { itemStyles } from "./style";
import type { Computed, Ctx, FootprintSet, IndicatorDef, ObjectSet, PlotData, ProfileSet, TickSource } from "./schema";
import { nan, source, type Num } from "./ta";

/** Dịch `a` sang phải `offset` phần tử (âm = sang trái); dương thì mảng dài thêm `offset` (vùng tương lai). Chỗ trống là `fill`. */
export function shiftBy<T>(a: T[], offset: number, fill: T): T[] {
  if (offset === 0) return a;
  const out = new Array<T>(a.length + Math.max(0, offset)).fill(fill);
  for (let i = 0; i < a.length; i++) {
    const j = i + offset;
    if (j >= 0 && j < out.length) out[j] = a[i];
  }
  return out;
}

/** Mốc thời gian của `count` nến tương lai nối tiếp `last`, mỗi nến cách `step` giây (xấp xỉ: không nhảy cuối tuần/nghỉ). */
export const futureTimes = (last: number, count: number, step: number): number[] => Array.from({ length: count }, (_, k) => last + (k + 1) * step);

/** Phần môi trường của chart mà compute có thể cần ngoài nến: kích thước tick, vùng đang nhìn. */
export type Env = { tick?: number; range?: { from: number; to: number }; cut?: number; ticks?: TickSource; memo?: Record<string, unknown> };

function makeCtx(def: IndicatorDef, inst: IndicatorInstance, bars: Bar[], calendar: CalendarOpts, lower: Bar[] = [], env: Env = {}): Ctx {
  const memo = new Map<string, Num>();
  const src = (name: string) => {
    let s = memo.get(name);
    if (!s) memo.set(name, (s = source(bars, name)));
    return s;
  };
  return { bars, inputs: resolveInputs(def, inst.inputs), src, calendar, lower, items: itemStyles(inst, def), tick: env.tick && env.tick > 0 ? env.tick : 0.01, cut: env.cut ?? 0, ...(env.range ? { range: env.range } : {}), ...(env.ticks ? { ticks: env.ticks } : {}), ...(env.memo ? { memo: env.memo } : {}) };
}

/** Tính mọi plot của 1 instance trên `bars` (đã gồm lịch sử nạp ngầm). Luôn trả đủ plot của def; mỗi plot dài bars.length, cộng thêm offset nếu offset dương. */
export function computeInstance(def: IndicatorDef, inst: IndicatorInstance, bars: Bar[], calendar: CalendarOpts, lower: Bar[] = []): Computed {
  const ctx = makeCtx(def, inst, bars, calendar, lower);
  const { inputs } = ctx;
  const raw = def.compute(ctx);
  const out: Computed = {};
  for (const p of def.plots) {
    const r = raw[p.id];
    const d: PlotData | undefined = Array.isArray(r) ? { values: r } : r;
    const candleOk = p.type !== "candles" || (d?.candle && d.candle.o.length === bars.length && d.candle.h.length === bars.length && d.candle.l.length === bars.length);
    const ok: PlotData = d && d.values.length === bars.length && candleOk ? d : { values: nan(bars.length), ...(p.type === "candles" ? { candle: { o: nan(bars.length), h: nan(bars.length), l: nan(bars.length) } } : {}) };
    const offset = (typeof p.offset === "function" ? p.offset(inputs) : p.offset ? Number(inputs[p.offset]) : 0) || 0;
    const cd = ok.candle;
    out[p.id] =
      offset === 0
        ? ok
        : {
            values: shiftBy(ok.values, offset, NaN),
            ...(ok.colors ? { colors: shiftBy(ok.colors, offset, "") } : {}),
            ...(cd ? { candle: { o: shiftBy(cd.o, offset, NaN), h: shiftBy(cd.h, offset, NaN), l: shiftBy(cd.l, offset, NaN) } } : {}),
          };
  }
  return out;
}

/** Phần không phải chuỗi theo nến: object line/label/box và màu ghi đè nến chart chính (null = def không có / trả sai độ dài). */
export type Extras = { objects: ObjectSet | null; candleColors: string[] | null; profiles: ProfileSet | null; footprints: FootprintSet | null };

export function computeExtras(def: IndicatorDef, inst: IndicatorInstance, bars: Bar[], calendar: CalendarOpts, lower: Bar[] = [], env: Env = {}): Extras {
  if (!def.objects && !def.candleColors && !def.profiles && !def.footprints) return { objects: null, candleColors: null, profiles: null, footprints: null };
  const ctx = makeCtx(def, inst, bars, calendar, lower, env);
  const objects = def.objects ? sanitizeObjects(def.objects(ctx)) : null;
  const colors = def.candleColors?.(ctx);
  return {
    objects,
    candleColors: colors && colors.length === bars.length ? colors : null,
    profiles: def.profiles ? def.profiles(ctx) : null,
    footprints: def.footprints ? def.footprints(ctx) : null,
  };
}

/** Bỏ `cut` nến đầu (lịch sử nạp ngầm): chỉ phần trùng với nến chart mới được vẽ, để trục thời gian của chart không đổi. */
export function trimPlot(d: PlotData, cut: number): PlotData {
  if (cut === 0) return d;
  const c = d.candle;
  return {
    values: d.values.slice(cut),
    ...(d.colors ? { colors: d.colors.slice(cut) } : {}),
    ...(c ? { candle: { o: c.o.slice(cut), h: c.h.slice(cut), l: c.l.slice(cut) } } : {}),
  };
}

/** Số nến cần nạp (gồm cả nến chart) để các indicator hội tụ: tối thiểu `floor`, hoặc warmup lớn nhất + nến chart. */
export function historyTarget(defs: IndicatorDef[], insts: IndicatorInstance[], chartBars: number, floor: number): number {
  let warm = 0;
  for (const inst of insts) {
    const def = defs.find((d) => d.id === inst.id);
    if (def) warm = Math.max(warm, def.warmup(resolveInputs(def, inst.inputs)));
  }
  return Math.max(floor, warm + chartBars);
}
