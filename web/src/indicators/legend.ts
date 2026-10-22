import type { IndicatorDef } from "./schema";
import { plotShown, type IndicatorInstance } from "./instance";
import type { PlotValue } from "./manager";

/** Số chữ số giá trị trên legend: user đặt thì theo, không thì indicator trên chart chính theo giá (số chữ số của symbol), pane riêng là 2 (như TV). */
export const legendDigits = (inst: IndicatorInstance, def: IndicatorDef, symbolDigits: number): number =>
  inst.precision ?? (def.overlay ? symbolDigits : 2);

/** "4,131.155", âm là "−1.93" (dấu trừ Unicode như TV), na là "∅". `volume`: "1.15K", "−2.30M", dưới 1000 giữ nguyên số. */
export function fmtPlotValue(v: number, digits: number, volume = false): string {
  if (!Number.isFinite(v)) return "∅";
  if (volume) {
    const a = Math.abs(v);
    const [div, unit] = a >= 1e9 ? [1e9, "B"] : a >= 1e6 ? [1e6, "M"] : a >= 1e3 ? [1e3, "K"] : [1, ""];
    const body = unit ? (a / div).toFixed(digits) + unit : String(Math.round(a * 10 ** digits) / 10 ** digits);
    return v < 0 && a !== 0 ? `−${body}` : body;
  }
  const s = Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return v < 0 && Number(s.replace(/,/g, "")) !== 0 ? `−${s}` : s;
}

/** Các giá trị hiện trên legend: bỏ plot đã tắt trong Style. Chưa có dữ liệu thì rỗng. */
export const visiblePlotValues = (inst: IndicatorInstance, values: PlotValue[] | undefined): PlotValue[] =>
  (values ?? []).filter((v) => plotShown(inst, v.plot));
