import type { Bar } from "@/lib/api";
import type { CalendarOpts } from "./calendar";
import { resolveInputs, type IndicatorInstance } from "./instance";
import type { Computed, IndicatorDef, PlotData } from "./schema";
import { nan, source, type Num } from "./ta";

/** Tính mọi plot của 1 instance trên `bars` (đã gồm lịch sử nạp ngầm). Luôn trả đủ plot của def, mỗi plot dài đúng bars.length. */
export function computeInstance(def: IndicatorDef, inst: IndicatorInstance, bars: Bar[], calendar: CalendarOpts): Computed {
  const memo = new Map<string, Num>();
  const src = (name: string) => {
    let s = memo.get(name);
    if (!s) memo.set(name, (s = source(bars, name)));
    return s;
  };
  const raw = def.compute({ bars, inputs: resolveInputs(def, inst.inputs), src, calendar });
  const out: Computed = {};
  for (const p of def.plots) {
    const r = raw[p.id];
    const d: PlotData | undefined = Array.isArray(r) ? { values: r } : r;
    out[p.id] = d && d.values.length === bars.length ? d : { values: nan(bars.length) };
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
