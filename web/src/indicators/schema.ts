import type { Bar } from "@/lib/api";
import type { CalendarOpts } from "./calendar";
import type { Num, SourceName } from "./ta";

// Mỗi indicator là một IndicatorDef khai báo (giống metadata của Pine): UI Settings, legend và renderer dựng từ đây,
// không có code UI riêng cho từng indicator. Phase 1 chỉ cần phần inputs/plots/compute; style đầy đủ (độ dày, nét, fill,
// levels...) được thêm ở Phase 2 mà không đổi chỗ khai báo inputs.

export type InputValue = number | string | boolean;
export type Inputs = Record<string, InputValue>;

type InputBase = { key: string; label: string; group?: string; tooltip?: string };

export type InputDef = InputBase &
  (
    | { type: "int"; default: number; min?: number; max?: number; step?: number }
    | { type: "float"; default: number; min?: number; max?: number; step?: number }
    | { type: "bool"; default: boolean }
    | { type: "select"; default: string; options: string[] }
    | { type: "source"; default: SourceName }
  );

export type PlotType = "line" | "histogram";

export type PlotDef = {
  id: string;
  title: string;
  type: PlotType;
  color: string; // màu mặc định
  perBar?: boolean; // màu do compute quyết định theo từng nến (histogram MACD...): Settings không cho chọn màu
};

/** Giá trị một plot theo từng nến; `colors` (nếu có) là màu riêng từng nến (histogram MACD, Volume...). */
export type PlotData = { values: Num; colors?: string[] };
export type Computed = Record<string, PlotData>;

export type Ctx = {
  bars: Bar[]; // đã gồm cả lịch sử nạp ngầm phía trước (xem engine)
  inputs: Inputs; // đã điền mặc định + ép kiểu
  src: (name: string) => Num;
  calendar: CalendarOpts;
};

export type IndicatorDef = {
  id: string;
  name: string; // tên ngắn trên legend
  title: string; // tên đầy đủ trong dialog Indicators
  overlay: boolean; // mặc định vẽ trên chart chính hay pane riêng
  inputs: InputDef[];
  plots: PlotDef[];
  levels?: number[]; // đường ngang nét đứt trong pane (30/70 của RSI...)
  /** Số nến cần có trước nến đầu tiên của chart để giá trị đã hội tụ (EMA/RMA nhớ vô hạn nên chỉ là xấp xỉ). */
  warmup: (inputs: Inputs) => number;
  /** Cần mốc ngày của broker (VWAP, Pivot...): nạp thêm D1 để ranh giới phiên đúng qua DST. */
  needsCalendar?: boolean;
  compute: (ctx: Ctx) => Record<string, Num | PlotData>;
};

export const num = (inputs: Inputs, key: string): number => inputs[key] as number;
export const str = (inputs: Inputs, key: string): string => inputs[key] as string;
