import type { IndicatorDef } from "./schema";
import { plotShown, type IndicatorInstance } from "./instance";
import type { PlotValue } from "./manager";

/** Số chữ số giá trị trên legend: user đặt thì theo, không thì indicator trên chart chính theo giá (số chữ số của symbol), pane riêng là 2 (như TV). */
export const legendDigits = (inst: IndicatorInstance, def: IndicatorDef, symbolDigits: number): number =>
  inst.precision ?? (def.overlay ? symbolDigits : 2);

/** "4,131.155", âm là "−1.93" (dấu trừ Unicode như TV), na là "∅". */
export function fmtPlotValue(v: number, digits: number): string {
  if (!Number.isFinite(v)) return "∅";
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v < 0 && Number(s.replace(/,/g, "")) !== 0 ? `−${s}` : s;
}

/** Các giá trị hiện trên legend: bỏ plot đã tắt trong Style. Chưa có dữ liệu thì rỗng. */
export const visiblePlotValues = (inst: IndicatorInstance, values: PlotValue[] | undefined): PlotValue[] =>
  (values ?? []).filter((v) => plotShown(inst, v.id));
