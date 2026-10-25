import type { Bar } from "@/lib/api";
import { computeProfile, computeTickProfile, type TickSource } from "@/volumeProfile/compute";
import { textBox, wrapText, type Ext, type Pt, type Shape } from "./shapes";
import type { Anchor, Drawing } from "./types";

export type Ctx = {
  d: Drawing;
  p: Pt[];
  w: number;
  h: number;
  bars: Bar[];
  profileBars?: Bar[]; // nến khung nhỏ hơn dùng tính volume profile (FRVP / AVP), có thể chưa tải xong
  profileStep?: number; // giây mỗi nến của profileBars
  ticks?: TickSource; // tick cho volume profile khi Data aggregation = 1 tick (manager cấp; chưa nạp xong thì profile dùng nến khung nhỏ)
  tickSize: number;
  minQty?: number; // lượng nhỏ nhất của symbol (volume_min × contract_size), cho QTY precision mặc định của Position
  hovered: boolean;
  selected: boolean;
  dragging?: boolean; // đang vẽ / đang kéo hình này (Volume profile chỉ hiện vạch dọc, thả ra mới tính)
  step: number; // giây mỗi bar
  barsBetween: (t0: number, t1: number) => number; // số nến theo chỉ số nến, bỏ qua nghỉ phiên
  X: (t: number) => number | null;
  Y: (price: number) => number | null;
  fp: (price: number) => string;
  digits: number;
  log?: boolean; // trục giá đang log
};

// Khung đang xem lúc tạo hình bằng 1 click
export type OneClickView = {
  span: number; // khoảng giá trên trục
  hiLo: number; // High − Low của các nến đang thấy
  visibleBars: number;
  tick: number;
  addBars: (t: number, n: number) => number; // thời điểm sau t đúng n nến
};

export type ToolSpec = {
  id: string;
  label: string;
  n: number; // số điểm; 0 = nhiều điểm (double-click/Enter để kết thúc), -1 = vẽ tay
  oneClick?: (a: Anchor, v: OneClickView) => Anchor[]; // 1 click tạo đủ điểm mặc định theo khung đang xem
  build: (c: Ctx) => Shape[];
  handles?: (c: Ctx) => Pt[];
  style?: Partial<Pick<Drawing, "color" | "width" | "dash" | "textColor">>;
  prompt?: string; // có text sửa được (mở ô sửa inline khi tạo / double-click); cũng là text mặc định
  axes?: "price" | "time"; // nhãn điểm trên trục khi chọn: chỉ giá / chỉ thời gian (mặc định cả hai)
  inBars?: boolean; // điểm neo chỉ nằm trong khoảng nến đã có (FRVP của TV không cho kéo ra quá nến cuối / trước nến đầu)
  ephemeral?: boolean;
  panel?: "position" | "volume";
  // tick: kẹp/làm tròn giá khi kéo trên chart; prev: các điểm trước khi đổi
  constrain?: (pts: Anchor[], moved: number, tick?: number, prev?: Anchor[]) => void;
  // handle riêng (khác điểm neo) kéo được: moveHandle trả về điểm mới; không có thì handle = kéo cả hình
  moveHandle?: (pts: Anchor[], handle: number, a: Anchor) => Anchor[];
  shift?: "square"; // Shift khi vẽ: hình vuông / tròn trên màn hình (mặc định khóa góc 0/45/90°)
  action?: "zoom";
  disabled?: boolean;
  options?: ToolOption[]; // tùy chọn riêng của tool (lưu trong d.opts), hiện ở tab Style của Settings
  text?: TextSpec; // có tab Text (d.text + opts fontSize, bold, italic, vAlign, hAlign)
  init?: (d: Drawing, c: Ctx) => Drawing; // chốt thông số theo khung đang xem lúc vẽ xong (Gann Square)
  levels?: FibLevel[]; // bộ mức mặc định (sửa được trong Settings, lưu opts.levels)
  anchorable?: boolean; // nút Anchor của TV: ghim hình cố định trên màn hình (opts.anchored, ax, ay)
  grid?: boolean; // Table: sửa từng ô (double-click), thêm hàng / cột
  colorLabel?: string; // tên ô màu đường trong Settings (Table của TV: "Border")
};

// opts riêng của từng hình (nội dung Table, vị trí ghim): không lưu làm mặc định cho lần vẽ sau.
// `rows` / `cols` chỉ là số hàng / cột của Table; ở FRVP / AVP `rows` là Row Size nên PHẢI lưu (trước đây bị loại chung: đổi Row Size 24 -> 240, vẽ lại thì về 24).
const INSTANCE_OPTS = ["cells", "anchored", "ax", "ay"];
const TABLE_OPTS = ["rows", "cols"];
export const defaultOpts = (opts: Drawing["opts"], type?: string) =>
  opts && Object.fromEntries(Object.entries(opts).filter(([k]) => !INSTANCE_OPTS.includes(k) && !(type === "table" && TABLE_OPTS.includes(k))));

// Tùy chọn dạng bật/tắt hoặc chọn 1 trong danh sách, đặt tên theo thuộc tính của TV
export type ToolOption = { key: string; label: string; section?: string } & (
  | { def: boolean }
  | { def: string; choices: [string, string][] }
  | { def: string; color: true } // "" = dùng màu đường
);

// Tab Text của TV: chữ chạy dọc đường (line), nằm trong hộp (box); kèm default cỡ chữ + căn lề.
// Các cờ còn lại mô tả tab Text của từng tool (đo trên TV 2026-10-25).
export type TextSpec = {
  kind: "line" | "box";
  size: number;
  v: "top" | "middle" | "bottom";
  h: "left" | "center" | "right";
  fixed?: boolean; // chữ có vị trí cố định theo hình (giữa hình, cạnh mũi tên...): tab Text không có hàng Text alignment
  bold?: boolean; // mặc định đậm (Arrow marker)
  color?: string; // màu chữ mặc định khi khác màu đường (Pin: #dbdbdb)
  noColor?: boolean; // không có ô màu chữ (Signpost)
  noStyle?: boolean; // không có nút B / I (Comment)
  noText?: boolean; // không có ô nhập chữ (Measurers: chữ là số liệu tự tính, tab chỉ chỉnh kiểu chữ)
  bg?: "main" | { def: boolean; color: string }; // hàng Background: "main" = màu chính d.color (Callout, Comment), object = ô bật + màu riêng
  border?: { def: boolean; color: string; always?: boolean }; // hàng Border (always: chỉ ô màu, "" = cùng màu nền)
  wrap?: boolean; // ô Text wrap (ngắt dòng ở 200px)
};

const EXTEND: [string, string][] = [["none", "Don't extend"], ["left", "Extend left"], ["right", "Extend right"], ["both", "Extend both"]];

// Giá trị tùy chọn: d.opts, không có thì default của tool
export function optOf(d: Drawing, key: string): number | string | boolean | undefined {
  const spec = SPEC[d.type];
  const t = spec?.text;
  const textDef = t && {
    fontSize: t.size, bold: t.bold ?? false, italic: false, vAlign: t.v, hAlign: t.h, wrap: false,
    background: typeof t.bg === "object" ? t.bg.def : undefined, backgroundColor: typeof t.bg === "object" ? t.bg.color : undefined,
    border: t.border?.def, borderColor: t.border?.color,
  }[key];
  return d.opts?.[key] ?? spec?.options?.find((o) => o.key === key)?.def ?? textDef;
}

// Cỡ chữ của các tool chú thích (thanh nổi Font size): opts.fontSize, không có thì cỡ mặc định của TV
const FONT_DEFAULT: Record<string, number> = { callout: 14, comment: 16, pricelabel: 14, signpost: 12, pin: 14, table: 14 };
export function fontSizeOf(d: Drawing): number {
  const v = Number(d.opts?.fontSize);
  if (v > 0) return v;
  return d.type === "text" ? 12 + d.width * 2 : (FONT_DEFAULT[d.type] ?? 14); // Text cũ lưu cỡ trong độ dày nét
}

// Chữ của tab Text: cỡ, đậm, nghiêng, màu (mặc định màu đường)
function textStyle(c: Ctx) {
  return {
    size: Number(c.d.opts?.fontSize) || (c.d.type === "text" ? 12 + c.d.width * 2 : Number(optOf(c.d, "fontSize")) || 14), // Text cũ lưu cỡ trong độ dày nét
    bold: Boolean(optOf(c.d, "bold")),
    italic: Boolean(optOf(c.d, "italic")),
    color: c.d.textColor ?? SPEC[c.d.type]?.text?.color ?? c.d.color,
  };
}

// Nền / viền riêng của hộp chữ (tab Text của Text, Pin): ô bật + màu
const boxFx = (c: Ctx) => ({
  ...(optOf(c.d, "background") ? { bg: String(optOf(c.d, "backgroundColor")) } : {}),
  ...(optOf(c.d, "border") ? { border: String(optOf(c.d, "borderColor")) } : {}),
});

// Text wrap của TV: bật thì ngắt dòng ở 200px
const WRAP_W = 200;
const wrapIf = (c: Ctx, text: string, st: { size: number; bold: boolean; italic: boolean }) =>
  optOf(c.d, "wrap") ? wrapText(text, st.size, st.bold, st.italic, WRAP_W) : text;

// Như TV: chữ của trend line chạy dọc theo đường (xoay theo góc), căn trái/giữa/phải theo đoạn
// đang thấy; Top/Bottom = phía trên/dưới đường.
function lineText(c: Ctx, a: Pt, b: Pt): Shape[] {
  if (!c.d.text) return [];
  const st = textStyle(c);
  const v = optOf(c.d, "vAlign"), h = optOf(c.d, "hAlign");
  const [l, r] = a.x <= b.x ? [a, b] : [b, a];
  const ang = Math.atan2(r.y - l.y, r.x - l.x);
  const up = { x: Math.sin(ang), y: -Math.cos(ang) };
  const gap = (c.d.text.split("\n").length * st.size * 1.3) / 2 + 4;
  const base = h === "left" ? l : h === "right" ? r : mid(l, r);
  const at = v === "top" ? add(base, mul(up, gap)) : v === "bottom" ? sub(base, mul(up, gap)) : base;
  return [txt(at, c.d.text, { ...st, align: h === "left" ? "left" : h === "right" ? "right" : "center", angle: ang || undefined })];
}

// Chữ trong hộp (rectangle): căn theo 3×3 vị trí bên trong
function boxText(c: Ctx, x0: number, y0: number, x1: number, y1: number): Shape[] {
  if (!c.d.text) return [];
  const st = textStyle(c);
  const v = optOf(c.d, "vAlign"), h = optOf(c.d, "hAlign");
  const [top, bot] = [Math.min(y0, y1), Math.max(y0, y1)];
  const half = (c.d.text.split("\n").length * st.size * 1.3) / 2;
  const x = h === "left" ? x0 + 6 : h === "right" ? x1 - 6 : (x0 + x1) / 2;
  const y = v === "top" ? top + half + 4 : v === "bottom" ? bot - half - 4 : (top + bot) / 2;
  return [txt({ x, y }, c.d.text, { ...st, align: h === "left" ? "left" : h === "right" ? "right" : "center" })];
}

// "Extend left/right" theo màn hình (TV): đầu trái là điểm có x nhỏ hơn
function lineExt(c: Ctx, [a, b]: Pt[]): { a: Pt; b: Pt; ext: Ext } {
  const e = String(optOf(c.d, "extend") ?? "none") as Ext;
  const swap = a.x > b.x;
  const [l, r] = swap ? [b, a] : [a, b];
  return { a: l, b: r, ext: e };
}

// ---------- helpers ----------
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const lerp = (a: Pt, b: Pt, t: number): Pt => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a: Pt, k: number): Pt => ({ x: a.x * k, y: a.y * k });
const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
const unit = (a: Pt): Pt => mul(a, 1 / (Math.hypot(a.x, a.y) || 1));

type O = Record<string, unknown>;
const seg = (a: Pt, b: Pt, o: O = {}) => ({ k: "line", a, b, ext: "none", ...o }) as Shape;
const ray = (a: Pt, b: Pt, o: O = {}) => ({ k: "line", a, b, ext: "right", ...o }) as Shape;
const poly = (pts: Pt[], o: O = {}) => ({ k: "poly", pts, ...o }) as Shape;
const txt = (at: Pt, text: string, o: O = {}) => ({ k: "text", at, text, ...o }) as Shape;

const arcPts = (c: Pt, r: number, a0: number, a1: number, n = 48): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return { x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) };
  });

const circle = (c: Pt, r: number, n = 64) => arcPts(c, r, 0, Math.PI * 2, n);

// góc ngắn nhất từ a0 tới a1
const shortSweep = (a0: number, a1: number) => {
  let d = a1 - a0;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d <= -Math.PI) d += Math.PI * 2;
  return a0 + d;
};

const bezier = (p0: Pt, p1: Pt, p2: Pt, p3: Pt, n = 40): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    const k = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
    return {
      x: k[0] * p0.x + k[1] * p1.x + k[2] * p2.x + k[3] * p3.x,
      y: k[0] * p0.y + k[1] * p1.y + k[2] * p2.y + k[3] * p3.y,
    };
  });

const head = (from: Pt, to: Pt, size: number, o: O = {}) => {
  const u = unit(sub(to, from));
  const n = { x: -u.y, y: u.x };
  const base = sub(to, mul(u, size));
  return poly([to, add(base, mul(n, size * 0.45)), sub(base, mul(n, size * 0.45))], { closed: true, fill: 1, ...o });
};

const pctStr = (a: number, b: number) => `${(((b - a) / a) * 100).toFixed(2)}%`;
const pt = (c: Ctx, i: number) => c.d.points[i];

function fmtDur(sec: number) {
  sec = Math.abs(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, (m || (!d && !h)) && `${m}m`].filter(Boolean).join(" ");
}

// Giá tại mức lvl giữa 2 điểm: lvl 0 ở điểm 2, lvl 1 ở điểm 1 (như Fib retracement của TV)
export const fibPrice = (pa: number, pb: number, lvl: number) => pb - (pb - pa) * lvl;
// Giá tại tỉ lệ t đi từ pa tới pb
const priceAt = (pa: number, pb: number, t: number) => pa + (pb - pa) * t;

export type FibLevel = { coeff: number; color: string; on: boolean };

const lv = (on: boolean, list: [number, string][]): FibLevel[] => list.map(([coeff, color]) => ({ coeff, color, on }));

// Default gốc của TV (đọc từ Trend-based fib extension / Fib channel chưa chỉnh): 11 mức 0…4.236 bật,
// 13 mức mở rộng có sẵn nhưng tắt. Fib retracement dùng cùng bộ.
export const FIB_LEVELS: FibLevel[] = [
  ...lv(true, [[0, "#787b86"], [0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#4caf50"], [0.618, "#089981"], [0.786, "#00bcd4"], [1, "#787b86"], [1.618, "#2962ff"], [2.618, "#f23645"], [3.618, "#9c27b0"], [4.236, "#e91e63"]]),
  ...lv(false, [[1.272, "#ff9800"], [1.414, "#f23645"], [2, "#089981"], [2.272, "#ff9800"], [2.414, "#4caf50"], [3, "#00bcd4"], [3.272, "#787b86"], [3.414, "#2962ff"], [4, "#f23645"], [4.272, "#9c27b0"], [4.414, "#e91e63"], [4.618, "#ff9800"], [4.764, "#089981"]]),
];
// Trend-based fib time (TV: 0.5 tắt)
const FIB_TIME_LEVELS: FibLevel[] = [
  ...lv(true, [[0, "#787b86"], [0.382, "#f23645"]]), ...lv(false, [[0.5, "#81c784"]]),
  ...lv(true, [[0.618, "#4caf50"], [1, "#089981"], [1.382, "#00bcd4"], [1.618, "#787b86"], [2, "#2962ff"], [2.382, "#e91e63"], [2.618, "#9c27b0"], [3, "#673ab7"]]),
];
const FIB_TIMEZONE_LEVELS: FibLevel[] = lv(true, [[0, "#787b86"], ...[1, 2, 3, 5, 8, 13, 21, 34, 55, 89].map((n): [number, string] => [n, "#2962ff"])]);
// Fib circles và Fib speed resistance arcs
const FIB_ARC_LEVELS: FibLevel[] = lv(true, [[0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#089981"], [0.618, "#4caf50"], [0.786, "#00bcd4"], [1, "#787b86"], [1.618, "#2962ff"], [2.618, "#e91e63"], [3.618, "#2962ff"], [4.236, "#e91e63"], [4.618, "#f23645"]]);
const FIB_WEDGE_LEVELS: FibLevel[] = lv(true, [[0.236, "#f23645"], [0.382, "#ff9800"], [0.5, "#4caf50"], [0.618, "#089981"], [0.786, "#00bcd4"], [1, "#787b86"]]);
// Fib speed resistance fan: mức theo giá và theo thời gian tính từ điểm 2 (giống bộ của Gann Box)
const FIB_FAN_LEVELS: FibLevel[] = lv(true, [[0, "#787b86"], [0.25, "#ff9800"], [0.382, "#00bcd4"], [0.5, "#4caf50"], [0.618, "#089981"], [0.75, "#2962ff"], [1, "#787b86"]]);

// d.opts chỉ chứa giá trị đơn: mức lưu thành chuỗi "coeff|màu|1;..."
export const encodeFibLevels = (lv: FibLevel[]) => lv.map((l) => `${l.coeff}|${l.color}|${l.on ? 1 : 0}`).join(";");
export function fibLevelsOf(d: Drawing): FibLevel[] {
  const raw = d.opts?.levels;
  if (typeof raw !== "string" || !raw) return SPEC[d.type]?.levels ?? FIB_LEVELS;
  return raw.split(";").map((x) => {
    const [coeff, color, on] = x.split("|");
    return { coeff: Number(coeff), color, on: on === "1" };
  }).filter((l) => Number.isFinite(l.coeff));
}

// Mức tính theo giá rồi mới ra pixel: đúng cả khi trục giá log (nội suy pixel thì đường lệch
// khỏi giá ghi trên nhãn). Tùy chọn như TV: extend, reverse, hiện hệ số / giá, nhãn trái/phải, nền.
// Các mức ngang theo giá (Fib retracement, Trend-based fib extension). Tùy chọn như TV: extend,
// hiện hệ số / giá, nhãn trái/phải, nền (transparency 80).
function priceLevels(c: Ctx, priceOf: (coeff: number) => number, x0: number, x1: number): Shape[] {
  const d = c.d;
  const ext = String(optOf(d, "extend"));
  const left = ext === "left" || ext === "both" ? 0 : x0, right = ext === "right" || ext === "both" ? c.w : x1;
  const labelsRight = optOf(d, "labels") === "right";
  const coeffs = optOf(d, "showCoeffs"), prices = optOf(d, "showPrices"), bg = optOf(d, "background");
  const out: Shape[] = [];
  let prev: number | null = null;
  for (const lvl of fibLevelsOf(d).filter((l) => l.on).sort((p, q) => p.coeff - q.coeff)) {
    const price = priceOf(lvl.coeff);
    const y = c.Y(price);
    if (y === null) continue;
    const color = lvl.color;
    if (bg && prev !== null) out.push(poly([{ x: left, y: prev }, { x: right, y: prev }, { x: right, y }, { x: left, y }], { closed: true, fill: 0.2, noStroke: true, color }));
    out.push(seg({ x: left, y }, { x: right, y }, { color, w: c.d.width }));
    const text = [coeffs ? String(lvl.coeff) : "", prices ? `(${c.fp(price)})` : ""].filter(Boolean).join(" ");
    // như TV: nhãn ngoài đầu đường mức, canh giữa dọc
    if (text) out.push(txt({ x: labelsRight ? right + 4 : left - 4, y }, text, { size: 11, color, align: labelsRight ? "left" : "right" }));
    prev = y;
  }
  return out;
}

function fibRetracement(c: Ctx): Shape[] {
  const [a, b] = c.p;
  let [pa, pb] = [pt(c, 0).price, pt(c, 1).price];
  if (optOf(c.d, "reverse")) [pa, pb] = [pb, pa];
  const lg = logFib(c, pa, pb);
  const priceOf = (k: number) => (lg ? pb * (pa / pb) ** k : fibPrice(pa, pb, k));
  return [...priceLevels(c, priceOf, Math.min(a.x, b.x), Math.max(a.x, b.x)), seg(a, b, { dash: 1, w: 1, color: "#787b86" })];
}

const FIB_OPTIONS: ToolOption[] = [
  { key: "extend", label: "Extend lines", def: "none", choices: EXTEND },
  { key: "showCoeffs", label: "Levels", def: true },
  { key: "showPrices", label: "Prices", def: true },
  { key: "labels", label: "Labels", def: "left", choices: [["left", "Left"], ["right", "Right"]] },
  { key: "background", label: "Background", def: true },
  { key: "logLevels", label: "Fib levels based on log scale", def: false },
];
// Như TV: "Fib levels based on log scale" chỉ có tác dụng khi trục giá đang log — mức chia theo
// tỉ lệ giá (vd 0.5 giữa 4110 và 4170 là √(4110×4170) = 4139.891) thay vì theo hiệu giá
const logFib = (c: Ctx, ...prices: number[]) => Boolean(c.log && optOf(c.d, "logLevels") && prices.every((p) => p > 0));
const BG: ToolOption = { key: "background", label: "Background", def: true };
// Màu nền riêng như nút Background color của TV; chưa chọn ("") thì lấy màu đường
const BGC: ToolOption = { key: "backgroundColor", label: "Background color", def: "", color: true };
const bgOf = (c: Ctx) => String(optOf(c.d, "backgroundColor") || c.d.color);
// Hình kín có nền riêng + viền: nền không viền (màu nền) rồi viền (màu đường)
// Chữ nằm giữa hình (Circle, Ellipse của TV): màu chữ mặc định = màu đường
const centerText = (c: Ctx, at: Pt): Shape[] => {
  if (!c.d.text) return [];
  const st = textStyle(c);
  return [txt(at, c.d.text, { ...st, align: "center" })];
};
const filledShape = (c: Ctx, pts: Pt[], alpha: number, open = false): Shape[] => [
  ...(optOf(c.d, "background") === false ? [] : [poly(pts, { closed: true, fill: alpha, noStroke: true, color: bgOf(c) })]),
  poly(pts, open ? {} : { closed: true }),
];
const TREND = { dash: 1 as const, w: 1, color: "#787b86" }; // đường nối các điểm (TV: xám nét đứt)

// Đường dọc theo các mức thời gian, tô dải giữa 2 mức, nhãn ở đáy (Trend-based fib time, Fib time zone)
function timeLevels(c: Ctx, xOf: (coeff: number) => number, fill: boolean): Shape[] {
  const out: Shape[] = [];
  let prev: number | null = null;
  for (const lvl of fibLevelsOf(c.d).filter((l) => l.on).sort((p, q) => p.coeff - q.coeff)) {
    const x = xOf(lvl.coeff);
    if (fill && optOf(c.d, "background") && prev !== null) {
      out.push(poly([{ x: prev, y: 0 }, { x, y: 0 }, { x, y: c.h }, { x: prev, y: c.h }], { closed: true, fill: 0.2, noStroke: true, color: lvl.color }));
    }
    prev = x;
    if (x < -50 || x > c.w + 50) continue;
    out.push(seg({ x, y: 0 }, { x, y: c.h }, { color: lvl.color, w: c.d.width }));
    if (optOf(c.d, "showCoeffs") !== false) out.push(txt({ x: x + 4, y: c.h - 10 }, String(lvl.coeff), { size: 11, color: lvl.color }));
  }
  return out;
}

// Vòng elip/tròn đồng tâm theo mức, tô vành giữa 2 mức (Fib circles, arcs, wedge).
// ring(r) = các điểm của vòng mức r (đã nhân bán kính)
function rings(c: Ctx, ring: (coeff: number) => Pt[], label: (coeff: number) => Pt | null, closed: boolean): Shape[] {
  const fills: Shape[] = [], lines: Shape[] = [];
  let prev: Pt[] | null = null;
  for (const lvl of fibLevelsOf(c.d).filter((l) => l.on).sort((p, q) => p.coeff - q.coeff)) {
    const pts = ring(lvl.coeff);
    if (optOf(c.d, "background")) fills.push(poly(prev ? [...pts, ...[...prev].reverse()] : pts, { closed: true, fill: 0.2, noStroke: true, color: lvl.color }));
    lines.push(poly(pts, { closed, color: lvl.color, w: c.d.width }));
    const at = label(lvl.coeff);
    if (at && optOf(c.d, "showCoeffs") !== false) lines.push(txt(at, String(lvl.coeff), { size: 11, color: lvl.color, align: "center" }));
    prev = pts;
  }
  return [...fills, ...lines];
}


function channelOffset(a: Pt, b: Pt, c: Pt) {
  const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
  return c.y - (a.y + slope * (c.x - a.x));
}

// Pitchfork như TV (đo 2026-10-21): median màu đường (mặc định đỏ), các mức tính theo nửa bề rộng
// (median → nhánh = 1): 0.5 và 1 bật sẵn, tô giữa 2 mức liền nhau màu mức ngoài 20%.
// Gốc median: thường = p0; Schiff = (p0.x, giữa giá p0–p1); Modified Schiff và Inside = trung điểm p0–p1.
// Inside: median đi từ trung điểm p1–p2, song song với gốc→p2.
const FORK_LEVELS: [number, string, boolean][] = [
  [0.25, "#ffb74d", false], [0.382, "#81c784", false], [0.5, "#089981", true], [0.618, "#089981", false],
  [0.75, "#00bcd4", false], [1, "#2962ff", true], [1.5, "#9c27b0", false], [1.75, "#e91e63", false], [2, "#f77c80", false],
];

type ForkKind = "standard" | "schiff" | "modified" | "inside";

function fork(c: Ctx, v: ForkKind): Shape[] {
  const [p0, p1, p2] = c.p;
  const m = mid(p1, p2);
  const o = v === "standard" ? p0 : v === "schiff" ? { x: p0.x, y: (p0.y + p1.y) / 2 } : mid(p0, p1);
  const dir = unit(v === "inside" ? sub(p2, o) : sub(m, o));
  const far = (p: Pt) => add(p, mul(dir, 20000));
  const half = sub(p1, m);
  const at = (lvl: number, side: 1 | -1) => add(m, mul(half, lvl * side));
  const bg = optOf(c.d, "background");
  const fills: Shape[] = [], lines: Shape[] = [];
  let prev = 0;
  for (const [lvl, color, on] of FORK_LEVELS) {
    if (!on) continue;
    for (const side of [1, -1] as const) {
      const q0 = at(prev, side), q1 = at(lvl, side);
      if (bg) fills.push(poly([q0, far(q0), far(q1), q1], { closed: true, fill: 0.2, noStroke: true, color }));
      lines.push(ray(q1, add(q1, dir), { color }));
    }
    prev = lvl;
  }
  const start = v === "inside" ? m : o;
  const out = [...fills, ...lines, ray(start, add(start, dir)), seg(p1, p2)];
  if (v !== "standard") out.push(seg(p0, p1));
  if (v === "inside") out.push(seg(o, p2));
  return out;
}

// Nhãn điểm: phía trên đỉnh / dưới đáy (so với 2 điểm kề). bg: ô nền màu hình chữ trắng (patterns của TV);
// không bg: chữ màu hình (Elliott). Tên rỗng = không nhãn.
function letters(c: Ctx, names: string[], bg = false): Shape[] {
  return c.p.slice(0, names.length).flatMap((p, i, arr) => {
    if (!names[i]) return [];
    const nb = [arr[i - 1], arr[i + 1]].filter(Boolean) as Pt[];
    const avg = nb.length ? nb.reduce((s, q) => s + q.y, 0) / nb.length : p.y + 1;
    const above = p.y < avg;
    return [txt({ x: p.x, y: p.y + (above ? -14 : 14) }, names[i], bg ? { align: "center", bg: c.d.color, size: 12 } : { align: "center", size: 13 })];
  });
}

// Tỉ lệ ghi trên đường chấm của patterns (TV: XABCD/Cypher/ABCD tối đa 3 số lẻ, Three drives 2)
const ratioOf = (num: number, den: number, digits = 3) => (den ? String(+Math.abs(num / den).toFixed(digits)) : "");

// Pattern như TV: đường gấp khúc, tam giác tô 15%, đường chấm i–j kèm ô tỉ lệ ở giữa, chữ trong ô
function pattern(c: Ctx, names: string[], links: [number, number, string][], fills: number[][] = []): Shape[] {
  const p = c.p;
  return [
    ...fills.map((f) => poly(f.map((i) => p[i]), { closed: true, fill: 0.15, noStroke: true, color: bgOf(c) })),
    poly(p.slice(0, Math.max(names.length, 2))),
    ...links.flatMap(([i, j, text]) => [seg(p[i], p[j], { dash: 2, w: 1 }), ...(text ? [txt(mid(p[i], p[j]), text, { align: "center", bg: c.d.color, size: 12 })] : [])]),
    ...letters(c, names, true),
  ];
}

// Giao điểm 2 đường thẳng (vô hạn) u1u2 và v1v2; song song thì null
function intersect(u1: Pt, u2: Pt, v1: Pt, v2: Pt): Pt | null {
  const d = (u1.x - u2.x) * (v1.y - v2.y) - (u1.y - u2.y) * (v1.x - v2.x);
  if (Math.abs(d) < 1e-9) return null;
  const t = ((u1.x - v1.x) * (v1.y - v2.y) - (u1.y - v1.y) * (v1.x - v2.x)) / d;
  return { x: u1.x + t * (u2.x - u1.x), y: u1.y + t * (u2.y - u1.y) };
}

// XABCD và Cypher: tỉ lệ trên X–B, A–C, B–D, X–D (Cypher đo A–C theo XC/XA, X–D theo CD/XC)
function harmonic(c: Ctx, cypher: boolean): Shape[] {
  const [X, A, B, C, D] = c.d.points.map((q) => q.price);
  return pattern(c, ["X", "A", "B", "C", "D"], [
    [0, 2, ratioOf(B - A, A - X)],
    [1, 3, cypher ? ratioOf(C - X, A - X) : ratioOf(C - B, B - A)],
    [2, 4, ratioOf(D - C, C - B)],
    [0, 4, cypher ? ratioOf(D - C, C - X) : ratioOf(D - A, A - X)],
  ], [[0, 1, 2], [2, 3, 4]]);
}

// Head and shoulders như TV: đường cổ chấm qua 2 đáy, kéo tới chỗ cắt cạnh ngoài; tô vai trái, đầu, vai phải
function headShoulders(c: Ctx): Shape[] {
  const p = c.p;
  const L = intersect(p[2], p[4], p[0], p[1]) ?? p[2], R = intersect(p[2], p[4], p[5], p[6]) ?? p[4];
  const label = (i: number, text: string) => {
    const neck = p[2].y + ((p[4].y - p[2].y) * (p[i].x - p[2].x)) / (p[4].x - p[2].x || 1);
    return txt({ x: p[i].x, y: p[i].y + (p[i].y < neck ? -14 : 14) }, text, { align: "center", bg: c.d.color, size: 12 });
  };
  return [
    ...[[L, p[1], p[2]], [p[2], p[3], p[4]], [p[4], p[5], R]].map((t) => poly(t, { closed: true, fill: 0.15, noStroke: true, color: bgOf(c) })),
    poly(p),
    seg(L, R, { dash: 2, w: 1 }),
    label(1, "Left Shoulder"), label(3, "Head"), label(5, "Right Shoulder"),
  ];
}

// Triangle pattern như TV: AC và BD kéo tới đỉnh hội tụ, đường chấm dọc tại A, tô tam giác đó
function trianglePattern(c: Ctx): Shape[] {
  const [a, b, cc, d] = c.p;
  const apex = intersect(a, cc, b, d);
  const out: Shape[] = [];
  if (apex && apex.x > Math.max(a.x, b.x, cc.x, d.x)) {
    const top = intersect(b, d, a, { x: a.x, y: a.y + 1 }) ?? b;
    out.push(poly([a, top, apex], { closed: true, fill: 0.15, noStroke: true, color: bgOf(c) }), seg(a, apex, { dash: 2, w: 1 }), seg(top, apex, { dash: 2, w: 1 }), seg(a, top, { dash: 2, w: 1 }));
  } else {
    out.push(ray(a, cc, { dash: 2, w: 1 }), ray(b, d, { dash: 2, w: 1 }));
  }
  return [...out, poly(c.p), ...letters(c, ["A", "B", "C", "D"], true)];
}

// Elliott như TV: nhãn "(1)…" màu đường, không nền, điểm đầu không có nhãn
const elliott = (names: string[]) => (c: Ctx): Shape[] => [poly(c.p), ...letters(c, ["", ...names.map((x) => `(${x})`)])];

export { computeProfile }; // nay nằm ở volumeProfile/compute.ts (dùng chung với indicator)

// Màu mặc định đo từ FRVP của TV: thanh ngoài Value Area mờ 25%, trong Value Area đục 70% (cùng tông xanh ngọc / hồng), POC cam nét liền,
// VAH / VAL xanh dương nét đứt, đều dày 1px; "Histogram Box" là nền hộp của profile (đục 6%). Màu 6 chữ số (bản lưu cũ) vẫn vẽ như trước (0.4 / 0.75).
export const VP_DEFAULTS = {
  layout: "rows", rows: 24, volume: "updown", va: 70, agg: "ticks", extend: false, width: 30, place: "left", values: false,
  up: "#26c6da40", down: "#ec407a40", vaUp: "#26c6dab3", vaDown: "#ec407ab3", box: "#26c6da0f",
  showVah: true, vahColor: "#2962ff", vahDash: 1, showVal: true, valColor: "#2962ff", valDash: 1, showPoc: true, pocColor: "#ff9800", pocDash: 0,
};

export const VP_BY: Record<string, typeof VP_DEFAULTS> = {
  frvp: VP_DEFAULTS,
  avp: { ...VP_DEFAULTS, extend: true, width: 40, place: "right", vahColor: "#ffffff", valColor: "#ffffff" },
};

const axisText = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.7 ? "#000000" : "#ffffff";
};

// Nến tính volume trong [from, to): dữ liệu khung nhỏ (profileBars) cho mọi nến đã đóng, vì TV chia volume theo
// nến khung nhỏ cho sát thực tế. Nến cuối của chart còn đang chạy lấy từ chart để luôn mới; đầu / đuôi mà khung nhỏ
// không phủ tới (thiếu dữ liệu, mới tải chưa xong) cũng dùng nến chart, như TV ("nếu thiếu thì dùng khung chart").
export function profileSource(c: Ctx, from: number, to: number): Bar[] {
  const inRange = (b: Bar) => b.t >= from && b.t < to;
  const live = c.bars[c.bars.length - 1]?.t ?? Infinity;
  const fine = c.profileStep ? (c.profileBars ?? []).filter((b) => inRange(b) && b.t < live) : [];
  if (!fine.length || !c.profileStep) return c.bars.filter(inRange);
  const start = fine[0].t, end = fine[fine.length - 1].t + c.profileStep;
  return [
    ...c.bars.filter((b) => inRange(b) && b.t + c.step <= start),
    ...fine,
    ...c.bars.filter((b) => inRange(b) && b.t >= end),
  ];
}

// Khoảng thời gian (mở nến đầu → mở nến cuối) mà profile gom volume; AVP và FRVP có Extend Right chạy tới nến mới nhất
export function profileSpan(d: Drawing, lastT: number): { t0: number; t1: number } | null {
  if (d.type === "avp") return d.points.length >= 1 ? { t0: d.points[0].time, t1: Math.max(d.points[0].time, lastT) } : null;
  if (d.type !== "frvp" || d.points.length < 2) return null;
  const t0 = Math.min(d.points[0].time, d.points[1].time), t1 = Math.max(d.points[0].time, d.points[1].time);
  return { t0, t1: d.opts?.extend ? Math.max(t1, lastT) : t1 };
}

/** Bề ngang một nến (px) quanh thời điểm `t`: profile như TV tính từ mép trái nến đầu tới mép phải nến cuối (không phải từ tâm nến). */
function barWidth(c: Ctx, t: number): number {
  const a = c.X(t), b = c.X(t + c.step);
  return a === null || b === null ? 0 : Math.abs(b - a);
}

/** Giá cao nhất / thấp nhất của các nến mà profile gom (cả phần Extend Right): hai đầu dọc của hộp, nơi TV đặt handle và nhãn trục giá. */
export function profileRange(c: Ctx): { hi: number; lo: number } | null {
  const lastT = c.bars[c.bars.length - 1]?.t ?? 0;
  const span = profileSpan(c.d, lastT);
  if (!span) return null;
  let hi = -Infinity, lo = Infinity;
  for (const b of c.bars) {
    if (b.t < span.t0 || b.t >= span.t1 + c.step) continue;
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
  }
  return hi >= lo ? { hi, lo } : null;
}

/** FRVP như TV: 2 handle ở hai góc chéo của hộp (trái-trên là nến đầu, phải-dưới là nến cuối), chỉ kéo ngang. */
function profileHandles(c: Ctx): Pt[] {
  const r = profileRange(c);
  const [a, b] = c.d.points;
  if (!r || !a || !b) return c.p.slice(0, 2);
  const topFirst = a.time <= b.time;
  const y = (top: boolean) => c.Y(top ? r.hi : r.lo);
  const ys = [y(topFirst), y(!topFirst)];
  return c.p.slice(0, 2).map((p, i) => ({ x: p.x, y: ys[i] ?? p.y }));
}

function volumeProfile(c: Ctx, t0: number, t1: number, anchored = false): Shape[] {
  // Như TV: lúc vẽ / kéo chỉ có vạch dọc ở mép khoảng (và FRVP thêm đường chéo nối 2 điểm), đều xám #808080 đặc 1px;
  // nhả chuột mới hiện profile (khỏi tưởng profile đang nhấp nháy)
  if (c.dragging) {
    const grey = { w: 1, color: "#808080" };
    const verticals = (anchored ? [t0] : [t0, t1]).flatMap((t) => {
      const x = c.X(t);
      return x === null ? [] : [seg({ x, y: 0 }, { x, y: c.h }, grey)];
    });
    return anchored || c.p.length < 2 ? verticals : [...verticals, seg(c.p[0], c.p[1], grey)];
  }
  const o = { ...(VP_BY[c.d.type] ?? VP_DEFAULTS), ...c.d.opts } as typeof VP_DEFAULTS;
  const tick = c.tickSize > 0 ? c.tickSize : 10 ** -c.digits;
  // Extend Right (và AVP): profile gom volume tới nến mới nhất
  const lastT = c.bars[c.bars.length - 1]?.t ?? t1;
  const toLast = anchored || o.extend;
  const end = (toLast ? Math.max(t1, lastT) : t1) + c.step;
  // "1 tick": mỗi tick rơi đúng row chứa giá của nó; chưa có tick (ngoài độ sâu, chưa nạp xong) thì nến khung nhỏ như Time
  const vp =
    (o.agg === "ticks" && c.ticks ? computeTickProfile(c.ticks, c.bars.filter((b) => b.t >= t0 && b.t < end), t0, end, tick, o.rows, o.va, o.layout) : null) ??
    computeProfile(profileSource(c, t0, end), tick, o.rows, o.va, o.layout);
  if (!vp) return [];
  const { lo, hi, size, N, up, dn, total, mv, poc, vl, vh } = vp;

  // Hộp từ mép trái nến đầu tới mép phải nến cuối của khoảng neo; Extend Right / AVP kéo vạch POC / VAH / VAL và hộp tới mép phải của nến mới nhất
  // (không tới mép chart). Bề rộng histogram (% of the box) tính theo hộp của khoảng neo, không theo phần kéo dài.
  const xa = c.X(t0), xb = c.X(t1), xl = c.X(Math.max(t1, lastT));
  if (xa === null || xb === null || xl === null) return [];
  const half = barWidth(c, t0) / 2;
  const left = Math.min(xa, xb) - half, right = Math.max(xa, xb) + half;
  const xEnd = toLast ? Math.max(right, xl + half) : right;
  const histW = Math.max(20, ((anchored ? xEnd - left : right - left) * o.width) / 100);
  const dir = o.place === "right" ? -1 : 1;
  const base = dir === 1 ? left : anchored ? xEnd : right;
  const out: Shape[] = [];
  // Histogram Box: nền của cả hộp (từ giá thấp nhất tới cao nhất của các nến gom), vẽ dưới histogram
  const yTop = c.Y(hi), yBot = c.Y(lo);
  if (o.box && yTop !== null && yBot !== null) {
    out.push(poly([{ x: left, y: yBot }, { x: xEnd, y: yBot }, { x: xEnd, y: yTop }, { x: left, y: yTop }], { closed: true, fill: 1, noStroke: true, color: o.box }));
  }
  // Delta = up − down của từng row: thanh dài theo |delta| (so với row lệch nhất), màu theo dấu
  const delta = up.map((u, i) => u - dn[i]);
  const maxDelta = Math.max(...delta.map(Math.abs));
  // Delta + Total: histogram chia đôi quanh một trục, delta (theo |delta| / row lệch nhất) sang trái, total (theo volume / row lớn nhất) sang phải
  const axis = (dir === 1 ? base : base - histW) + histW / 2;

  for (let i = 0; i < N; i++) {
    const rowLow = lo + size * i, rowHigh = Math.min(hi, lo + size * (i + 1));
    const yb = c.Y(rowLow), yt = c.Y(rowHigh);
    if (yb === null || yt === null) continue;
    const inVa = i >= vl && i <= vh;
    // Mỗi row là 1 thanh riêng: chừa 1px đáy cho khe giữa các thanh khi row đủ cao (như TV);
    // row quá thấp thì để liền, khỏi mất thanh.
    const top = Math.min(yb, yt), bottom = Math.max(yb, yt);
    const barBottom = bottom - top >= 3 ? bottom - 1 : bottom;
    // màu có alpha riêng (mặc định như TV) thì vẽ nguyên; màu 6 chữ số của bản lưu cũ giữ độ đục cũ
    const rect = (a: number, b: number, color: string) =>
      poly([{ x: a, y: barBottom }, { x: b, y: barBottom }, { x: b, y: top }, { x: a, y: top }], { closed: true, fill: color.length > 7 ? 1 : inVa ? 0.75 : 0.4, noStroke: true, color });
    const wUp = (up[i] / mv) * histW, wDn = (dn[i] / mv) * histW;
    let len = (total[i] / mv) * histW; // chiều dài thanh, để đặt nhãn Values
    if (o.volume === "deltatotal") {
      const lenD = maxDelta > 0 ? (Math.abs(delta[i]) / maxDelta) * (histW / 2) : 0;
      len = (total[i] / mv) * (histW / 2);
      if (lenD > 0) out.push(rect(axis, axis - lenD, delta[i] > 0 ? (inVa ? o.vaUp : o.up) : inVa ? o.vaDown : o.down));
      if (len > 0) out.push(rect(axis, axis + len, inVa ? o.vaUp : o.up));
      if (o.values) {
        const y = (yb + yt) / 2;
        if (Math.round(delta[i]) !== 0) out.push(txt({ x: axis - lenD - 3, y }, String(Math.round(delta[i])), { size: 9, align: "right" }));
        if (Math.round(total[i]) !== 0) out.push(txt({ x: axis + len + 3, y }, String(Math.round(total[i])), { size: 9, align: "left" }));
      }
      continue;
    }
    if (o.volume === "delta") {
      len = maxDelta > 0 ? (Math.abs(delta[i]) / maxDelta) * histW : 0;
      if (len > 0) out.push(rect(base, base + dir * len, delta[i] > 0 ? (inVa ? o.vaUp : o.up) : inVa ? o.vaDown : o.down));
    } else if (o.volume === "total") out.push(rect(base, base + dir * len, inVa ? o.vaUp : o.up));
    else {
      if (wUp > 0) out.push(rect(base, base + dir * wUp, inVa ? o.vaUp : o.up));
      if (wDn > 0) out.push(rect(base + dir * wUp, base + dir * (wUp + wDn), inVa ? o.vaDown : o.down));
    }
    const shown = o.volume === "delta" ? delta[i] : total[i];
    if (o.values && Math.round(shown) !== 0) out.push(txt({ x: base + dir * (len + 3), y: (yb + yt) / 2 }, String(Math.round(shown)), { size: 9, align: dir === 1 ? "left" : "right" }));
  }

  if (o.volume === "deltatotal") {
    const yLow = c.Y(lo), yHigh = c.Y(hi);
    if (yLow !== null && yHigh !== null) out.push(seg({ x: axis, y: yLow }, { x: axis, y: yHigh }, { color: "#787b86", w: 1 }));
  }
  const line = (price: number, color: string, extra: O) => {
    const y = c.Y(price);
    if (y === null) return;
    out.push(seg({ x: left, y }, { x: xEnd, y }, { color, w: 1, ...extra }));
  };
  const dashOf = (v: number) => (v === 1 || v === 2 ? v : 0) as 0 | 1 | 2;
  if (o.showVah) line(Math.min(hi, lo + size * (vh + 1)), o.vahColor, { dash: dashOf(o.vahDash) });
  if (o.showVal) line(lo + size * vl, o.valColor, { dash: dashOf(o.valDash) });
  if (o.showPoc) line((lo + size * poc + Math.min(hi, lo + size * (poc + 1))) / 2, o.pocColor, { dash: dashOf(o.pocDash) });
  // Khi chọn: nhãn trục giá ở hai đầu hộp (xanh dương) và dải sáng giữa chúng, như TV
  if (c.selected && yTop !== null && yBot !== null) {
    out.push({ k: "axis", y: yTop, text: c.fp(hi), bg: "#2962ff", color: "#ffffff", band: true }, { k: "axis", y: yBot, text: c.fp(lo), bg: "#2962ff", color: "#ffffff", band: true });
  }
  return out;
}

// Tổng volume các nến trong khoảng thời gian, dạng TV "185.08K"
export function volumeIn(bars: Bar[], t0: number, t1: number) {
  const [lo, hi] = t0 <= t1 ? [t0, t1] : [t1, t0];
  return bars.reduce((s, b) => (b.t >= lo && b.t <= hi ? s + b.v : s), 0);
}
export const fmtVol = (v: number) =>
  v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(2)}K` : String(Math.round(v));

// Các dòng nhãn của measurers như TV: "25.000 (0.60%) 2,500.0" / "20 bars, 5h" / "Vol 185.08K"
function rangeText(c: Ctx) {
  const [pa, pb] = c.d.points;
  const d = pb.price - pa.price;
  const pip = (Math.sign(d) * pips(Math.abs(d), c.digits)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return {
    change: c.fp(d), pct: pctStr(pa.price, pb.price), pip,
    time: `${c.barsBetween(pa.time, pb.time)} bars, ${fmtDur(pb.time - pa.time)}`,
    vol: `Vol ${fmtVol(volumeIn(c.bars, pa.time, pb.time))}`,
  };
}

// Hộp đo như TV: nền 15%, mũi tên dọc (giá) / ngang (thời gian) ở giữa, nhãn ngoài hộp về phía điểm 2.
// box: ô nền tối (#2E2E2E) cho nhãn; không có thì chữ màu hình, không nền.
function rangeBox(c: Ctx, o: { vArrow: boolean; hArrow: boolean; hEdges: boolean; vEdges: boolean; lines: string[]; color?: string; box?: string }): Shape[] {
  const [a, b] = c.p;
  const color = o.color ?? c.d.color;
  const m = mid(a, b);
  const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
  const out: Shape[] = [poly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], { closed: true, fill: 0.15, noStroke: true, color: o.color ?? bgOf(c) })];
  if (o.hEdges) out.push(seg({ x: x0, y: a.y }, { x: x1, y: a.y }, { color }), seg({ x: x0, y: b.y }, { x: x1, y: b.y }, { color }));
  if (o.vEdges) out.push(seg({ x: a.x, y: y0 }, { x: a.x, y: y1 }, { color }), seg({ x: b.x, y: y0 }, { x: b.x, y: y1 }, { color }));
  if (o.vArrow) out.push(seg({ x: m.x, y: a.y }, { x: m.x, y: b.y }, { color }), head({ x: m.x, y: a.y }, { x: m.x, y: b.y }, 8, { color }));
  if (o.hArrow) out.push(seg({ x: a.x, y: m.y }, { x: b.x, y: m.y }, { color }), head({ x: a.x, y: m.y }, { x: b.x, y: m.y }, 8, { color }));
  const text = o.lines.filter(Boolean).join("\n");
  if (text) {
    const up = b.y <= a.y;
    // tab Text của TV chỉnh kiểu chữ của nhãn số liệu (màu mặc định trắng, cỡ 12)
    const st = SPEC[c.d.type]?.text ? textStyle(c) : { size: 12, bold: false, italic: false, color: o.box ? "#ffffff" : color };
    const half = (o.lines.filter(Boolean).length * st.size * 1.3) / 2 + (o.box ? 5 : 0) + 6;
    out.push(txt({ x: m.x, y: up ? y0 - half : y1 + half }, text, { align: "center", ...st, ...(o.box ? { bg: o.box } : {}) }));
  }
  return out;
}

// Date and price range; Measure (tạm) thì xanh khi giá tăng, đỏ khi giảm
function measure(c: Ctx, directional = false): Shape[] {
  const t = rangeText(c);
  const up = c.d.points[1].price >= c.d.points[0].price;
  const color = directional ? (up ? "#2962ff" : "#f23645") : undefined;
  return rangeBox(c, {
    vArrow: true, hArrow: true, hEdges: false, vEdges: false, color,
    lines: [`${t.change} (${t.pct}) ${t.pip}`, t.time, t.vol], box: directional ? color : "#2e2e2e",
  });
}

// riskMode như TV riskDisplayMode: risk là % tài khoản (percent) hay số tiền (money); TV tạo hình mới với 250 (money).
// leverage giới hạn Qty (TV mặc định 10000); qtyPrecision: "default" = theo lượng nhỏ nhất của symbol, hoặc số lẻ "0"…"10".
// lineColor / lineWidth: đường entry (TV linecolor #808080, linewidth 1); fontSize: cỡ chữ nhãn (TV 12)
export const POS_DEFAULTS = { account: 1000, lot: 1, risk: 250, riskMode: "money", leverage: 10000, qtyPrecision: "default", profit: "#089981", stop: "#f23645", alpha: 0.2, lineColor: "#808080", lineWidth: 1, fontSize: 12 };

// Số lẻ của bước giá (0.001 -> 3, 0.25 -> 2) và làm tròn giá theo bước đó
const decimals = (x: number) => {
  let d = 0;
  while (d < 10 && Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) > 1e-9) d++;
  return d;
};
export const roundToTick = (v: number, tick: number) => +(Math.round(v / tick) * tick).toFixed(decimals(tick));

type PosOpts = Pick<typeof POS_DEFAULTS, "account" | "lot" | "risk"> & Partial<Pick<typeof POS_DEFAULTS, "riskMode" | "leverage" | "qtyPrecision">> & { minQty?: number };

// Khối lượng theo rủi ro và kết quả lệnh, như TV:
// - Qty = rủi ro / (stop × lot), nhưng không quá tài khoản × leverage / (entry × lot); Amount / PnL
//   tính theo Qty chưa làm tròn. Hiện Qty (đo trên TV): chọn QTY precision thì làm tròn thường
//   (0.7001 → "1"); Default thì lấy số lẻ của lượng nhỏ nhất, và symbol giao dịch theo đơn vị nguyên
//   (vàng, forex: 17.64 → "17") làm tròn xuống, symbol có lượng lẻ (BTC: 0.4376 → "0.438") làm tròn thường
// - lệnh chỉ mở khi giá chạm entry (tính cả gap qua entry so với giá đóng cửa nến trước), rồi mới
//   xét stop (cùng nến thì tính stop) / target tới mép phải
// - chưa đóng (kể cả chưa khớp entry) thì PnL theo giá đóng cửa nến cuối trong khối
export function positionStats(bars: Bar[], points: Anchor[], long: boolean, o: PosOpts) {
  const [pe, pT, pR, pS] = points;
  const dT = Math.abs(pT.price - pe.price), dS = Math.abs(pS.price - pe.price) || 1e-9;
  const riskAmt = o.riskMode === "money" ? o.risk : (o.account * o.risk) / 100;
  const lev = o.leverage ?? POS_DEFAULTS.leverage;
  let qtyRaw = riskAmt / (dS * o.lot);
  if (lev > 0 && pe.price > 0) qtyRaw = Math.min(qtyRaw, (o.account * lev) / (pe.price * o.lot));
  const minQty = o.minQty && o.minQty > 0 ? o.minQty : 1;
  const auto = o.qtyPrecision === undefined || o.qtyPrecision === "default";
  const prec = auto ? decimals(minQty) : Number(o.qtyPrecision) || 0;
  const scaled = qtyRaw * 10 ** prec;
  const qty = (auto && minQty >= 1 ? Math.floor(scaled + 1e-9) : Math.round(scaled)) / 10 ** prec;

  let closed = false, exitPrice = pe.price, exitT: number | null = null, entryT: number | null = null;
  let prevC: number | null = null;
  const tEnd = Math.max(pe.time, pR.time);
  for (const b of bars) {
    if (b.t <= pe.time) { prevC = b.c; continue; }
    if (b.t > tEnd) break;
    exitT = b.t;
    exitPrice = b.c;
    if (entryT === null) {
      const lo = Math.min(b.l, prevC ?? b.l), hi = Math.max(b.h, prevC ?? b.h);
      prevC = b.c;
      if (lo > pe.price || hi < pe.price) continue;
      entryT = b.t;
    }
    const hitS = long ? b.l <= pS.price : b.h >= pS.price;
    const hitT = long ? b.h >= pT.price : b.l <= pT.price;
    if (hitS) { closed = true; exitPrice = pS.price; break; }
    if (hitT) { closed = true; exitPrice = pT.price; break; }
  }
  const pnlPts = long ? exitPrice - pe.price : pe.price - exitPrice;
  const tpPL = qtyRaw * dT * o.lot, slPL = qtyRaw * dS * o.lot;
  return {
    dT, dS, riskAmt, qty, closed, entryT, exitPrice, exitT, pnlPts, rr: dT / dS,
    pnl: pnlPts * qtyRaw * o.lot, tpPL, slPL, tpAmount: o.account + tpPL, slAmount: o.account - slPL,
  };
}

const minus = (s: string) => s.replace(/^-/, "\u2212"); // TV ghi số âm bằng dấu trừ "−"
// Số pip: cặp có pip lẻ (giá 3 hoặc 5 số lẻ, vd XAUUSD 0.001) thì 1 pip = 10 tick, như TV
const pips = (dist: number, digits: number) => dist / 10 ** -digits / (digits === 3 || digits === 5 ? 10 : 1);
// TV ghi pip luôn 1 số lẻ, có dấu phẩy nghìn: "1,681.5", "800.0"
const fmtPips = (v: number) => minus(v.toLocaleString("en-US", { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

// Stats của Position như TV (INFO › Stats, chọn nhiều); TP PL / SL PL tắt sẵn
const POS_STATS: [string, string, boolean][] = [
  ["tpPriceOffset", "TP price offset", true], ["tpPercentOffset", "TP percent offset", true], ["tpTickOffset", "TP tick offset", true],
  ["tpAmount", "TP amount", true], ["tpPL", "TP PL", false], ["openClosePL", "Open/closed PL", true], ["qty", "Qty", true],
  ["riskRewardRatio", "Risk/reward ratio", true], ["slPriceOffset", "SL price offset", true], ["slPercentOffset", "SL percent offset", true],
  ["slTickOffset", "SL tick offset", true], ["slAmount", "SL amount", true], ["slPL", "SL PL", false],
];
const POS_OPTIONS: ToolOption[] = [
  { key: "priceLabels", label: "Price labels", def: true },
  ...POS_STATS.map(([key, label, def]): ToolOption => ({ key, label, def, section: "INFO" })),
  { key: "compact", label: "Compact stats mode", def: false, section: "INFO" },
  { key: "alwaysShowStats", label: "Always show stats", def: false, section: "INFO" },
];

// points: [entry, target, right-edge, stop]
function position(c: Ctx): Shape[] {
  const o = { ...POS_DEFAULTS, ...c.d.opts } as typeof POS_DEFAULTS;
  const on = (k: string) => Boolean(optOf(c.d, k));
  const [e, t, r, s] = c.p;
  const pe = c.d.points[0];
  const long = c.d.type !== "shortpos"; // như TV: theo loại tool, không suy từ vị trí target
  const x0 = Math.min(e.x, r.x), x1 = Math.max(e.x, r.x);
  const st = positionStats(c.bars, c.d.points, long, { ...o, minQty: c.minQty });
  const fs = Number(o.fontSize) || 12;
  const num = (v: number, max = 2, useGrouping = true) => v.toLocaleString(undefined, { maximumFractionDigits: max, useGrouping });

  const box = (xa: number, xb: number, y0: number, y1: number, color: string) =>
    poly([{ x: xa, y: y0 }, { x: xb, y: y0 }, { x: xb, y: y1 }, { x: xa, y: y1 }], { closed: true, fill: o.alpha, noStroke: true, color });
  const cx = (x0 + x1) / 2;
  const tc = c.d.textColor ?? "#ffffff";
  const out: Shape[] = [box(x0, x1, e.y, t.y, o.profit), box(x0, x1, e.y, s.y, o.stop)];

  // Đã khớp entry: tô đậm thêm phần đã chạy (từ nến khớp tới nến thoát, giữa giá entry và giá thoát)
  // + nét đứt nối 2 điểm đó
  const nx = st.entryT === null ? null : c.X(st.entryT), ex = st.exitT === null ? null : c.X(st.exitT), ey = c.Y(st.exitPrice);
  if (nx !== null && ex !== null && ey !== null) {
    out.push(box(nx, ex, e.y, ey, st.pnlPts >= 0 ? o.profit : o.stop), seg({ x: nx, y: e.y }, { x: ex, y: ey }, { dash: 1, w: 1, color: "#b2b5be" }));
  }
  // Như TV (đo từng pixel): đường entry linecolor chạy suốt chiều rộng, vẽ trên các vùng nền
  out.push(seg({ x: x0, y: e.y }, { x: x1, y: e.y }, { color: o.lineColor, w: Number(o.lineWidth) || 1 }));

  if (on("priceLabels")) {
    for (const [y, price, bg] of [[e.y, pe.price, o.lineColor], [t.y, c.d.points[1].price, o.profit], [s.y, c.d.points[3].price, o.stop]] as const) {
      out.push({ k: "axis", y, text: c.fp(price), bg, color: "#ffffff", always: true });
    }
  }

  if (c.hovered || c.selected || on("alwaysShowStats")) {
    const compact = on("compact");
    // Target: 16.815 (0.408%) 1,681.5, Amount: 1250, PnL: 250.000 — compact bỏ tên mục
    const side = (p: "tp" | "sl", name: string, dist: number, amount: number, pl: number) => {
      const off = [
        on(`${p}PriceOffset`) && c.fp(dist),
        on(`${p}PercentOffset`) && `(${((dist / pe.price) * 100).toFixed(3)}%)`,
        on(`${p}TickOffset`) && fmtPips(pips(dist, c.digits)),
      ].filter(Boolean).join(" ");
      const amt = on(`${p}Amount`) && num(amount, 2, false); // TV: "1,432.7" nhưng "Amount: 1250"
      const plv = on(`${p}PL`) && minus(pl.toFixed(3));
      if (compact) return [off, amt, plv].filter(Boolean).join(" ");
      const parts = [off, amt && `Amount: ${amt}`, plv && `PnL: ${plv}`].filter(Boolean);
      return parts.length ? `${name}: ${parts.join(", ")}` : "";
    };
    const pnl = on("openClosePL") && minus(c.fp(st.pnlPts)), qty = on("qty") && num(st.qty, 10);
    const rr = on("riskRewardRatio") && num(st.rr);
    const mid = compact
      ? [[pnl, qty].filter(Boolean).join(" ~ "), rr || ""]
      : [[pnl && `${st.closed ? "Closed" : "Open"} PnL: ${pnl}`, qty && `Qty: ${qty}`].filter(Boolean).join(", "), rr ? `Risk/reward ratio: ${rr}` : ""];
    const midText = mid.filter(Boolean).join("\n");
    // nhãn target/stop nằm ngoài vùng, nhưng không đè nhãn PnL ở giữa khi target/stop sát entry
    const lines = midText ? midText.split("\n").length : 0;
    const gap = lines ? (lines * fs * 1.3) / 2 + 5 + (fs * 1.3) / 2 + 5 + 2 : 0;
    const away = (y: number, fallback: 1 | -1) => {
      const dir = Math.sign(y - e.y) || fallback;
      return e.y + dir * Math.max(Math.abs(y + dir * 14 - e.y), gap);
    };
    const tText = side("tp", "Target", st.dT, st.tpAmount, st.tpPL), sText = side("sl", "Stop", st.dS, st.slAmount, -st.slPL);
    if (tText) out.push(txt({ x: cx, y: away(t.y, long ? -1 : 1) }, tText, { align: "center", bg: o.profit, color: tc, size: fs }));
    if (sText) out.push(txt({ x: cx, y: away(s.y, long ? 1 : -1) }, sText, { align: "center", bg: o.stop, color: tc, size: fs }));
    // như TV: nhãn PnL (theo giá) nằm giữa, ngay trên đường entry
    if (midText) out.push(txt({ x: cx, y: e.y }, midText, { align: "center", bg: st.pnlPts >= 0 ? o.profit : o.stop, color: tc, size: fs }));
  }
  return out;
}

// points: [entry, target, right-edge, stop]. Như TV (lưu target/stop theo khoảng cách tới entry):
// - kéo entry thì target và stop dịch theo (prev = điểm trước khi kéo)
// - target luôn ở phía lời, stop ở phía lỗ, cách entry ít nhất 1 tick: kéo quá entry thì bị kẹp
//   chứ không tự đổi Long <-> Short
// - giá làm tròn theo tick. Không có tick (ô nhập giá trong Settings, đang gõ dở) thì không kẹp/tròn.
export const posConstrain = (dir: 1 | -1) => (p: Anchor[], i: number, tick?: number, prev?: Anchor[]) => {
  const [e, t, , s] = p;
  if (i === 0 && prev) {
    const d = e.price - prev[0].price;
    t.price = prev[1].price + d;
    s.price = prev[3].price + d;
  }
  if (tick !== undefined) {
    for (const q of [e, t, s]) q.price = roundToTick(q.price, tick);
    if (i === 1) t.price = dir === 1 ? Math.max(t.price, e.price + tick) : Math.min(t.price, e.price - tick);
    else if (i === 3) s.price = dir === 1 ? Math.min(s.price, e.price - tick) : Math.max(s.price, e.price + tick);
  }
  if (i === 0) {
    t.time = s.time = e.time;
    p[2].price = e.price;
  } else if (i === 1 || i === 3) p[i].time = e.time;
  else if (i === 2) p[2].price = e.price;
};

// Như TV (đo trên XAUUSD 15m ở 2 mức zoom): target/stop cách entry 20% biên độ High−Low của các
// nến đang thấy (làm tròn theo tick), rộng 1/7 số nến đang thấy (đếm theo nến, bỏ qua nghỉ phiên).
const posAt = (a: Anchor, v: OneClickView, dir: 1 | -1): Anchor[] => {
  const raw = v.hiLo > 0 ? v.hiLo * 0.2 : v.span > 0 ? v.span * 0.2 : a.price * 0.002;
  const d = Math.max(v.tick, roundToTick(raw, v.tick));
  const e = { time: a.time, price: roundToTick(a.price, v.tick) };
  return [
    e,
    { time: a.time, price: roundToTick(e.price + dir * d, v.tick) }, // cộng số thực ra 4132.8179999…
    { time: v.addBars(a.time, Math.max(1, Math.round(v.visibleBars / 7))), price: e.price },
    { time: a.time, price: roundToTick(e.price - dir * d, v.tick) },
  ];
};

// Table như TV: lưới rows × cols (mặc định 3 × 3), cột rộng 120px, hàng cao theo cỡ chữ (14 → 31px),
// góc trên trái ở điểm neo. Nội dung ô lưu trong opts.cells (JSON string[][]) vì opts chỉ chứa giá trị đơn.
export const TABLE_COL_W = 120;
export function tableCells(d: Drawing): string[][] {
  const rows = Number(d.opts?.rows) || 3, cols = Number(d.opts?.cols) || 3;
  let raw: unknown = [];
  try { raw = JSON.parse(String(d.opts?.cells ?? "[]")); } catch { /* hỏng thì coi như rỗng */ }
  const arr = Array.isArray(raw) ? (raw as unknown[][]) : [];
  return Array.from({ length: rows }, (_, r) => Array.from({ length: cols }, (_, k) => String(arr[r]?.[k] ?? "")));
}
export const tableRowH = (d: Drawing) => Math.round((Number(optOf(d, "fontSize")) || 14) * 1.3 + 13);
// Ô [hàng, cột] chứa điểm p; origin = góc trên trái của bảng (tọa độ chart)
export function tableCellAt(d: Drawing, origin: Pt, p: Pt): [number, number] | null {
  const cells = tableCells(d);
  const r = Math.floor((p.y - origin.y) / tableRowH(d)), k = Math.floor((p.x - origin.x) / TABLE_COL_W);
  return r >= 0 && r < cells.length && k >= 0 && k < cells[0].length ? [r, k] : null;
}

function table(c: Ctx): Shape[] {
  const { x, y } = c.p[0];
  const cells = tableCells(c.d), rh = tableRowH(c.d), cw = TABLE_COL_W;
  const W = cw * cells[0].length, H = rh * cells.length;
  const box = [{ x, y }, { x: x + W, y }, { x: x + W, y: y + H }, { x, y: y + H }];
  const out: Shape[] = [poly(box, { closed: true, fill: 1, noStroke: true, color: String(optOf(c.d, "bgColor")) }), poly(box, { closed: true, w: 1 })];
  for (let k = 1; k < cells[0].length; k++) out.push(seg({ x: x + cw * k, y }, { x: x + cw * k, y: y + H }, { w: 1 }));
  for (let r = 1; r < cells.length; r++) out.push(seg({ x, y: y + rh * r }, { x: x + W, y: y + rh * r }, { w: 1 }));
  const align = String(optOf(c.d, "hAlign")) as "left" | "center" | "right";
  const dx = align === "left" ? 8 : align === "center" ? cw / 2 : cw - 8;
  cells.forEach((row, r) => row.forEach((text, k) => {
    if (text) out.push(txt({ x: x + cw * k + dx, y: y + rh * r + rh / 2 }, text, { align, size: Number(optOf(c.d, "fontSize")) || 14, color: c.d.textColor ?? "#dbdbdb" }));
  }));
  return out;
}

const noteShapes = (c: Ctx, text: string, st: Partial<ReturnType<typeof textStyle>> = {}): Shape[] => {
  const [a, b] = c.p;
  return [seg(a, b, { w: 1 }), poly(circle(a, 3, 12), { closed: true, fill: 1 }), txt(b, text, { align: "left", bg: bgOf(c), size: 12, ...st })];
};

const offsetPt = (a: Anchor, v: OneClickView, bars = 10, pct = 0.002): Anchor => ({ time: v.addBars(a.time, bars), price: a.price * (1 + pct) });

// Như TV: rectangle có 8 handle - 4 góc (0,1 là 2 điểm neo; 2 = góc (t0, p1), 3 = (t1, p0))
// rồi 4 điểm giữa cạnh (trái, phải, cạnh p0, cạnh p1)
const rectHandles = (c: Ctx): Pt[] => {
  const [a, b] = c.p, m = mid(a, b);
  return [a, b, { x: a.x, y: b.y }, { x: b.x, y: a.y }, { x: a.x, y: m.y }, { x: b.x, y: m.y }, { x: m.x, y: a.y }, { x: m.x, y: b.y }];
};

const moveRectHandle = (pts: Anchor[], i: number, q: Anchor): Anchor[] => {
  const A = { ...pts[0] }, B = { ...pts[1] };
  if (i === 0 || i === 2 || i === 4) A.time = q.time;
  if (i === 1 || i === 3 || i === 5) B.time = q.time;
  if (i === 0 || i === 3 || i === 6) A.price = q.price;
  if (i === 1 || i === 2 || i === 7) B.price = q.price;
  return [A, B];
};

const END: [string, string][] = [["normal", "Normal"], ["arrow", "Arrow"]];

// Như TV: Info line bật sẵn mọi mục Stats, canh giữa, luôn hiện; trend line thì tắt hết
function lineOptions(extend: Ext, info: boolean, rightEnd = "normal"): ToolOption[] {
  return [
    { key: "leftEnd", label: "Left end", def: "normal", choices: END },
    { key: "rightEnd", label: "Right end", def: rightEnd, choices: END },
    { key: "extend", label: "Extend", def: extend, choices: EXTEND },
    { key: "middlePoint", label: "Middle point", def: false },
    { key: "priceLabels", label: "Price labels", def: false },
    { key: "showPriceRange", label: "Price range", def: info, section: "STATS" },
    { key: "showPercent", label: "Percent change", def: info, section: "STATS" },
    { key: "showPips", label: "Change in pips", def: info, section: "STATS" },
    { key: "showBars", label: "Bars range", def: info, section: "STATS" },
    { key: "showDateTime", label: "Date/time range", def: info, section: "STATS" },
    { key: "showDistance", label: "Distance", def: info, section: "STATS" },
    { key: "showAngle", label: "Angle", def: info, section: "STATS" },
    { key: "statsPosition", label: "Stats position", def: info ? "center" : "right", choices: [["left", "Left"], ["center", "Center"], ["right", "Right"]], section: "STATS" },
    { key: "alwaysShowStats", label: "Always show stats", def: info, section: "STATS" },
  ];
}

const LINE_TEXT: TextSpec = { kind: "line", size: 14, v: "top", h: "center" };

// Nội dung Stats theo các mục đã bật, như TV (mỗi nhóm 1 dòng):
// "30.000 (0.73%), 3,000.0" · "16 bars (4h), distance: 421 px" · "33.26°"
export function lineStats(c: Ctx): string {
  const [pa, pb] = c.d.points;
  const on = (k: string) => Boolean(optOf(c.d, k));
  const d = pb.price - pa.price;
  const [a, b] = c.p;
  const range = [on("showPriceRange") && minus(c.fp(d)), on("showPercent") && `(${minus(pctStr(pa.price, pb.price))})`].filter(Boolean).join(" ");
  const price = [range, on("showPips") && fmtPips(pips(Math.abs(d), c.digits) * Math.sign(d))].filter(Boolean).join(", ");
  const bars = on("showBars") && `${c.barsBetween(pa.time, pb.time)} bars`, dur = on("showDateTime") && fmtDur(pb.time - pa.time);
  const span = bars && dur ? `${bars} (${dur})` : bars || dur;
  const time = [span, on("showDistance") && `distance: ${Math.round(Math.hypot(b.x - a.x, b.y - a.y))} px`].filter(Boolean).join(", ");
  const angle = on("showAngle") ? `${((-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI).toFixed(2)}°` : "";
  return [price, time, angle].filter(Boolean).join("\n");
}

// Trend line và họ hàng: đường + đầu mũi tên, điểm giữa, nhãn giá 2 đầu, Stats, chữ
function lineTool(c: Ctx): Shape[] {
  const [pa, pb] = c.d.points;
  const l = lineExt(c, c.p);
  const out: Shape[] = [{ k: "line", ...l }];
  // đầu trái/phải theo màn hình
  const size = 10 + c.d.width * 2;
  if (optOf(c.d, "leftEnd") === "arrow") out.push(head(l.b, l.a, size));
  if (optOf(c.d, "rightEnd") === "arrow") out.push(head(l.a, l.b, size));
  const m = mid(c.p[0], c.p[1]);
  if (optOf(c.d, "middlePoint")) out.push(poly(circle(m, 3, 12), { closed: true, fill: 1 }));
  if (optOf(c.d, "priceLabels")) {
    for (const [p, a] of [[c.p[0], pa], [c.p[1], pb]] as const) {
      const above = p.y <= m.y;
      out.push(txt({ x: p.x, y: p.y + (above ? -12 : 12) }, c.fp(a.price), { align: "center", size: 11 }));
    }
  }
  const stats = lineStats(c);
  if (stats && (optOf(c.d, "alwaysShowStats") || c.hovered || c.selected)) {
    const pos = optOf(c.d, "statsPosition");
    const at = pos === "left" ? l.a : pos === "right" ? l.b : m;
    const dx = pos === "left" ? -8 : pos === "right" ? 8 : 0;
    out.push(txt({ x: at.x + dx, y: at.y }, stats, { align: pos === "left" ? "right" : pos === "right" ? "left" : "center", bg: c.d.color, size: 11 }));
  }
  out.push(...lineText(c, l.a, l.b));
  return out;
}

// Như TV: nhãn giá trên trục giá luôn hiện (tùy chọn "Price label")
const priceLabel = (c: Ctx): Shape[] =>
  optOf(c.d, "showPrice") ? [{ k: "axis", y: c.p[0].y, text: c.fp(c.d.points[0].price), bg: c.d.color, color: axisText(c.d.color), always: true }] : [];

function rectangle(c: Ctx): Shape[] {
  const [a, b] = c.p;
  const ext = String(optOf(c.d, "extend"));
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x);
  const left = ext === "left" || ext === "both" ? 0 : x0, right = ext === "right" || ext === "both" ? c.w : x1;
  const box = [{ x: left, y: a.y }, { x: right, y: a.y }, { x: right, y: b.y }, { x: left, y: b.y }];
  const bg = String(optOf(c.d, "backgroundColor") || c.d.color);
  const out: Shape[] = [];
  // nền màu riêng (như TV "Background") rồi mới tới viền
  if (optOf(c.d, "background")) out.push(poly(box, { closed: true, fill: 0.15, noStroke: true, color: bg }));
  out.push(poly(box, { closed: true }));
  if (optOf(c.d, "middleLine")) out.push(seg({ x: left, y: (a.y + b.y) / 2 }, { x: right, y: (a.y + b.y) / 2 }, { dash: 1, w: 1 }));
  out.push(...boxText(c, left, a.y, right, b.y));
  return out;
}

// Hồi quy tuyến tính giá theo chỉ số nến: hệ số, độ lệch chuẩn phần dư, hệ số tương quan Pearson
export function regression(ys: number[]) {
  const n = ys.length, mx = (n - 1) / 2, my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  ys.forEach((y, i) => { sxy += (i - mx) * (y - my); sxx += (i - mx) ** 2; syy += (y - my) ** 2; });
  const slope = sxx ? sxy / sxx : 0, icp = my - slope * mx;
  const sd = Math.sqrt(ys.reduce((s, y, i) => s + (y - (icp + slope * i)) ** 2, 0) / n);
  return { slope, icp, sd, pearson: sxx && syy ? sxy / Math.sqrt(sxx * syy) : 0 };
}

function fibSpeedFan(c: Ctx): Shape[] {
  const [a, b] = c.p;
  const [pa, pb] = [pt(c, 0).price, pt(c, 1).price];
  const levels = fibLevelsOf(c.d).filter((l) => l.on).sort((p, q) => p.coeff - q.coeff);
  // mức theo giá (mép phải) và theo thời gian (mép trên), tính từ điểm 2
  const priceSide = levels.flatMap((l) => { const y = c.Y(pb - (pb - pa) * l.coeff); return y === null ? [] : [{ l, q: { x: b.x, y } }]; });
  const timeSide = levels.map((l) => ({ l, q: { x: b.x - (b.x - a.x) * l.coeff, y: b.y } }));
  const far = (q: Pt) => add(a, mul(unit(sub(q, a)), 20000));
  const out: Shape[] = [];
  if (optOf(c.d, "background")) {
    // đi từ tia dọc (thời gian = 1) qua điểm 2 tới tia ngang (giá = 1)
    const seq = [...[...timeSide].reverse(), ...priceSide.slice(1)];
    for (let i = 0; i + 1 < seq.length; i++) out.push(poly([a, far(seq[i].q), far(seq[i + 1].q)], { closed: true, fill: 0.2, noStroke: true, color: seq[i + 1].l.color }));
  }
  if (optOf(c.d, "grid")) {
    for (const { q } of priceSide) out.push(seg({ x: a.x, y: q.y }, q, { w: 1, color: "rgba(21, 56, 153, 0.8)" }));
    for (const { q } of timeSide) out.push(seg({ x: q.x, y: a.y }, q, { w: 1, color: "rgba(21, 56, 153, 0.8)" }));
  }
  for (const { l, q } of [...priceSide, ...timeSide.slice(1)]) out.push(ray(a, q, { color: l.color }));
  if (optOf(c.d, "showLabels")) {
    const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
    for (const { l, q } of priceSide) {
      out.push(txt({ x: x0 - 4, y: q.y }, String(l.coeff), { size: 11, color: l.color, align: "right" }), txt({ x: x1 + 4, y: q.y }, String(l.coeff), { size: 11, color: l.color, align: "left" }));
    }
    for (const { l, q } of timeSide) {
      out.push(txt({ x: q.x, y: y0 - 9 }, String(l.coeff), { size: 11, color: l.color, align: "center" }), txt({ x: q.x, y: y1 + 9 }, String(l.coeff), { size: 11, color: l.color, align: "center" }));
    }
  }
  return out;
}

// ---------- Gann Square / Gann Square Fixed (đo trên TV, xem docs/tv-drawing-settings-reference.md) ----------
// Lưới 5×5 ô tính từ điểm 1; mức 0…5; fan line a×b từ điểm 1 tới mép hộp; cung tâm điểm 1 bán kính
// = khoảng cách tới điểm lưới (x, y); nền giữa 2 cung liền nhau tô màu cung ngoài 20%.
const GANN_LEVELS = ["#787b86", "#ff9800", "#00bcd4", "#4caf50", "#089981", "#787b86"];
const GANN_FANS: [number, number, string, boolean][] = [
  [8, 1, "#b39ddb", false], [5, 1, "#f23645", false], [4, 1, "#787b86", false], [3, 1, "#ff9800", false],
  [2, 1, "#00bcd4", true], [1, 1, "#4caf50", true], [1, 2, "#089981", true],
  [1, 3, "#089981", false], [1, 4, "#2962ff", false], [1, 5, "#9575cd", false], [1, 8, "#b39ddb", false],
];
const GANN_ARCS: [number, number, string][] = [
  [1, 0, "#ff9800"], [1, 1, "#ff9800"], [1.5, 0, "#ff9800"], [2, 0, "#00bcd4"], [2, 1, "#00bcd4"],
  [3, 0, "#4caf50"], [3, 1, "#4caf50"], [4, 0, "#089981"], [4, 1, "#089981"], [5, 0, "#2962ff"], [5, 1, "#2962ff"],
];

// o = điểm 1; ux, uy = số pixel của 1 ô theo x / y (có dấu: hướng về phía điểm 2)
export function gannGrid(o: Pt, ux: number, uy: number, background = true): Shape[] {
  const P = (x: number, y: number): Pt => ({ x: o.x + x * ux, y: o.y + y * uy });
  const out: Shape[] = [];
  const arcs: Shape[] = [];
  let prev: Pt[] | null = null;
  for (const [x, y, color] of GANN_ARCS) {
    const r = Math.hypot(x, y);
    const arc = Array.from({ length: 49 }, (_, i) => P(r * Math.cos((Math.PI / 2) * (i / 48)), r * Math.sin((Math.PI / 2) * (i / 48))));
    if (background) out.push(poly(prev ? [...arc, ...[...prev].reverse()] : [o, ...arc], { closed: true, fill: 0.2, noStroke: true, color }));
    arcs.push(poly(arc, { color }));
    prev = arc;
  }
  for (let i = 0; i <= 5; i++) {
    out.push(seg(P(i, 0), P(i, 5), { color: GANN_LEVELS[i] }), seg(P(0, i), P(5, i), { color: GANN_LEVELS[i] }));
  }
  for (const [a, b, color, on] of GANN_FANS) {
    if (!on) continue;
    const k = Math.min(5 / a, 5 / b);
    out.push(seg(o, P(a * k, b * k), { color }));
  }
  return [...out, ...arcs];
}

// Gann Square: hộp vuông theo tỉ lệ giá/nến (scaleRatio) chốt lúc tạo = đúng hình vuông trên màn
// hình lúc đó; sau đó zoom thì vẫn giữ tỉ lệ giá/nến. Điểm 2 chỉ quyết định số nến + hướng.
function gannSquareEnd(c: Ctx) {
  const [pa, pb] = c.d.points;
  const bars = c.barsBetween(pa.time, pb.time);
  const ratio = Number(c.d.opts?.scaleRatio) || (bars ? Math.abs(pb.price - pa.price) / Math.abs(bars) : 1);
  const price = pa.price + (Math.sign(pb.price - pa.price) || 1) * Math.abs(bars) * ratio;
  return { bars, ratio, price };
}

function gannSquare(c: Ctx): Shape[] {
  const a = c.p[0], xb = c.p[1].x;
  const { bars, ratio, price } = gannSquareEnd(c);
  const yb = c.Y(price);
  if (yb === null) return [];
  const out = gannGrid(a, (xb - a.x) / 5, (yb - a.y) / 5, Boolean(optOf(c.d, "background")));
  if (optOf(c.d, "showLabels")) {
    // như TV: khoảng giá ở góc điểm-2 phía điểm 1, tỉ lệ ở góc điểm 2, số nến ở góc dưới cùng phía điểm 2
    const out1 = yb < a.y ? -10 : 10;
    const lbl = { align: "center", size: 12, color: "#b2b5be" }; // TV: nhãn xám, không theo màu hình
    out.push(
      txt({ x: a.x, y: yb + out1 }, c.fp(Math.abs(price - c.d.points[0].price)), lbl),
      txt({ x: xb, y: yb + out1 }, String(+ratio.toFixed(7)), lbl),
      txt({ x: xb, y: a.y - out1 }, String(Math.abs(bars)), lbl),
    );
  }
  return out;
}

// Gann Box như TV: 7 mức theo cả giá lẫn thời gian tính từ điểm 1, mỗi mức 1 màu; tô dải ngang và
// dải dọc màu mức ngoài 20%; nhãn hệ số ở cả 4 cạnh; không có đường chéo.
const GANN_BOX: [number, string][] = [[0, "#787b86"], [0.25, "#ff9800"], [0.382, "#00bcd4"], [0.5, "#4caf50"], [0.618, "#089981"], [0.75, "#2962ff"], [1, "#787b86"]];

function gannBox(c: Ctx): Shape[] {
  const [a, b] = c.p;
  const [pa, pb] = [pt(c, 0).price, pt(c, 1).price];
  const xs = GANN_BOX.map(([t]) => a.x + (b.x - a.x) * t);
  const ys = GANN_BOX.map(([t]) => c.Y(priceAt(pa, pb, t)));
  if (ys.some((y) => y === null)) return [];
  const Y = ys as number[];
  const out: Shape[] = [];
  if (optOf(c.d, "background")) {
    for (let i = 1; i < GANN_BOX.length; i++) {
      const color = GANN_BOX[i][1];
      out.push(poly([{ x: a.x, y: Y[i - 1] }, { x: b.x, y: Y[i - 1] }, { x: b.x, y: Y[i] }, { x: a.x, y: Y[i] }], { closed: true, fill: 0.2, noStroke: true, color }));
      out.push(poly([{ x: xs[i - 1], y: a.y }, { x: xs[i], y: a.y }, { x: xs[i], y: b.y }, { x: xs[i - 1], y: b.y }], { closed: true, fill: 0.2, noStroke: true, color }));
    }
  }
  const [x0, x1, y0, y1] = [Math.min(a.x, b.x), Math.max(a.x, b.x), Math.min(a.y, b.y), Math.max(a.y, b.y)];
  GANN_BOX.forEach(([t, color], i) => {
    out.push(seg({ x: a.x, y: Y[i] }, { x: b.x, y: Y[i] }, { color }), seg({ x: xs[i], y: a.y }, { x: xs[i], y: b.y }, { color }));
    if (optOf(c.d, "showLabels")) {
      const o = { size: 11, color };
      out.push(
        txt({ x: x0 - 4, y: Y[i] }, String(t), { ...o, align: "right" }),
        txt({ x: x1 + 4, y: Y[i] }, String(t), { ...o, align: "left" }),
        txt({ x: xs[i], y: y0 - 9 }, String(t), { ...o, align: "center" }),
        txt({ x: xs[i], y: y1 + 9 }, String(t), { ...o, align: "center" }),
      );
    }
  });
  return out;
}

// Gann Fan như TV: 9 tia từ điểm 1, tia 1/1 qua điểm 2; tia dốc (1/8…1/2) đặt nhãn ở mức giá điểm 2,
// tia thoải (2/1…8/1) đặt nhãn trên đường dọc qua điểm 2; tô giữa 2 tia liền nhau 20%.
const GANN_FAN: [number, string, string][] = [
  [8, "1/8", "#ff9800"], [4, "1/4", "#089981"], [3, "1/3", "#4caf50"], [2, "1/2", "#089981"], [1, "1/1", "#00bcd4"],
  [1 / 2, "2/1", "#2962ff"], [1 / 3, "3/1", "#9c27b0"], [1 / 4, "4/1", "#e91e63"], [1 / 8, "8/1", "#f23645"],
];

function gannFan(c: Ctx): Shape[] {
  const [a, b] = c.p;
  const [pa, pb] = [pt(c, 0).price, pt(c, 1).price];
  const rays = GANN_FAN.flatMap(([r, name, color]) => {
    const y = c.Y(priceAt(pa, pb, r));
    return y === null ? [] : [{ r, name, color, e: { x: b.x, y } }];
  });
  const far = (e: Pt) => add(a, mul(unit(sub(e, a)), 20000));
  const out: Shape[] = [];
  if (optOf(c.d, "background")) {
    for (let i = 0; i + 1 < rays.length; i++) out.push(poly([a, far(rays[i].e), far(rays[i + 1].e)], { closed: true, fill: 0.2, noStroke: true, color: rays[i].color }));
  }
  for (const { r, name, color, e } of rays) {
    out.push(ray(a, e, { color }));
    if (optOf(c.d, "showLabels")) {
      const at = r > 1 ? add(a, mul(sub(e, a), 1 / r)) : e;
      out.push(txt({ x: at.x + 4, y: at.y }, name, { size: 11, color }));
    }
  }
  return out;
}

const span = (c: Ctx) => ({ t0: Math.min(pt(c, 0).time, pt(c, 1).time), t1: Math.max(pt(c, 0).time, pt(c, 1).time) });

// ---------- catalog ----------
export const TOOLS: ToolSpec[] = [
  // Lines
  // Như TV: trend line, ray, extended, info line, arrow là cùng 1 loại, chỉ khác default
  { id: "trendline", label: "Trendline", n: 2, build: lineTool, options: lineOptions("none", false), text: LINE_TEXT },
  { id: "ray", label: "Ray", n: 2, build: lineTool, options: lineOptions("right", false), text: LINE_TEXT },
  { id: "infoline", label: "Info line", n: 2, build: lineTool, options: lineOptions("none", true), text: LINE_TEXT },
  { id: "extended", label: "Extended line", n: 2, build: lineTool, options: lineOptions("both", false), text: LINE_TEXT },
  {
    id: "trendangle", label: "Trend angle", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const deg = (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      return [seg(a, b), seg(a, { x: b.x, y: a.y }, { dash: 1, w: 1 }), txt({ x: b.x + 6, y: b.y }, `${deg.toFixed(0)}°`, { bg: c.d.color, size: 11 })];
    },
  },
  {
    id: "hline", label: "Horizontal line", n: 1, axes: "price", options: [{ key: "showPrice", label: "Price label", def: true }],
    text: { kind: "line", size: 12, v: "top", h: "center" },
    build: (c) => [seg({ x: 0, y: c.p[0].y }, { x: c.w, y: c.p[0].y }), ...priceLabel(c), ...lineText(c, { x: 0, y: c.p[0].y }, { x: c.w, y: c.p[0].y })],
    handles: (c) => [{ x: c.w / 2, y: c.p[0].y }],
  },
  {
    id: "hray", label: "Horizontal ray", n: 1, options: [{ key: "showPrice", label: "Price label", def: true }],
    // TV: Text alignment default Bottom / Center
    text: { kind: "line", size: 12, v: "bottom", h: "center" },
    build: (c) => [seg(c.p[0], { x: c.w, y: c.p[0].y }), ...priceLabel(c), ...lineText(c, c.p[0], { x: c.w, y: c.p[0].y })],
  },
  {
    id: "vline", label: "Vertical line", n: 1, axes: "time",
    build: (c) => [seg({ x: c.p[0].x, y: 0 }, { x: c.p[0].x, y: c.h })],
    handles: (c) => [{ x: c.p[0].x, y: c.h / 2 }],
  },
  {
    id: "crossline", label: "Crossline", n: 1,
    build: (c) => [seg({ x: c.p[0].x, y: 0 }, { x: c.p[0].x, y: c.h }), seg({ x: 0, y: c.p[0].y }, { x: c.w, y: c.p[0].y })],
  },
  // Channels
  {
    // TV: mức 0 và 1 (2 cạnh) + 0.5 nét đứt, nền 20%
    id: "channel", label: "Parallel channel", n: 3, text: { kind: "line", size: 14, v: "top", h: "left" },
    options: [{ key: "extend", label: "Extend", def: "none", choices: EXTEND }, { key: "middleLine", label: "Middle line", def: true }, BG, BGC],
    build: (c) => {
      const [a, b, p] = c.p;
      const o = { x: 0, y: channelOffset(a, b, p) };
      const a2 = add(a, o), b2 = add(b, o);
      const line = (u: Pt, v: Pt, extra: O = {}): Shape => ({ k: "line", ...lineExt(c, [u, v]), ...extra }) as Shape;
      const out: Shape[] = [];
      if (optOf(c.d, "background")) out.push(poly([a, b, b2, a2], { closed: true, fill: 0.2, noStroke: true, color: bgOf(c) }));
      out.push(line(a, b), line(a2, b2));
      if (optOf(c.d, "middleLine")) out.push(line(lerp(a, a2, 0.5), lerp(b, b2, 0.5), { dash: 1, w: 1 }));
      out.push(...lineText(c, a, b)); // TV: chữ chạy dọc cạnh trên, căn trái
      return out;
    },
  },
  {
    // TV: ±2 độ lệch chuẩn quanh hồi quy giá đóng cửa; dải trên xanh, dải dưới đỏ, đường gốc đỏ nét đứt,
    // hệ số Pearson R dưới đầu trái
    id: "regression", label: "Regression trend", n: 2,
    options: [{ key: "showPearsons", label: "Pearson's R", def: true }, BG],
    build: (c) => {
      const { t0, t1 } = span(c);
      const bars = c.bars.filter((b) => b.t >= t0 && b.t <= t1);
      if (bars.length < 3) return [];
      const r = regression(bars.map((b) => b.c));
      const n = bars.length;
      const xa = c.X(bars[0].t), xb = c.X(bars[n - 1].t);
      if (xa === null || xb === null) return [];
      const ys = [0, 2 * r.sd, -2 * r.sd].map((off) => [c.Y(r.icp + off), c.Y(r.icp + r.slope * (n - 1) + off)]);
      if (ys.flat().some((v) => v === null)) return [];
      const [[m0, m1], [u0, u1], [l0, l1]] = ys as number[][];
      const P = (x: number, y: number) => ({ x, y });
      const out: Shape[] = [];
      if (optOf(c.d, "background")) {
        out.push(
          poly([P(xa, u0), P(xb, u1), P(xb, m1), P(xa, m0)], { closed: true, fill: 0.3, noStroke: true, color: "#2962ff" }),
          poly([P(xa, m0), P(xb, m1), P(xb, l1), P(xa, l0)], { closed: true, fill: 0.3, noStroke: true, color: "#f23645" }),
        );
      }
      out.push(
        seg(P(xa, m0), P(xb, m1), { dash: 1, w: 1, color: "rgba(242, 54, 69, 0.6)" }),
        seg(P(xa, u0), P(xb, u1), { color: "rgba(41, 98, 255, 0.6)" }),
        seg(P(xa, l0), P(xb, l1), { color: "rgba(41, 98, 255, 0.6)" }),
      );
      if (optOf(c.d, "showPearsons")) out.push(txt({ x: xa, y: Math.max(l0, u0) + 14 }, String(r.pearson), { align: "center", size: 12, color: "#2962ff" }));
      return out;
    },
  },
  {
    id: "flat", label: "Flat top/bottom", n: 3, style: { color: "#ff9800" }, options: [BG, BGC], text: { kind: "line", size: 14, v: "top", h: "left" },
    build: (c) => {
      const [a, b, p] = c.p;
      const f1 = { x: a.x, y: p.y }, f2 = { x: b.x, y: p.y };
      return [...(optOf(c.d, "background") ? [poly([a, b, f2, f1], { closed: true, fill: 0.2, noStroke: true, color: bgOf(c) })] : []), seg(a, b), seg(f1, f2), ...lineText(c, a, b)];
    },
  },
  {
    // TV: đường 2 dốc ngược đường 1, đi từ (x điểm 1, giá p3 + Δ) tới (x điểm 2, giá p3); thời gian p3
    // không dùng, handle 3 nằm ở đầu phải đường 2; tô hình nơ giữa 2 đường
    id: "disjoint", label: "Disjoint channel", n: 3, style: { color: "#089981" }, options: [BG, BGC], text: { kind: "line", size: 14, v: "top", h: "left" },
    build: (c) => {
      const [a, b, p] = c.p;
      const end = { x: b.x, y: p.y }, start = { x: a.x, y: p.y + (b.y - a.y) };
      return [...(optOf(c.d, "background") ? [poly([a, b, end, start], { closed: true, fill: 0.2, noStroke: true, color: bgOf(c) })] : []), seg(a, b), seg(start, end), ...lineText(c, a, b)];
    },
    handles: (c) => [c.p[0], c.p[1], { x: c.p[1].x, y: c.p[2].y }],
    moveHandle: (pts, i, q) => (i < 2 ? pts.map((x, j) => (j === i ? q : { ...x })) : [{ ...pts[0] }, { ...pts[1] }, { time: pts[1].time, price: q.price }]),
  },
  // Pitchforks
  ...([["pitchfork", "Pitchfork", "standard"], ["schiff", "Schiff pitchfork", "schiff"], ["mschiff", "Modified Schiff pitchfork", "modified"], ["insidefork", "Inside pitchfork", "inside"]] as [string, string, ForkKind][])
    .map(([id, label, kind]): ToolSpec => ({
      id, label, n: 3, style: { color: "#f23645" }, build: (c) => fork(c, kind),
      options: [{ key: "background", label: "Background", def: true }],
    })),

  // Fib
  {
    id: "fib", label: "Fib retracement", n: 2, build: fibRetracement, style: { width: 1 }, levels: FIB_LEVELS,
    options: [FIB_OPTIONS[0], { key: "reverse", label: "Reverse", def: false }, ...FIB_OPTIONS.slice(1)],
  },
  {
    // mức = p3 + (p2 − p1) × hệ số
    id: "fibext", label: "Trend-based fib extension", n: 3, style: { width: 1 }, levels: FIB_LEVELS, options: FIB_OPTIONS,
    build: (c) => {
      const [a, b, p] = c.p;
      const [pa, pb, pc] = c.d.points;
      const x0 = Math.min(a.x, b.x, p.x), x1 = Math.max(a.x, b.x, p.x);
      const lg = logFib(c, pa.price, pb.price, pc.price);
      const priceOf = (k: number) => (lg ? pc.price * (pb.price / pa.price) ** k : pc.price + (pb.price - pa.price) * k);
      return [...priceLevels(c, priceOf, x0, x1), seg(a, b, TREND), seg(b, p, TREND)];
    },
  },
  {
    // TV: các đoạn song song p1–p2 (không kéo dài), lệch về phía p3 theo hệ số; nhãn "hệ số (giá)" ở đầu trái
    id: "fibchannel", label: "Fib channel", n: 3, style: { width: 1 }, levels: FIB_LEVELS, options: [FIB_OPTIONS[1], FIB_OPTIONS[2], BG],
    build: (c) => {
      const [a, b, p] = c.p;
      const [pa, pb] = [pt(c, 0).price, pt(c, 1).price];
      const frac = b.x === a.x ? 0 : (p.x - a.x) / (b.x - a.x);
      const off = pt(c, 2).price - (pa + (pb - pa) * frac); // lệch giá của p3 so với đường p1–p2
      const out: Shape[] = [], fills: Shape[] = [];
      let prev: [Pt, Pt] | null = null;
      for (const lvl of fibLevelsOf(c.d).filter((l) => l.on).sort((x, y) => x.coeff - y.coeff)) {
        const ya = c.Y(pa + off * lvl.coeff), yb = c.Y(pb + off * lvl.coeff);
        if (ya === null || yb === null) continue;
        const u = { x: a.x, y: ya }, v = { x: b.x, y: yb };
        if (prev && optOf(c.d, "background")) fills.push(poly([prev[0], prev[1], v, u], { closed: true, fill: 0.2, noStroke: true, color: lvl.color }));
        out.push(seg(u, v, { color: lvl.color }));
        const text = [optOf(c.d, "showCoeffs") ? String(lvl.coeff) : "", optOf(c.d, "showPrices") ? `(${c.fp(pa + off * lvl.coeff)})` : ""].filter(Boolean).join(" ");
        if (text) out.push(txt({ x: Math.min(u.x, v.x) - 4, y: a.x <= b.x ? u.y : v.y }, text, { size: 11, color: lvl.color, align: "right" }));
        prev = [u, v];
      }
      return [...fills, ...out];
    },
  },
  {
    // TV: mốc p1 + n × (p2 − p1) theo thời gian, n = 0, 1, 2, 3, 5, 8 … 89; không tô; nhãn ở đáy
    id: "fibtimezone", label: "Fib time zone", n: 2, style: { width: 1 }, levels: FIB_TIMEZONE_LEVELS,
    options: [{ key: "showCoeffs", label: "Labels", def: true }],
    build: (c) => {
      const [a, b] = c.p;
      return [...timeLevels(c, (k) => a.x + (b.x - a.x) * k, false), seg(a, b, TREND)];
    },
  },
  {
    // TV: hộp từ điểm 1 tới điểm 2 có lưới; mức tính từ điểm 2: tia từ điểm 1 tới mép phải (theo giá)
    // và mép trên (theo thời gian); tô giữa các tia; nhãn hệ số 4 cạnh
    id: "fibfan", label: "Fib speed resistance fan", n: 2, style: { width: 1 }, levels: FIB_FAN_LEVELS,
    options: [{ key: "showLabels", label: "Labels", def: true }, { key: "grid", label: "Grid", def: true }, BG],
    build: fibSpeedFan,
  },
  {
    // TV: đường dọc tại p3 + hệ số × (p2 − p1) theo thời gian, tô dải, nhãn ở đáy
    id: "fibtimeext", label: "Trend-based fib time", n: 3, style: { width: 1 }, levels: FIB_TIME_LEVELS,
    options: [{ key: "showCoeffs", label: "Labels", def: true }, BG],
    build: (c) => {
      const [a, b, p] = c.p;
      return [...timeLevels(c, (k) => p.x + (b.x - a.x) * k, true), seg(a, b, TREND), seg(b, p, TREND)];
    },
  },
  {
    // TV: elip tâm trung điểm 2 điểm, bán trục = hệ số × |Δx|/2 và × |Δy|/2 (mức 1 nội tiếp hộp 2 điểm)
    id: "fibcircles", label: "Fib circles", n: 2, style: { width: 1 }, levels: FIB_ARC_LEVELS,
    options: [{ key: "showCoeffs", label: "Levels", def: true }, BG],
    build: (c) => {
      const [a, b] = c.p;
      const m = mid(a, b), rx = Math.abs(b.x - a.x) / 2, ry = Math.abs(b.y - a.y) / 2;
      const ring = (k: number) => circle({ x: 0, y: 0 }, 1, 96).map((q) => ({ x: m.x + q.x * rx * k, y: m.y + q.y * ry * k }));
      return [...rings(c, ring, (k) => ({ x: m.x, y: m.y + ry * k }), true), seg(a, b, TREND)];
    },
  },
  {
    // TV mặc định màu #00bcd4, chiều kim đồng hồ
    id: "fibspiral", label: "Fib spiral", n: 2, style: { color: "#00bcd4" },
    build: (c) => {
      const [a, b] = c.p;
      const R = dist(a, b), t0 = Math.atan2(b.y - a.y, b.x - a.x), k = Math.log(1.618) / (Math.PI / 2);
      const pts = Array.from({ length: 400 }, (_, i) => {
        const th = t0 - (8 * Math.PI * (399 - i)) / 399;
        const r = R * Math.exp(k * (th - t0));
        return { x: a.x + r * Math.cos(th), y: a.y + r * Math.sin(th) };
      });
      return [seg(a, b, TREND), poly(pts)];
    },
  },
  {
    // TV: nửa đường tròn tâm điểm 1, bán kính = hệ số × khoảng cách tới điểm 2, ở phía điểm 2
    id: "fibarcs", label: "Fib speed resistance arcs", n: 2, style: { width: 1 }, levels: FIB_ARC_LEVELS,
    options: [{ key: "showCoeffs", label: "Levels", def: true }, BG],
    build: (c) => {
      const [a, b] = c.p;
      const R = dist(a, b), up = b.y <= a.y ? -1 : 1;
      const ring = (k: number) => arcPts(a, R * k, up < 0 ? Math.PI : 0, up < 0 ? Math.PI * 2 : Math.PI, 64);
      return [...rings(c, ring, (k) => ({ x: a.x, y: a.y + up * R * k - up * 8 }), false), seg(a, b, TREND)];
    },
  },
  {
    // TV: cung tâm điểm 1 giữa 2 cạnh, bán kính = hệ số × |điểm 1 → điểm 2|, mức tới 1, tô giữa các cung
    id: "fibwedge", label: "Fib wedge", n: 3, style: { width: 1 }, levels: FIB_WEDGE_LEVELS,
    options: [{ key: "showCoeffs", label: "Levels", def: true }, BG],
    build: (c) => {
      const [a, b, p] = c.p;
      const R = dist(a, b), a0 = Math.atan2(b.y - a.y, b.x - a.x), a1 = shortSweep(a0, Math.atan2(p.y - a.y, p.x - a.x));
      const am = (a0 + a1) / 2;
      const ring = (k: number) => [a, ...arcPts(a, R * k, a0, a1)];
      const label = (k: number) => ({ x: a.x + R * k * Math.cos(am) + 10, y: a.y + R * k * Math.sin(am) });
      return [...rings(c, ring, label, true), seg(a, b, { color: "#787b86" }), seg(a, p, { color: "#787b86" })];
    },
  },
  {
    // TV: tia từ p0 qua trung điểm p1–p2 (median, màu đường) và qua các mức 0.5 / 1 trên đoạn p1–p2
    id: "pitchfan", label: "Pitchfan", n: 3, style: { color: "#f23645" }, options: [BG],
    build: (c) => {
      const [p0, p1, p2] = c.p;
      const m = mid(p1, p2), half = sub(p1, m);
      const far = (q: Pt) => add(p0, mul(unit(sub(q, p0)), 20000));
      const fills: Shape[] = [], lines: Shape[] = [];
      let prev = 0;
      for (const [k, color] of [[0.5, "#00bcd4"], [1, "#2962ff"]] as [number, string][]) {
        for (const side of [1, -1]) {
          const q0 = add(m, mul(half, prev * side)), q1 = add(m, mul(half, k * side));
          if (optOf(c.d, "background")) fills.push(poly([p0, far(q0), far(q1)], { closed: true, fill: 0.2, noStroke: true, color }));
          lines.push(ray(p0, q1, { color }));
        }
        prev = k;
      }
      return [...fills, ...lines, ray(p0, m), seg(p1, p2)];
    },
  },
  // Gann
  {
    id: "gannbox", label: "Gann box", n: 2, style: { width: 1 }, build: gannBox,
    options: [{ key: "showLabels", label: "Labels", def: true }, { key: "background", label: "Background", def: true }],
    handles: (c) => rectHandles(c).slice(0, 4), // TV: 4 handle góc
    moveHandle: moveRectHandle,
  },
  {
    // Như TV: lưới vuông trên màn hình, 1 ô = khoảng cách pixel giữa 2 điểm, 5×5 ô về phía điểm 2
    id: "gannsqfixed", label: "Gann square fixed", n: 2, style: { width: 1 },
    options: [{ key: "background", label: "Background", def: true }],
    build: (c) => {
      const [a, b] = c.p;
      const u = dist(a, b) || 1;
      return gannGrid(a, (Math.sign(b.x - a.x) || 1) * u, (Math.sign(b.y - a.y) || -1) * u, Boolean(optOf(c.d, "background")));
    },
  },
  {
    id: "gannsquare", label: "Gann square", n: 2, style: { width: 1 }, build: gannSquare,
    options: [{ key: "showLabels", label: "Labels", def: true }, { key: "background", label: "Background", def: true }],
    // handle điểm 2 nằm ở góc thật của hộp (giá suy từ tỉ lệ), không phải giá đã lưu
    handles: (c) => {
      const y = c.Y(gannSquareEnd(c).price);
      return [c.p[0], { x: c.p[1].x, y: y ?? c.p[1].y }];
    },
    moveHandle: (pts, i, q) => (i === 0 ? [q, { ...pts[1] }] : [{ ...pts[0] }, q]),
    // chốt tỉ lệ giá/nến để hộp vuông trên màn hình lúc vẽ xong
    init: (d, c) => {
      const [pa, pb] = d.points;
      const bars = Math.abs(c.barsBetween(pa.time, pb.time));
      const y0 = c.Y(pa.price), y1 = c.Y(pa.price + 1);
      const x0 = c.X(pa.time), x1 = c.X(pb.time);
      if (!bars || y0 === null || y1 === null || x0 === null || x1 === null || y0 === y1) return d;
      const ratio = (Math.abs(x1 - x0) / bars) / Math.abs(y1 - y0);
      const price = pa.price + (Math.sign(pb.price - pa.price) || 1) * bars * ratio;
      return { ...d, points: [pa, { ...pb, price }], opts: { ...d.opts, scaleRatio: ratio } };
    },
  },
  {
    id: "gannfan", label: "Gann fan", n: 2, style: { width: 1 }, build: gannFan,
    options: [{ key: "showLabels", label: "Labels", def: true }, { key: "background", label: "Background", def: true }],
  },

  // Patterns
  // Màu mặc định theo TV
  { id: "xabcd", label: "XABCD pattern", n: 5, options: [BGC], build: (c) => harmonic(c, false) },
  { id: "cypher", label: "Cypher pattern", n: 5, options: [BGC], build: (c) => harmonic(c, true) },
  { id: "headshoulders", label: "Head and shoulders", n: 7, style: { color: "#089981" }, options: [BGC], build: headShoulders },
  {
    id: "abcd", label: "ABCD pattern", n: 4, style: { color: "#089981" },
    build: (c) => {
      const [A, B, C, D] = c.d.points.map((q) => q.price);
      return pattern(c, ["A", "B", "C", "D"], [[0, 2, ratioOf(C - B, B - A)], [1, 3, ratioOf(D - C, C - B)]]);
    },
  },
  { id: "trianglepattern", label: "Triangle pattern", n: 4, style: { color: "#673ab7" }, options: [BGC], build: trianglePattern },
  {
    // TV: không có chữ, 2 đường chấm nối đỉnh drive kèm tỉ lệ mở rộng
    id: "threedrives", label: "Three drives pattern", n: 7, style: { color: "#673ab7" },
    build: (c) => {
      const q = c.d.points.map((x) => x.price);
      return pattern(c, [], [[1, 3, ratioOf(q[3] - q[2], q[1] - q[2], 2)], [3, 5, ratioOf(q[5] - q[4], q[3] - q[4], 2)]]);
    },
  },
  { id: "elliottimpulse", label: "Elliott impulse wave (1·2·3·4·5)", n: 6, style: { color: "#3d85c6" }, build: elliott(["1", "2", "3", "4", "5"]) },
  { id: "elliottcorrection", label: "Elliott correction wave (A·B·C)", n: 4, style: { color: "#3d85c6" }, build: elliott(["A", "B", "C"]) },
  { id: "elliotttriangle", label: "Elliott triangle wave (A·B·C·D·E)", n: 6, style: { color: "#ff9800" }, build: elliott(["A", "B", "C", "D", "E"]) },
  { id: "elliottdouble", label: "Elliott double combo wave (W·X·Y)", n: 4, style: { color: "#6aa84f" }, build: elliott(["W", "X", "Y"]) },
  { id: "elliotttriple", label: "Elliott triple combo wave (W·X·Y·X·Z)", n: 6, style: { color: "#6aa84f" }, build: elliott(["W", "X", "Y", "X", "Z"]) },
  // Cycles
  {
    // TV: chỉ lặp về bên phải điểm 1; đoạn chấm điểm 1 → điểm 2
    id: "cyclic", label: "Cyclic lines", n: 2, style: { color: "#80ccdb" },
    build: (c) => {
      const [a, b] = c.p;
      const dx = Math.abs(b.x - a.x) || 1;
      const out: Shape[] = [seg(a, { x: b.x, y: a.y }, { dash: 1, w: 1, color: "#787b86" })];
      for (let k = Math.max(0, Math.floor(-a.x / dx)); k <= Math.ceil((c.w - a.x) / dx) && out.length < 400; k++) {
        const x = a.x + k * dx;
        out.push(seg({ x, y: 0 }, { x, y: c.h }));
      }
      return out;
    },
  },
  {
    // TV: nửa đường tròn thật (đường kính = khoảng 2 điểm) lặp 2 phía, nền xanh lá 50%
    id: "timecycles", label: "Time cycles", n: 2, style: { color: "#159980" }, options: [BG, { ...BGC, def: "#6aa84f" }],
    build: (c) => {
      const [a, b] = c.p;
      const dx = Math.abs(b.x - a.x) || 1;
      const out: Shape[] = [];
      for (let k = Math.floor(-a.x / dx); k <= Math.ceil((c.w - a.x) / dx) && out.length < 400; k++) {
        const arc = arcPts({ x: a.x + (k + 0.5) * dx, y: a.y }, dx / 2, Math.PI, Math.PI * 2);
        if (optOf(c.d, "background")) out.push(poly(arc, { closed: true, fill: 0.5, noStroke: true, color: bgOf(c) }));
        out.push(poly(arc));
      }
      return out;
    },
  },
  {
    // TV: đỉnh/đáy tại 2 điểm, nửa chu kỳ = khoảng 2 điểm
    id: "sine", label: "Sine line", n: 2, style: { color: "#159980" },
    build: (c) => {
      const [a, b] = c.p;
      const dx = b.x - a.x || 1, m = (a.y + b.y) / 2;
      const pts: Pt[] = [];
      for (let x = 0; x <= c.w; x += 3) pts.push({ x, y: m + (a.y - m) * Math.cos((Math.PI * (x - a.x)) / dx) });
      return [poly(pts)];
    },
  },

  // Forecasting
  { id: "longpos", label: "Long position", n: 4, panel: "position", options: POS_OPTIONS, constrain: posConstrain(1), oneClick: (a, v) => posAt(a, v, 1), build: position },
  { id: "shortpos", label: "Short position", n: 4, panel: "position", options: POS_OPTIONS, constrain: posConstrain(-1), oneClick: (a, v) => posAt(a, v, -1), build: position },
  { id: "forecast", label: "Position forecast", n: 2, build: () => [], disabled: true },
  { id: "barspattern", label: "Bars pattern", n: 2, build: () => [], disabled: true },
  { id: "ghost", label: "Ghost feed", n: 2, build: () => [], disabled: true },
  {
    id: "sector", label: "Sector", n: 3, options: [BG, BGC],
    build: (c) => {
      const [a, b, p] = c.p;
      const R = dist(a, b), a0 = Math.atan2(b.y - a.y, b.x - a.x), a1 = shortSweep(a0, Math.atan2(p.y - a.y, p.x - a.x));
      return filledShape(c, [a, ...arcPts(a, R, a0, a1)], 0.15);
    },
  },
  // Volume
  {
    id: "avwap", label: "Anchored VWAP", n: 1, axes: "time",
    build: (c) => {
      const t0 = pt(c, 0).time;
      let pv = 0, vv = 0;
      const pts: Pt[] = [];
      for (const b of c.bars) {
        if (b.t < t0) continue;
        const v = b.v || 1;
        pv += ((b.h + b.l + b.c) / 3) * v;
        vv += v;
        const x = c.X(b.t), y = c.Y(pv / vv);
        if (x !== null && y !== null) pts.push({ x, y });
      }
      return [poly(pts)];
    },
  },
  {
    id: "frvp", label: "Fixed range volume profile", n: 2, panel: "volume", axes: "time", inBars: true,
    build: (c) => volumeProfile(c, span(c).t0, span(c).t1),
    handles: profileHandles,
    // chỉ có thời gian (như tab Coordinates của TV: #1 (bar), #2 (bar)): kéo handle chỉ đổi nến, giá giữ nguyên
    moveHandle: (pts, handle, a) => pts.map((q, i) => (i === handle ? { time: a.time, price: q.price } : q)),
  },
  { id: "avp", label: "Anchored volume profile", n: 1, panel: "volume", axes: "time", build: (c) => volumeProfile(c, pt(c, 0).time, c.bars[c.bars.length - 1]?.t ?? pt(c, 0).time, true) },
  // Measurers
  {
    // TV: nhãn không nền "0.60%, 2,500.0" (khoảng giá ẩn mặc định)
    id: "pricerange", label: "Price range", n: 2, text: { kind: "box", size: 12, v: "middle", h: "center", fixed: true, noText: true, color: "#ffffff" },
    options: [
      { key: "showPriceRange", label: "Price range", def: false },
      { key: "showPercent", label: "Percent change", def: true },
      { key: "showPips", label: "Change in pips", def: true },
      BGC,
    ],
    build: (c) => {
      const t = rangeText(c);
      const label = [optOf(c.d, "showPriceRange") && t.change, optOf(c.d, "showPercent") && t.pct, optOf(c.d, "showPips") && t.pip].filter(Boolean).join(", ");
      return rangeBox(c, { vArrow: true, hArrow: false, hEdges: true, vEdges: false, lines: [label] });
    },
  },
  {
    // TV: nhãn ô tối "20 bars, 5h" / "Vol 138.84K"
    id: "daterange", label: "Date range", n: 2, text: { kind: "box", size: 12, v: "middle", h: "center", fixed: true, noText: true, color: "#ffffff" },
    options: [{ key: "showVolume", label: "Volume", def: true }, BGC],
    build: (c) => {
      const t = rangeText(c);
      return rangeBox(c, { vArrow: false, hArrow: true, hEdges: false, vEdges: true, lines: [t.time, optOf(c.d, "showVolume") ? t.vol : ""], box: "#2e2e2e" });
    },
  },
  { id: "daterangeprice", label: "Date and price range", n: 2, options: [BGC], text: { kind: "box", size: 12, v: "middle", h: "center", fixed: true, noText: true, color: "#ffffff" }, build: (c) => measure(c) },
  { id: "measure", label: "Measure", n: 2, build: (c) => measure(c, true), ephemeral: true },
  { id: "zoom", label: "Zoom in", n: 2, action: "zoom", build: (c) => [poly([c.p[0], { x: c.p[1].x, y: c.p[0].y }, c.p[1], { x: c.p[0].x, y: c.p[1].y }], { closed: true, fill: 0.1, dash: 1, w: 1 })] },

  // Brushes
  { id: "brush", label: "Brush", n: -1, build: (c) => [poly(c.p)] },
  { id: "highlighter", label: "Highlighter", n: -1, style: { color: "#f5c542", width: 3 }, build: (c) => [poly(c.p, { w: c.d.width * 6, alpha: 0.35 })] },
  // Arrows
  {
    // TV: chữ đậm cỡ 16 nằm sau đuôi mũi tên (ngược chiều mũi), cùng màu mũi tên
    id: "arrowmarker", label: "Arrow marker", n: 2, style: { color: "#1e53e5" }, text: { kind: "box", size: 16, v: "middle", h: "left", fixed: true, bold: true },
    build: (c) => {
      const [a, b] = c.p;
      const u = unit(sub(b, a)), n = { x: -u.y, y: u.x };
      const L = Math.min(26, dist(a, b) * 0.4), hb = sub(b, mul(u, L));
      const out: Shape[] = [poly([a, add(hb, mul(n, 3)), add(hb, mul(n, 9)), b, sub(hb, mul(n, 9)), sub(hb, mul(n, 3))], { closed: true, fill: 1 })];
      if (c.d.text) {
        const st = textStyle(c);
        const right = b.x >= a.x; // mũi tên hướng sang phải: chữ nằm bên trái đuôi
        out.push(txt({ x: a.x + (right ? -8 : 8), y: a.y }, c.d.text, { ...st, align: right ? "right" : "left" }));
      }
      return out;
    },
  },
  { id: "arrow", label: "Arrow", n: 2, build: lineTool, options: lineOptions("none", false, "arrow"), text: LINE_TEXT },
  {
    id: "arrowup", label: "Arrow mark up", n: 1, style: { color: "#089981" }, text: { kind: "box", size: 14, v: "middle", h: "center", fixed: true },
    build: (c) => {
      const { x, y } = c.p[0], s = 8 + c.d.width * 3;
      const label = c.d.text ? [txt({ x, y: y + s * 2.2 + 4 + (c.d.text.split("\n").length * textStyle(c).size * 1.3) / 2 }, c.d.text, { ...textStyle(c), align: "center" })] : [];
      return [...label, poly([{ x, y }, { x: x - s, y: y + s }, { x: x - s / 2, y: y + s }, { x: x - s / 2, y: y + s * 2.2 }, { x: x + s / 2, y: y + s * 2.2 }, { x: x + s / 2, y: y + s }, { x: x + s, y: y + s }], { closed: true, fill: 1 })];
    },
  },
  {
    id: "arrowdown", label: "Arrow mark down", n: 1, style: { color: "#cc2f3c" }, text: { kind: "box", size: 14, v: "middle", h: "center", fixed: true },
    build: (c) => {
      const { x, y } = c.p[0], s = 8 + c.d.width * 3;
      const label = c.d.text ? [txt({ x, y: y - s * 2.2 - 4 - (c.d.text.split("\n").length * textStyle(c).size * 1.3) / 2 }, c.d.text, { ...textStyle(c), align: "center" })] : [];
      return [...label, poly([{ x, y }, { x: x - s, y: y - s }, { x: x - s / 2, y: y - s }, { x: x - s / 2, y: y - s * 2.2 }, { x: x + s / 2, y: y - s * 2.2 }, { x: x + s / 2, y: y - s }, { x: x + s, y: y - s }], { closed: true, fill: 1 })];
    },
  },
  // Shapes
  {
    id: "rect", label: "Rectangle", n: 2, shift: "square", build: rectangle,
    options: [
      { key: "extend", label: "Extend", def: "none", choices: EXTEND },
      { key: "middleLine", label: "Middle line", def: false },
      { key: "background", label: "Background", def: true },
      { key: "backgroundColor", label: "Background color", def: "", color: true },
    ],
    text: { kind: "box", size: 14, v: "middle", h: "center" },
    handles: rectHandles,
    moveHandle: moveRectHandle,
  },
  {
    id: "rotrect", label: "Rotated rectangle", n: 3, style: { color: "#4caf50" }, options: [BG, BGC],
    build: (c) => {
      const [a, b, p] = c.p;
      const u = unit(sub(b, a)), n = { x: -u.y, y: u.x };
      const off = mul(n, (p.x - a.x) * n.x + (p.y - a.y) * n.y);
      return filledShape(c, [a, b, add(b, off), add(a, off)], 0.2);
    },
  },
  { id: "path", label: "Path", n: 0, build: (c) => (c.p.length > 1 ? [poly(c.p), head(c.p[c.p.length - 2], c.p[c.p.length - 1], 10 + c.d.width * 2)] : []) },
  {
    id: "circle", label: "Circle", n: 2, style: { color: "#ff9800" }, options: [BG, BGC], text: { kind: "box", size: 14, v: "middle", h: "center", fixed: true },
    build: (c) => [...filledShape(c, circle(c.p[0], dist(c.p[0], c.p[1])), 0.2), ...centerText(c, c.p[0])],
  },
  {
    id: "ellipse", label: "Ellipse", n: 2, shift: "square", options: [BG, BGC], text: { kind: "box", size: 14, v: "middle", h: "center", fixed: true },
    build: (c) => {
      const m = mid(c.p[0], c.p[1]), rx = Math.abs(c.p[1].x - c.p[0].x) / 2, ry = Math.abs(c.p[1].y - c.p[0].y) / 2;
      return [...filledShape(c, circle(m, 1).map((q) => ({ x: m.x + (q.x - m.x) * rx, y: m.y + (q.y - m.y) * ry })), 0.15), ...centerText(c, m)];
    },
  },
  // màu mặc định theo TV
  { id: "polyline", label: "Polyline", n: 0, style: { color: "#00bcd4" }, options: [BG, BGC], build: (c) => filledShape(c, c.p, 0.2, true) },
  { id: "triangle", label: "Triangle", n: 3, style: { color: "#089981" }, options: [BG, BGC], build: (c) => filledShape(c, c.p.slice(0, 3), 0.2) },
  {
    // TV: nửa elip, đáy là đoạn p1–p2, cao tới p3 (khoảng cách vuông góc từ p3 tới p1–p2); nền 20%
    id: "arc", label: "Arc", n: 3, style: { color: "#e91e63" }, options: [BG, BGC],
    build: (c) => {
      const [a, b, p] = c.p;
      const m = mid(a, b), u = unit(sub(b, a)), n = { x: -u.y, y: u.x };
      const rx = dist(a, b) / 2, h = (p.x - a.x) * n.x + (p.y - a.y) * n.y;
      const pts = Array.from({ length: 65 }, (_, i) => {
        const th = Math.PI - (Math.PI * i) / 64;
        return add(m, add(mul(u, rx * Math.cos(th)), mul(n, h * Math.sin(th))));
      });
      return [...(optOf(c.d, "background") === false ? [] : [poly(pts, { closed: true, fill: 0.2, noStroke: true, color: bgOf(c) })]), poly(pts)];
    },
  },
  { id: "curve", label: "Curve", n: 2, build: (c) => [poly(bezier(c.p[0], { x: c.p[1].x, y: c.p[0].y }, { x: c.p[1].x, y: c.p[0].y }, c.p[1]))] },
  {
    id: "doublecurve", label: "Double curve", n: 2, style: { color: "#673ab7" },
    build: (c) => {
      const [a, b] = c.p;
      const m = (a.x + b.x) / 2;
      return [poly(bezier(a, { x: m, y: a.y }, { x: m, y: b.y }, b))];
    },
  },

  // Text & notes
  // TV: chữ xanh cỡ 14 (width 1 → 14)
  {
    // TV: chữ màu đường cỡ 14, tab Text có Background / Border / Text wrap (tắt sẵn)
    id: "text", label: "Text", n: 1, prompt: "Text", anchorable: true, style: { width: 1 },
    text: { kind: "box", size: 14, v: "middle", h: "left", fixed: true, bg: { def: false, color: "#2962ff40" }, border: { def: false, color: "#707070" }, wrap: true },
    build: (c) => {
      const st = textStyle(c);
      return [txt(c.p[0], wrapIf(c, c.d.text ?? "Text", st), { ...st, ...boxFx(c) })];
    },
  },
  {
    id: "note", label: "Note", n: 2, prompt: "Note", options: [BGC], text: { kind: "box", size: 14, v: "middle", h: "left", fixed: true, color: "#ffffff" },
    oneClick: (a, v) => [a, offsetPt(a, v, 8, 0.002)], build: (c) => noteShapes(c, c.d.text ?? "Note", textStyle(c)),
  },
  {
    // TV: đường từ điểm 1 tới ô giá ở điểm 2; chữ (tab Text) chạy dọc theo đường
    id: "pricenote", label: "Price note", n: 2, options: [BGC], oneClick: (a, v) => [a, offsetPt(a, v, 8, 0.002)],
    text: { kind: "line", size: 14, v: "top", h: "center" },
    build: (c) => [...noteShapes(c, c.fp(c.d.points[0].price)), ...lineText(c, c.p[0], c.p[1])],
  },
  {
    // TV ("note"): chỉ là ghim màu đường; chữ hiện trong ô tối khi hover / chọn
    id: "pin", label: "Pin", n: 1, prompt: "Pin text", anchorable: true,
    text: { kind: "box", size: 14, v: "middle", h: "center", fixed: true, color: "#dbdbdb", bg: { def: true, color: "#2e2e2e" }, border: { def: true, color: "#4a4a4a" } },
    build: (c) => {
      const { x, y } = c.p[0];
      const out: Shape[] = [poly([{ x, y }, { x: x - 7, y: y - 14 }, { x: x + 7, y: y - 14 }], { closed: true, fill: 1 }), poly(circle({ x, y: y - 19 }, 9, 24), { closed: true, fill: 1 })];
      if (c.d.text && (c.hovered || c.selected)) out.push(txt({ x, y: y - 46 }, c.d.text, { ...textStyle(c), align: "center", ...boxFx(c) }));
      return out;
    },
  },
  {
    id: "table", label: "Table", n: 1, grid: true, anchorable: true, colorLabel: "Border", style: { color: "#575757", width: 1, textColor: "#dbdbdb" }, build: table,
    options: [
      { key: "bgColor", label: "Background", def: "#0f0f0f", color: true },
      { key: "fontSize", label: "Text size", def: "14", choices: ["10", "11", "12", "14", "16", "20", "24", "28", "32", "40"].map((v): [string, string] => [v, v]) },
      { key: "hAlign", label: "Text alignment", def: "left", choices: [["left", "Left"], ["center", "Center"], ["right", "Right"]] },
    ],
  },
  {
    // TV: ô màu (teal) chữ trắng ở điểm 2, đuôi nhọn chỉ về điểm 1
    id: "callout", label: "Callout", n: 2, prompt: "Callout", style: { color: "#0097a7" },
    text: { kind: "box", size: 14, v: "middle", h: "left", fixed: true, color: "#ffffff", bg: "main", border: { def: true, color: "", always: true }, wrap: true }, oneClick: (a, v) => [a, offsetPt(a, v, 8, 0.002)],
    build: (c) => {
      const [a, b] = c.p;
      const st = textStyle(c);
      const label = { k: "text", at: b, text: wrapIf(c, c.d.text ?? "Callout", st), ...st, align: "left", bg: c.d.color, border: String(optOf(c.d, "borderColor") || "") || undefined } as Extract<Shape, { k: "text" }>;
      const box = textBox(label);
      const ctr = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
      const n = mul({ x: -unit(sub(a, ctr)).y, y: unit(sub(a, ctr)).x }, Math.min(10, box.h / 2 - 2));
      return [poly([add(ctr, n), a, sub(ctr, n)], { closed: true, fill: 1 }), label];
    },
  },
  {
    // TV: bong bóng bo tròn chữ trắng cỡ 16, góc dưới-trái nhọn chỉ vào điểm
    id: "comment", label: "Comment", n: 1, prompt: "Comment",
    text: { kind: "box", size: 16, v: "middle", h: "left", fixed: true, color: "#ffffff", noStyle: true, bg: "main", border: { def: true, color: "", always: true } },
    build: (c) => {
      const { x, y } = c.p[0];
      return [poly([{ x, y }, { x: x + 4, y: y - 14 }, { x: x + 20, y: y - 14 }], { closed: true, fill: 1 }), txt({ x: x + 6, y: y - 28 }, c.d.text ?? "Comment", { ...textStyle(c), align: "left", bg: c.d.color, border: String(optOf(c.d, "borderColor") || "") || undefined, radius: 16 })];
    },
  },
  {
    // TV: ô màu đường, giá chữ trắng đậm cỡ 14 ở phía trên-phải, góc dưới-trái nhọn chạm điểm
    id: "pricelabel", label: "Price label", n: 1,
    build: (c) => {
      const { x, y } = c.p[0];
      return [
        poly([{ x, y }, { x: x + 5, y: y - 14 }, { x: x + 15, y: y - 14 }], { closed: true, fill: 1 }),
        txt({ x: x + 11, y: y - 24 }, c.fp(c.d.points[0].price), { align: "left", bg: c.d.color, color: c.d.textColor ?? "#ffffff", bold: true, size: fontSizeOf(c.d) }),
      ];
    },
  },
  {
    // TV: ô tối viền xám chữ sáng, cột xám từ ô xuống điểm neo
    id: "signpost", label: "Signpost", n: 1, prompt: "Signpost",
    text: { kind: "box", size: 12, v: "middle", h: "center", fixed: true, color: "#dbdbdb", noColor: true },
    build: (c) => {
      const { x, y } = c.p[0];
      return [seg({ x, y }, { x, y: y - 40 }, { w: 1, color: "#787b86" }), txt({ x, y: y - 52 }, c.d.text ?? "Signpost", { ...textStyle(c), align: "center", bg: "#2e2e2e", border: "#4a4a4a" })];
    },
  },
  {
    // TV: lá cờ nhỏ màu đường trên cán xám ngắn
    id: "flag", label: "Flag mark", n: 1,
    build: (c) => {
      const { x, y } = c.p[0];
      return [
        seg({ x, y }, { x, y: y - 18 }, { w: 1.5, color: "#b2b5be" }),
        poly([{ x, y: y - 18 }, { x: x + 12, y: y - 18 }, { x: x + 9, y: y - 14.5 }, { x: x + 12, y: y - 11 }, { x, y: y - 11 }], { closed: true, fill: 1 }),
      ];
    },
  },
  { id: "image", label: "Image", n: 1, build: () => [], disabled: true },
  { id: "post", label: "Post", n: 1, build: () => [], disabled: true },
  { id: "idea", label: "Idea", n: 1, build: () => [], disabled: true },
  // Emoji
  { id: "emoji", label: "Emoji", n: 1, build: (c) => [txt(c.p[0], c.d.text ?? "😀", { align: "center", size: 28 + c.d.width * 4 })], style: { width: 1 } },
];

export const SPEC = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<string, ToolSpec>;

// Màu của hình mới khi tool không có màu riêng (style.color): xám trung tính, không mặc định xanh
export const DEFAULT_COLOR = "#787b86";

export type Section = { title?: string; ids: string[] };
export type Group = { id: string; label: string; icon: string; sections: Section[] };

export const GROUPS: Group[] = [
  {
    id: "lines", label: "Trend tools", icon: "trendline",
    sections: [
      { title: "LINES", ids: ["trendline", "ray", "infoline", "extended", "trendangle", "hline", "hray", "vline", "crossline"] },
      { title: "CHANNELS", ids: ["channel", "regression", "flat", "disjoint"] },
      { title: "PITCHFORKS", ids: ["pitchfork", "schiff", "mschiff", "insidefork"] },
    ],
  },
  {
    id: "fib", label: "Gann and Fibonacci tools", icon: "fib",
    sections: [
      { title: "FIBONACCI", ids: ["fib", "fibext", "fibchannel", "fibtimezone", "fibfan", "fibtimeext", "fibcircles", "fibspiral", "fibarcs", "fibwedge", "pitchfan"] },
      { title: "GANN", ids: ["gannbox", "gannsqfixed", "gannsquare", "gannfan"] },
    ],
  },
  {
    id: "patterns", label: "Patterns", icon: "xabcd",
    sections: [
      { title: "CHART PATTERNS", ids: ["xabcd", "cypher", "headshoulders", "abcd", "trianglepattern", "threedrives"] },
      { title: "ELLIOTT WAVES", ids: ["elliottimpulse", "elliottcorrection", "elliotttriangle", "elliottdouble", "elliotttriple"] },
      { title: "CYCLES", ids: ["cyclic", "timecycles", "sine"] },
    ],
  },
  {
    id: "forecast", label: "Forecasting and measurement tools", icon: "longpos",
    sections: [
      { title: "FORECASTING", ids: ["longpos", "shortpos", "forecast", "barspattern", "ghost", "sector"] },
      { title: "VOLUME-BASED", ids: ["avwap", "frvp", "avp"] },
      { title: "MEASURERS", ids: ["pricerange", "daterange", "daterangeprice"] },
    ],
  },
  {
    id: "shapes", label: "Geometric shapes", icon: "brush",
    sections: [
      { title: "BRUSHES", ids: ["brush", "highlighter"] },
      { title: "ARROWS", ids: ["arrowmarker", "arrow", "arrowup", "arrowdown"] },
      { title: "SHAPES", ids: ["rect", "rotrect", "path", "circle", "ellipse", "polyline", "triangle", "arc", "curve", "doublecurve"] },
    ],
  },
  {
    id: "text", label: "Annotation tools", icon: "text",
    sections: [
      { title: "TEXT AND NOTES", ids: ["text", "note", "pricenote", "pin", "table", "callout", "comment", "pricelabel", "signpost", "flag"] },
      { title: "CONTENT", ids: ["image", "post", "idea"] },
    ],
  },
];

// Thanh nổi của TV theo từng tool (đo trên TV 2026-10-25, tab trích bằng showPropertiesDialog + DOM `.tv-floating-toolbar`).
// lc = màu đường, bg = màu nền (opts.backgroundColor), fill = màu hình (d.color: nền bong bóng, mũi tên, cờ),
// tc = màu chữ, fs = cỡ chữ, w = độ dày, st = kiểu nét, col / row = thêm cột / hàng (Table), al = alert, anc = anchor.
// Thứ tự hiện: Templates · các nút của tool · Settings · alert · Lock · anchor · Remove · More.
// Position có nút riêng: profit / stop (màu nền lời / lỗ) và limit (Create limit order).
const FLOAT_BAR: Record<string, string> = {
  trendline: "lc tc w st al", ray: "lc tc w st al", infoline: "lc tc w st al", extended: "lc tc w st al",
  hline: "lc tc w st al", hray: "lc tc w st al", vline: "lc tc w st al", trendangle: "lc w st al", crossline: "lc w st",
  channel: "lc bg tc w al", regression: "w", flat: "lc bg tc w st al", disjoint: "lc bg tc w st al",
  pitchfork: "lc w", schiff: "lc w", mschiff: "lc w", insidefork: "lc w",
  fib: "lc w al", fibext: "lc w al", fibchannel: "lc", fibtimezone: "lc w st", fibfan: "lc w st", fibtimeext: "lc w", fibcircles: "lc w",
  fibspiral: "lc w", fibarcs: "lc w", fibwedge: "lc w", pitchfan: "lc w",
  gannbox: "lc w st", gannsqfixed: "lc w", gannsquare: "lc w", gannfan: "lc w",
  xabcd: "lc bg tc w", cypher: "lc bg tc w", headshoulders: "lc bg tc w", trianglepattern: "lc bg tc w", abcd: "lc tc w", threedrives: "lc tc w",
  elliottimpulse: "lc w", elliottcorrection: "lc w", elliotttriangle: "lc w", elliottdouble: "lc w", elliotttriple: "lc w",
  cyclic: "lc w", timecycles: "lc bg w st", sine: "lc w st",
  longpos: "tc profit stop limit al", shortpos: "tc profit stop limit al", sector: "lc bg w", avwap: "lc w al", frvp: "", avp: "",
  pricerange: "lc bg tc w", daterange: "lc bg tc w", daterangeprice: "lc bg tc w",
  brush: "lc w", highlighter: "lc w", arrowmarker: "fill tc", arrow: "lc tc w st al", arrowup: "lc tc", arrowdown: "lc tc",
  rect: "lc bg tc w st al", rotrect: "lc bg w", path: "lc w st", circle: "lc bg tc w", ellipse: "lc bg tc w", polyline: "lc bg w st",
  triangle: "lc bg w", arc: "lc bg w", curve: "lc w st", doublecurve: "lc w st",
  text: "tc fs anc", note: "lc bg tc", pricenote: "lc bg tc", pin: "lc tc fs anc", table: "col row lc bg tc anc",
  callout: "tc fill fs", comment: "tc fill fs", pricelabel: "tc fill fs", signpost: "fs", flag: "fill",
};
export const floatBar = (id: string): string[] => (FLOAT_BAR[id] ?? "lc tc w st al").split(" ").filter(Boolean);

// Tab của hộp Settings theo từng tool (đo trên TV): i = Inputs, s = Style, t = Text, c = Coordinates, v = Visibility.
// Tool không có trong bảng: Style · Coordinates · Visibility (+ Text nếu có spec.text).
const TV_TABS: Record<string, string> = {
  trendline: "s t c v", ray: "s t c v", infoline: "s t c v", extended: "s t c v", trendangle: "s c v", hline: "s t c v", hray: "s t c v", vline: "s t c v", crossline: "s c v",
  channel: "s t c v", regression: "i s c v", flat: "s t v", disjoint: "s t v", fibwedge: "s v", sector: "s v", avwap: "i s v",
  pricerange: "s t c v", daterange: "s t c v", daterangeprice: "s t c v", arrowmarker: "s t c v", arrow: "s t c v", arrowup: "s t c v", arrowdown: "s t c v",
  rect: "s t c v", rotrect: "s v", path: "s v", circle: "s t c v", ellipse: "s t v", polyline: "s v", arc: "s v", brush: "s v", highlighter: "s v",
  text: "t v", note: "s t c v", pricenote: "s t c v", pin: "s t c v", table: "s v", callout: "t c v", comment: "t c v", pricelabel: "s c v", signpost: "s t c v", flag: "s c v",
  longpos: "i s v", shortpos: "i s v",
};
export type SettingsTab = "inputs" | "style" | "text" | "coords" | "visibility";
/** Hình có tab Text trong Settings (tool có spec.text và TV không bỏ tab đó). */
export const hasTextTab = (id: string): boolean => Boolean(SPEC[id]?.text) && (settingsTabs(id)?.includes("text") ?? true);
const TAB_KEY: Record<string, SettingsTab> = { i: "inputs", s: "style", t: "text", c: "coords", v: "visibility" };
export const settingsTabs = (id: string): SettingsTab[] | null => TV_TABS[id]?.split(" ").map((k) => TAB_KEY[k]) ?? null;

export const DEFAULT_FAVORITES = ["shortpos", "longpos", "rect", "frvp", "hray", "trendline", "fib"];
