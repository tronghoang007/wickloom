import type { Bar } from "@/lib/api";
import type { CalendarOpts } from "./calendar";
import type { LineKind, Profile, TickSource } from "@/volumeProfile/compute";

export type { TickSource };
import type { LowerNeed } from "./lower";
import type { Num, SourceName } from "./ta";

// Mỗi indicator là một IndicatorDef khai báo (giống metadata của Pine): UI Settings, legend và renderer dựng từ đây,
// không có code UI riêng cho từng indicator. Phase 1 chỉ cần phần inputs/plots/compute; style đầy đủ (độ dày, nét, fill,
// levels...) được thêm ở Phase 2 mà không đổi chỗ khai báo inputs.

export type InputValue = number | string | boolean;
export type Inputs = Record<string, InputValue>;

type InputBase = { key: string; label: string; group?: string; tooltip?: string; enabledIf?: (inputs: Inputs) => boolean; hideInLegend?: boolean }; // enabledIf: input chỉ có tác dụng khi điều kiện đúng (xám đi nếu sai); hideInLegend: không in giá trị trên legend (input không có trong TV)

export type InputDef = InputBase &
  (
    | { type: "int"; default: number; min?: number; max?: number; step?: number }
    | { type: "float"; default: number; min?: number; max?: number; step?: number }
    | { type: "bool"; default: boolean }
    | { type: "select"; default: string; options: string[] }
    | { type: "source"; default: SourceName }
  );

export type PlotType = "line" | "step" | "histogram" | "area" | "circles" | "cross" | "linebr" | "candles";
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
  offset?: string | ((inputs: Inputs) => number); // key của input (hoặc hàm của inputs) dịch plot theo số nến (Offset của MA, Ichimoku; dương = sang phải, vào vùng tương lai)
  hidden?: boolean; // plot chỉ để tính (đầu của fill, vd thân nến của Supertrend): không vẽ, không có hàng Style, không hiện trên legend
  showIf?: (inputs: Inputs) => boolean; // plot chỉ vẽ / hiện trên legend khi điều kiện đúng (band VWAP bật bằng ô tick trong Inputs); không đặt = luôn hiện
};

/** Đường ngang trong pane (hline của Pine): 30/70 của RSI... */
export type LevelDef = { id: string; title: string; value: number; color: string; width?: number; lineStyle?: LineStyleName };

/** Một đầu của vùng tô: một plot hoặc một level. */
export type FillRef = { plot: string } | { level: string };
/** Vùng tô nền giữa hai plot / hai level (fill của Pine): dải Bollinger, vùng 30–70 của RSI. */
/** `colorDown` (nếu có): màu khi đầu thứ nhất không cao hơn đầu thứ hai, tách theo từng nến (mây Ichimoku xanh/đỏ); `color` là màu khi cao hơn. */
export type FillDef = { id: string; title: string; between: [FillRef, FillRef]; color: string; colorDown?: string; showIf?: (inputs: Inputs) => boolean };

/** Phần tử vẽ có style riêng nhưng không phải plot / level / fill: các mức của Pivot Points, histogram và POC/VAH/VAL của volume profile.
 *  Mỗi cái một hàng trong tab Style (bật/tắt, màu, và nét + độ dày nếu có `line`); compute đọc style hiệu lực qua `ctx.items`. */
export type ItemDef = { id: string; title: string; color: string; group?: string; line?: { width?: number; style?: LineStyleName }; plain?: boolean };
// plain: chỉ chọn màu, không có ô bật/tắt (màu histogram của profile)
export type ItemStyle = { color: string; visible: boolean; width: number; style: LineStyleName };

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
/** Bubble tròn (Big Trades): tâm ở (x, y) với x là chỉ số nến (lẻ = giữa hai nến: Big Trades đặt theo phút trong nến), bán kính `r` là px nên không đổi theo zoom; `text` (nếu có) vẽ giữa bubble với cỡ `textSize` px (mặc định 11),
 *  bubble nhỏ hơn chữ thì chữ tràn ra ngoài, số của bubble bị bubble lớn hơn đè lên thì không vẽ. */
export type ObjBubble = { x: number; y: number; r: number; bg: string; border?: string; borderWidth?: number; text?: string; textColor?: string; textSize?: number };
export type ObjectSet = { lines: ObjLine[]; labels: ObjLabel[]; boxes: ObjBox[]; bubbles?: ObjBubble[] };

/** Một volume profile đã tính (`computeProfile`) kèm vị trí ngang: `x1..x2` = chỉ số nến đầu/cuối của phiên (không dùng khi `style.pinned`). */
/** `end`: chỉ số nến đầu tiên sau phiên mà vùng giá cắt qua từng đường (chỉ khi bật Extend); không có = chưa nến nào cắt, đường kéo hết pane. */
export type PlacedProfile = Profile & { x1: number; x2: number; end?: Partial<Record<LineKind, number>> };
export type ProfileLine = { show: boolean; color: string; width: number; style: LineStyleName };
export type ProfileStyle = {
  volume: "updown" | "total" | "delta" | "deltatotal"; // deltatotal: Delta bên trái trục, Total bên phải (Deep Profile "Delta and Total Volume")
  width: number; // % bề rộng phiên (hoặc pane nếu pinned)
  place: "left" | "right";
  values: boolean;
  extend: boolean; // kéo POC/VAH/VAL sang phải hết pane
  pinned: boolean; // ghim vào mép pane (Visible Range) thay vì theo nến
  up: string; down: string; vaUp: string; vaDown: string;
  poc: ProfileLine; vah: ProfileLine; val: ProfileLine;
};
export type ProfileSet = { profiles: PlacedProfile[]; style: ProfileStyle };

/** Một row giá của footprint một nến: row phủ giá [p, p + size), volume lên (mua) / xuống (bán) của tick trong nến. */
export type FpRow = { p: number; up: number; dn: number };
/** Footprint của một nến chart: `x` = chỉ số nến (như object), `rows` liên tục từ row thấp nhất tới cao nhất có tick (row không tick có up = dn = 0), tăng dần theo giá.
 *  `poc` / `vl` / `vh` = chỉ số trong `rows` của POC và hai đầu Value Area (-1 nếu không có volume). `buyImb` / `sellImb`: row có imbalance mua / bán; `stackBuy` / `stackSell`: thuộc chuỗi imbalance liên tiếp. */
export type FpBar = {
  x: number; o: number; h: number; l: number; c: number; size: number; rows: FpRow[];
  poc: number; vl: number; vh: number;
  buyImb: boolean[]; sellImb: boolean[]; stackBuy: boolean[]; stackSell: boolean[];
};
export type FpType = "bidask" | "delta" | "volume" | "deltavol";
export type FpStyle = {
  type: FpType; // nến sát mép trái, cột ô bên phải: bidask in hai số sell, buy quanh tâm ô mỗi row (kiểu ATAS), delta / volume một số mỗi row; deltavol: hai cột (delta, total)
  mode: "profile" | "box"; // profile: bề rộng ô theo volume; box: mọi ô cùng bề rộng
  color: "fading" | "fixed" | "none"; // nền ô: đậm dần theo volume / cố định / không nền
  textSize: number; textFormat: "auto" | "normal" | "k";
  summary: boolean; // Info box dưới nến: total volume, delta
  imbalance: boolean; stacked: boolean;
  poc: boolean; va: boolean;
  up: string; down: string; buy: string; sell: string; text: string; imbBuy: string; imbSell: string; pocColor: string; vaColor: string;
};
export type FootprintSet = { bars: FpBar[]; style: FpStyle };

export type Ctx = {
  bars: Bar[]; // đã gồm cả lịch sử nạp ngầm phía trước (xem engine)
  inputs: Inputs; // đã điền mặc định + ép kiểu
  src: (name: string) => Num;
  calendar: CalendarOpts;
  /** Nến khung nhỏ (ghép nhiều khung, tăng dần theo t) theo `def.lower`; chưa nạp xong thì rỗng, indicator tự xử lý. */
  lower: Bar[];
  /** Style hiệu lực của `def.items` (đã gồm phần user đặt). */
  items: Record<string, ItemStyle>;
  /** Kích thước tick của symbol (giá). */
  tick: number;
  /** Số nến lịch sử ngầm đứng trước nến đầu tiên của chart trong `bars` (nến thứ `cut` là nến đầu của chart). */
  cut: number;
  /** Vùng đang nhìn thấy, theo chỉ số trong `bars` (chỉ có khi `def.needsRange`); không biết thì undefined. */
  range?: { from: number; to: number };
  /** Dữ liệu tick theo `def.ticks`; không có = indicator không cần / đang tắt "1 tick". */
  ticks?: TickSource;
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
  items?: ItemDef[];
  /** Số nến cần có trước nến đầu tiên của chart để giá trị đã hội tụ (EMA/RMA nhớ vô hạn nên chỉ là xấp xỉ). */
  warmup: (inputs: Inputs) => number;
  /** Cần nến khung nhỏ (chia volume trong nến chart): khung nào, phủ từ đâu. Trả null = không cần / dùng nến chart. Manager nạp ngầm rồi tính lại. */
  lower?: (inputs: Inputs, info: { bars: Bar[]; cut: number; step: number; calendar: CalendarOpts; range?: { from: number; to: number } }) => LowerNeed | null;
  /** Cần lịch sử tick (volume profile "1 tick"): phủ từ đâu. Trả null = không cần. Manager nạp nến delta tick (tf "TD") rồi cấp `ctx.ticks`. */
  ticks?: (inputs: Inputs, info: { bars: Bar[]; cut: number; step: number; calendar: CalendarOpts; range?: { from: number; to: number } }) => { from: number } | null;
  /** Kết quả phụ thuộc vùng đang nhìn (Visible Range Volume Profile): manager tính lại khi kéo / zoom. */
  needsRange?: boolean;
  /** Volume profile của indicator (Session / Visible Range Volume Profile), vẽ bằng `ProfilePrimitive`. */
  profiles?: (ctx: Ctx) => ProfileSet;
  /** Cần mốc ngày của broker (VWAP, Pivot...): nạp thêm D1 để ranh giới phiên đúng qua DST. */
  needsCalendar?: boolean;
  compute: (ctx: Ctx) => Record<string, Num | PlotData>;
  /** Footprint từng nến (Volume footprint / Deep Print): vẽ bằng `FootprintPrimitive`; chart chính ẩn nến của nó đi (indicator tự vẽ nến). */
  footprints?: (ctx: Ctx) => FootprintSet | null;
  /** Line/label/box của indicator (SMC: BOS/CHoCH, order block, FVG...). Dựng bằng `ObjectBuilder` để có giới hạn 500/loại như Pine. */
  objects?: (ctx: Ctx) => ObjectSet;
  /** Ghi đè màu nến của chart chính (plotcandle "Color Candles"): mỗi nến một màu, "" = giữ màu mặc định. Dài đúng `bars.length`. */
  candleColors?: (ctx: Ctx) => string[];
};

export const num = (inputs: Inputs, key: string): number => inputs[key] as number;
export const str = (inputs: Inputs, key: string): string => inputs[key] as string;
