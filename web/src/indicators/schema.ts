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

export type PlotType = "line" | "step" | "histogram" | "area" | "circles" | "candles";
export type LineStyleName = "solid" | "dashed" | "dotted";

export type PlotDef = {
  id: string;
  title: string;
  type: PlotType; // kiểu mặc định; user đổi được trong Style (trừ plot perBar)
  color: string; // màu mặc định (#rrggbb hoặc #rrggbbaa); với candles là màu nến tăng
  colorDown?: string; // chỉ candles: màu nến giảm (mặc định = color)
  width?: number; // độ dày mặc định (1)
  lineStyle?: LineStyleName; // nét mặc định (solid)
  perBar?: boolean; // màu do compute quyết định theo từng nến (histogram MACD...): Settings không cho chọn màu/kiểu
  offset?: string; // key của input dịch plot theo số nến (Offset của MA; dương = sang phải, vào vùng tương lai)
};

/** Đường ngang trong pane (hline của Pine): 30/70 của RSI... */
export type LevelDef = { id: string; title: string; value: number; color: string; width?: number; lineStyle?: LineStyleName };

/** Một đầu của vùng tô: một plot hoặc một level. */
export type FillRef = { plot: string } | { level: string };
/** Vùng tô nền giữa hai plot / hai level (fill của Pine): dải Bollinger, vùng 30–70 của RSI. */
export type FillDef = { id: string; title: string; between: [FillRef, FillRef]; color: string };

/** Giá trị một plot theo từng nến; `colors` (nếu có) là màu riêng từng nến (histogram MACD, Volume...).
 *  Plot `candles` (plotcandle): `values` = close, `candle` = open/high/low; màu nến tăng/giảm lấy từ style. */
export type PlotData = { values: Num; colors?: string[]; candle?: { o: Num; h: Num; l: Num } };
export type Computed = Record<string, PlotData>;

// Lớp object kiểu Pine (line / label / box). Toạ độ x là chỉ số nến (có thể lẻ, âm, hoặc vượt nến cuối = vùng tương lai) trong
// mảng `bars` của compute (đã gồm lịch sử nạp ngầm); y là giá. Mốc thời gian đổi sang chỉ số bằng `indexAtTime` (objects.ts).
export type ObjLine = { x1: number; y1: number; x2: number; y2: number; color: string; width?: number; style?: LineStyleName; extend?: "none" | "left" | "right" | "both" };
/** Vị trí bubble so với điểm neo, như `label.style_label_*` của Pine: up = bubble nằm dưới điểm, down = nằm trên, left = nằm bên phải, right = bên trái. */
export type LabelStyle = "none" | "up" | "down" | "left" | "right" | "center";
export type LabelSize = "tiny" | "small" | "normal" | "large" | "huge";
export type ObjLabel = { x: number; y: number; text: string; color: string; bg?: string; style?: LabelStyle; size?: LabelSize };
export type ObjBox = { x1: number; y1: number; x2: number; y2: number; bg?: string; border?: string; borderWidth?: number; borderStyle?: LineStyleName; extendRight?: boolean };
export type ObjectSet = { lines: ObjLine[]; labels: ObjLabel[]; boxes: ObjBox[] };

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
  format?: "price" | "volume"; // định dạng trục/nhãn: volume = 1.15K, 2.3M (mặc định price)
  inputs: InputDef[];
  plots: PlotDef[];
  levels?: LevelDef[];
  fills?: FillDef[];
  /** Số nến cần có trước nến đầu tiên của chart để giá trị đã hội tụ (EMA/RMA nhớ vô hạn nên chỉ là xấp xỉ). */
  warmup: (inputs: Inputs) => number;
  /** Cần mốc ngày của broker (VWAP, Pivot...): nạp thêm D1 để ranh giới phiên đúng qua DST. */
  needsCalendar?: boolean;
  compute: (ctx: Ctx) => Record<string, Num | PlotData>;
  /** Line/label/box của indicator (SMC: BOS/CHoCH, order block, FVG...). Dựng bằng `ObjectBuilder` để có giới hạn 500/loại như Pine. */
  objects?: (ctx: Ctx) => ObjectSet;
  /** Ghi đè màu nến của chart chính (plotcandle "Color Candles"): mỗi nến một màu, "" = giữ màu mặc định. Dài đúng `bars.length`. */
  candleColors?: (ctx: Ctx) => string[];
};

export const num = (inputs: Inputs, key: string): number => inputs[key] as number;
export const str = (inputs: Inputs, key: string): string => inputs[key] as string;
