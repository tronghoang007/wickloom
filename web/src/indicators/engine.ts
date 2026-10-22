import type { Bar } from "@/lib/api";
import type { CalendarOpts } from "./calendar";
import { resolveInputs, type IndicatorInstance } from "./instance";
import type { Computed, IndicatorDef, PlotData } from "./schema";
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

/** Tính mọi plot của 1 instance trên `bars` (đã gồm lịch sử nạp ngầm). Luôn trả đủ plot của def; mỗi plot dài bars.length, cộng thêm offset nếu offset dương. */
export function computeInstance(def: IndicatorDef, inst: IndicatorInstance, bars: Bar[], calendar: CalendarOpts): Computed {
  const memo = new Map<string, Num>();
  const src = (name: string) => {
    let s = memo.get(name);
    if (!s) memo.set(name, (s = source(bars, name)));
    return s;
  };
  const inputs = resolveInputs(def, inst.inputs);
  const raw = def.compute({ bars, inputs, src, calendar });
  const out: Computed = {};
  for (const p of def.plots) {
    const r = raw[p.id];
    const d: PlotData | undefined = Array.isArray(r) ? { values: r } : r;
    const ok: PlotData = d && d.values.length === bars.length ? d : { values: nan(bars.length) };
    const offset = p.offset ? Number(inputs[p.offset]) || 0 : 0;
    out[p.id] = offset === 0 ? ok : { values: shiftBy(ok.values, offset, NaN), ...(ok.colors ? { colors: shiftBy(ok.colors, offset, "") } : {}) };
  }
  return out;
}

/** Bỏ `cut` nến đầu (lịch sử nạp ngầm): chỉ phần trùng với nến chart mới được vẽ, để trục thời gian của chart không đổi. */
export function trimPlot(d: PlotData, cut: number): PlotData {
  return cut === 0 ? d : { values: d.values.slice(cut), ...(d.colors ? { colors: d.colors.slice(cut) } : {}) };
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
