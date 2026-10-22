import type { InputDef, PlotData } from "../schema";
import { MA_TYPES, type Num, type SourceName } from "../ta";

export const sourceInput = (d: SourceName = "close"): InputDef => ({ key: "src", label: "Source", type: "source", default: d });
export const SRC = sourceInput();

export const length = (d: number, key = "length", label = "Length"): InputDef => ({ key, label, type: "int", default: d, min: 1 });

/** Hệ số nhớ vô hạn (EMA/RMA): cần ~k·n nến để ảnh hưởng của seed < 1e-4. */
export const warm = (k: number, ...ns: number[]) => Math.ceil(k * Math.max(...ns));

export const withColors = (values: Num, colors: string[]): PlotData => ({ values, colors });

/** Offset của MA: dịch plot theo số nến (dương = sang phải, vào vùng tương lai). */
export const offsetInput = (): InputDef => ({ key: "offset", label: "Offset", type: "int", default: 0, min: -500, max: 500 });

/** Chọn loại MA (SMA / EMA / SMMA / WMA / VWMA) như ô "Basis MA Type" / "Type" của TV. */
export const maTypeInput = (key = "maType", label = "MA Type", d = "SMA"): InputDef => ({ key, label, type: "select", default: d, options: [...MA_TYPES] });

/** Số nến cần trước nến đầu cho MA loại `type` (EMA / SMMA nhớ vô hạn nên cần thêm). */
export const maWarmup = (type: string, n: number): number => (type === "EMA" ? warm(4, n) : type === "SMMA (RMA)" ? warm(10, n) : n);
