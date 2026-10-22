import type { InputDef, PlotData } from "../schema";
import type { Num, SourceName } from "../ta";

export const sourceInput = (d: SourceName = "close"): InputDef => ({ key: "src", label: "Source", type: "source", default: d });
export const SRC = sourceInput();

export const length = (d: number, key = "length", label = "Length"): InputDef => ({ key, label, type: "int", default: d, min: 1 });

/** Hệ số nhớ vô hạn (EMA/RMA): cần ~k·n nến để ảnh hưởng của seed < 1e-4. */
export const warm = (k: number, ...ns: number[]) => Math.ceil(k * Math.max(...ns));

export const withColors = (values: Num, colors: string[]): PlotData => ({ values, colors });
