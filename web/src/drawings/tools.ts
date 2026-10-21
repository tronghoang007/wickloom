import type { Bar } from "@/lib/api";
import type { Ext, Pt, Shape } from "./shapes";
import type { Anchor, Drawing } from "./types";

export type Ctx = {
  d: Drawing;
  p: Pt[];
  w: number;
  h: number;
  bars: Bar[];
  profileBars?: Bar[];
  tickSize: number;
  hovered: boolean;
  selected: boolean;
  step: number; // giây mỗi bar
  barsBetween: (t0: number, t1: number) => number; // số nến theo chỉ số nến, bỏ qua nghỉ phiên
  X: (t: number) => number | null;
  Y: (price: number) => number | null;
  fp: (price: number) => string;
  digits: number;
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
  style?: Partial<Pick<Drawing, "color" | "width" | "dash">>;
  prompt?: string; // có text sửa được (mở ô sửa inline khi tạo / double-click); cũng là text mặc định
  axes?: "price" | "time"; // nhãn điểm trên trục khi chọn: chỉ giá / chỉ thời gian (mặc định cả hai)
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
};

// Tùy chọn dạng bật/tắt hoặc chọn 1 trong danh sách, đặt tên theo thuộc tính của TV
export type ToolOption = { key: string; label: string; section?: string } & (
  | { def: boolean }
  | { def: string; choices: [string, string][] }
  | { def: string; color: true } // "" = dùng màu đường
);

// Tab Text của TV: chữ chạy dọc đường (line), nằm trong hộp (box); kèm default cỡ chữ + căn lề
export type TextSpec = { kind: "line" | "box"; size: number; v: "top" | "middle" | "bottom"; h: "left" | "center" | "right" };

const EXTEND: [string, string][] = [["none", "Don't extend"], ["left", "Extend left"], ["right", "Extend right"], ["both", "Extend both"]];

// Giá trị tùy chọn: d.opts, không có thì default của tool
export function optOf(d: Drawing, key: string): number | string | boolean | undefined {
  const spec = SPEC[d.type];
  const t = spec?.text;
  const textDef = t && { fontSize: t.size, bold: false, italic: false, vAlign: t.v, hAlign: t.h }[key];
  return d.opts?.[key] ?? spec?.options?.find((o) => o.key === key)?.def ?? textDef;
}

// Chữ của tab Text: cỡ, đậm, nghiêng, màu (mặc định màu đường)
function textStyle(c: Ctx) {
  return {
    size: Number(optOf(c.d, "fontSize")) || 14,
    bold: Boolean(optOf(c.d, "bold")),
    italic: Boolean(optOf(c.d, "italic")),
    color: c.d.textColor ?? c.d.color,
  };
}

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
  return [...priceLevels(c, (k) => fibPrice(pa, pb, k), Math.min(a.x, b.x), Math.max(a.x, b.x)), seg(a, b, { dash: 1, w: 1, color: "#787b86" })];
}

const FIB_OPTIONS: ToolOption[] = [
  { key: "extend", label: "Extend lines", def: "none", choices: EXTEND },
  { key: "showCoeffs", label: "Levels", def: true },
  { key: "showPrices", label: "Prices", def: true },
  { key: "labels", label: "Labels", def: "left", choices: [["left", "Left"], ["right", "Right"]] },
  { key: "background", label: "Background", def: true },
];
const BG: ToolOption = { key: "background", label: "Background", def: true };
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
    ...fills.map((f) => poly(f.map((i) => p[i]), { closed: true, fill: 0.15, noStroke: true })),
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
    ...[[L, p[1], p[2]], [p[2], p[3], p[4]], [p[4], p[5], R]].map((t) => poly(t, { closed: true, fill: 0.15, noStroke: true })),
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
    out.push(poly([a, top, apex], { closed: true, fill: 0.15, noStroke: true }), seg(a, apex, { dash: 2, w: 1 }), seg(top, apex, { dash: 2, w: 1 }), seg(a, top, { dash: 2, w: 1 }));
  } else {
    out.push(ray(a, cc, { dash: 2, w: 1 }), ray(b, d, { dash: 2, w: 1 }));
  }
  return [...out, poly(c.p), ...letters(c, ["A", "B", "C", "D"], true)];
}

// Elliott như TV: nhãn "(1)…" màu đường, không nền, điểm đầu không có nhãn
const elliott = (names: string[]) => (c: Ctx): Shape[] => [poly(c.p), ...letters(c, ["", ...names.map((x) => `(${x})`)])];

export const VP_DEFAULTS = {
  rows: 24, volume: "updown", va: 70, extend: false, width: 30, place: "left", values: false,
  up: "#26a69a", down: "#f23645", vaUp: "#00bcd4", vaDown: "#e91e63",
  showVah: true, vahColor: "#2962ff", showVal: true, valColor: "#2962ff", showPoc: true, pocColor: "#ff9800",
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

// Volume theo từng row giá + POC + Value Area (va = % tổng volume) của các nến đã lọc.
export function computeProfile(bars: Bar[], tick: number, rows: number, va: number) {
  if (bars.length === 0) return null;
  const priceLow = Math.min(...bars.map((b) => b.l)), priceHigh = Math.max(...bars.map((b) => b.h));
  const lowTick = Math.floor(priceLow / tick), highTick = Math.ceil(priceHigh / tick);
  const totalTicks = Math.max(1, highTick - lowTick);
  const requestedRows = Math.max(2, Math.min(500, Math.round(rows)));
  const rowCandidates = [...new Set([
    Math.max(1, Math.floor(totalTicks / requestedRows)),
    Math.max(1, Math.ceil(totalTicks / requestedRows)),
  ])];
  const ticksPerRow = rowCandidates.reduce((best, candidate) =>
    Math.abs(Math.ceil(totalTicks / candidate) - requestedRows) <
      Math.abs(Math.ceil(totalTicks / best) - requestedRows) ? candidate : best,
  );
  const lo = lowTick * tick, hi = highTick * tick, size = ticksPerRow * tick;
  const N = Math.max(1, Math.ceil(totalTicks / ticksPerRow));
  const up = new Array(N).fill(0), dn = new Array(N).fill(0);
  for (const b of bars) {
    const i0 = Math.min(N - 1, Math.floor((b.l - lo) / size)), i1 = Math.min(N - 1, Math.floor((b.h - lo) / size));
    const v = b.v, range = b.h - b.l, bucket = b.c >= b.o ? up : dn;
    if (!(v > 0)) continue;
    if (range <= 0 || i0 === i1) { bucket[i0] += v; continue; }
    // Chia volume của nến theo tỉ lệ phần giá nến chồng lên từng row
    for (let i = i0; i <= i1; i++) {
      const rl = lo + size * i;
      const overlap = Math.min(b.h, rl + size) - Math.max(b.l, rl);
      if (overlap > 0) bucket[i] += (v * overlap) / range;
    }
  }
  const total: number[] = up.map((v, i) => v + dn[i]);
  const mv = Math.max(...total), sum = total.reduce((s, v) => s + v, 0);
  if (!(sum > 0)) return null;
  const poc = total.indexOf(mv);

  let vl = poc, vh = poc, acc = total[poc];
  const target = (sum * Math.max(0, Math.min(100, va))) / 100;
  while (acc < target && (vl > 0 || vh < N - 1)) {
    const canUp = vh < N - 1, canDn = vl > 0;
    const above = canUp ? total[vh + 1] : -1;
    const below = canDn ? total[vl - 1] : -1;
    let takeAbove = canUp && (!canDn || above > below);
    if (canUp && canDn && above === below) {
      takeAbove = vh + 1 - poc <= poc - (vl - 1);
    }
    const candidate = takeAbove ? above : below;
    if (acc + candidate > target) break;
    acc += candidate;
    if (takeAbove) vh++;
    else vl--;
  }
  return { lo, hi, size, N, up, dn, total, mv, poc, vl, vh };
}

function volumeProfile(c: Ctx, t0: number, t1: number, anchored = false): Shape[] {
  const o = { ...(VP_BY[c.d.type] ?? VP_DEFAULTS), ...c.d.opts } as typeof VP_DEFAULTS;
  const source = c.d.type === "frvp" && c.profileBars?.length ? c.profileBars : c.bars;
  const tick = c.tickSize > 0 ? c.tickSize : 10 ** -c.digits;
  const vp = computeProfile(source.filter((b) => b.t >= t0 && b.t <= t1), tick, o.rows, o.va);
  if (!vp) return [];
  const { lo, hi, size, N, up, dn, total, mv, poc, vl, vh } = vp;

  const x0 = c.X(t0), x1 = anchored ? c.w : c.X(t1);
  if (x0 === null || x1 === null) return [];
  const left = Math.min(x0, x1), right = Math.max(x0, x1);
  const histW = Math.max(20, ((right - left) * o.width) / 100);
  const dir = o.place === "right" ? -1 : 1;
  const base = dir === 1 ? left : right;
  const out: Shape[] = [];

  for (let i = 0; i < N; i++) {
    const rowLow = lo + size * i, rowHigh = Math.min(hi, lo + size * (i + 1));
    const yb = c.Y(rowLow), yt = c.Y(rowHigh);
    if (yb === null || yt === null) continue;
    const inVa = i >= vl && i <= vh;
    const rect = (a: number, b: number, color: string) =>
      poly([{ x: a, y: yb }, { x: b, y: yb }, { x: b, y: yt }, { x: a, y: yt }], { closed: true, fill: inVa ? 0.75 : 0.4, noStroke: true, color });
    const wUp = (up[i] / mv) * histW, wDn = (dn[i] / mv) * histW;
    if (o.volume === "total") out.push(rect(base, base + dir * (total[i] / mv) * histW, inVa ? o.vaUp : o.up));
    else {
      if (wUp > 0) out.push(rect(base, base + dir * wUp, inVa ? o.vaUp : o.up));
      if (wDn > 0) out.push(rect(base + dir * wUp, base + dir * (wUp + wDn), inVa ? o.vaDown : o.down));
    }
    if (o.values && total[i] > 0) out.push(txt({ x: base + dir * ((total[i] / mv) * histW + 3), y: (yb + yt) / 2 }, String(Math.round(total[i])), { size: 9, align: dir === 1 ? "left" : "right" }));
  }

  const xEnd = o.extend ? c.w : right;
  const line = (price: number, color: string, extra: O) => {
    const y = c.Y(price);
    if (y === null) return;
    out.push(seg({ x: left, y }, { x: xEnd, y }, { color, w: 1, ...extra }));
    out.push({ k: "axis", y, text: c.fp(price), bg: color, color: axisText(color) });
  };
  if (o.showVah) line(Math.min(hi, lo + size * (vh + 1)), o.vahColor, { dash: 1 });
  if (o.showVal) line(lo + size * vl, o.valColor, { dash: 1 });
  if (o.showPoc) line((lo + size * poc + Math.min(hi, lo + size * (poc + 1))) / 2, o.pocColor, { dash: 0, w: 1.5 });
  return out;
}

function measure(c: Ctx): Shape[] {
  const [a, b] = c.p;
  const [pa, pb] = [pt(c, 0), pt(c, 1)];
  const up = pb.price >= pa.price;
  const color = up ? "#2962ff" : "#f23645";
  const bars = c.barsBetween(pa.time, pb.time);
  const label = `${c.fp(pb.price - pa.price)} (${pctStr(pa.price, pb.price)})  ${bars} bars, ${fmtDur(pb.time - pa.time)}`;
  const m = mid(a, b);
  return [
    poly([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], { closed: true, fill: 0.15, noStroke: true, color }),
    seg({ x: m.x, y: a.y }, { x: m.x, y: b.y }, { color, w: 1 }),
    head({ x: m.x, y: a.y }, { x: m.x, y: b.y }, 8, { color }),
    seg({ x: a.x, y: m.y }, { x: b.x, y: m.y }, { color, w: 1 }),
    head({ x: a.x, y: m.y }, { x: b.x, y: m.y }, 8, { color }),
    txt({ x: m.x, y: (up ? Math.min(a.y, b.y) - 18 : Math.max(a.y, b.y) + 18) }, label, { align: "center", bg: color, size: 11 }),
  ];
}

// riskMode như TV riskDisplayMode: risk là % tài khoản (percent) hay số tiền (money)
export const POS_DEFAULTS = { account: 1000, lot: 1, risk: 2, riskMode: "percent", profit: "#089981", stop: "#f23645", alpha: 0.2 };

// Số lẻ của bước giá (0.001 -> 3, 0.25 -> 2) và làm tròn giá theo bước đó
const decimals = (x: number) => {
  let d = 0;
  while (d < 10 && Math.abs(Math.round(x * 10 ** d) - x * 10 ** d) > 1e-9) d++;
  return d;
};
export const roundToTick = (v: number, tick: number) => +(Math.round(v / tick) * tick).toFixed(decimals(tick));

// Khối lượng theo % rủi ro và kết quả lệnh: đi từng nến sau entry tới mép phải, chạm stop
// trước (cùng nến thì tính stop) hay target trước; chưa chạm thì P&L theo giá đóng cửa.
// Như TV: Qty làm tròn xuống; P&L ghi theo giá (pnlPts); số dư khi chạm target/stop =
// tài khoản ± rủi ro × R.
export function positionStats(bars: Bar[], points: Anchor[], long: boolean, o: Pick<typeof POS_DEFAULTS, "account" | "lot" | "risk"> & { riskMode?: string }) {
  const [pe, pT, pR, pS] = points;
  const dT = Math.abs(pT.price - pe.price), dS = Math.abs(pS.price - pe.price) || 1e-9;
  const riskAmt = o.riskMode === "money" ? o.risk : (o.account * o.risk) / 100;
  const qtyRaw = riskAmt / (dS * o.lot);
  const qty = qtyRaw >= 1 ? Math.floor(qtyRaw) : Math.floor(qtyRaw * 100) / 100;

  let closed = false, exitPrice = pe.price, exitT: number | null = null;
  const tEnd = Math.max(pe.time, pR.time);
  for (const b of bars) {
    if (b.t <= pe.time) continue;
    if (b.t > tEnd) break;
    const hitS = long ? b.l <= pS.price : b.h >= pS.price;
    const hitT = long ? b.h >= pT.price : b.l <= pT.price;
    exitT = b.t;
    if (hitS) { closed = true; exitPrice = pS.price; break; }
    if (hitT) { closed = true; exitPrice = pT.price; break; }
    exitPrice = b.c;
  }
  const pnlPts = long ? exitPrice - pe.price : pe.price - exitPrice;
  const pnl = pnlPts * qty * o.lot;
  const rr = dT / dS;
  return { dT, dS, riskAmt, qty, closed, exitPrice, exitT, pnl, pnlPts, rr, tpAmount: o.account + riskAmt * rr, slAmount: o.account - riskAmt };
}

// Số pip: cặp có pip lẻ (giá 3 hoặc 5 số lẻ, vd XAUUSD 0.001) thì 1 pip = 10 tick, như TV
const pips = (dist: number, digits: number) => dist / 10 ** -digits / (digits === 3 || digits === 5 ? 10 : 1);

// points: [entry, target, right-edge, stop]
function position(c: Ctx): Shape[] {
  const o = { ...POS_DEFAULTS, ...c.d.opts } as typeof POS_DEFAULTS;
  const [e, t, r, s] = c.p;
  const pe = c.d.points[0];
  const long = c.d.type !== "shortpos"; // như TV: theo loại tool, không suy từ vị trí target
  const x0 = Math.min(e.x, r.x), x1 = Math.max(e.x, r.x);
  const { dT, dS, qty, closed, exitPrice, exitT, pnlPts, rr, tpAmount, slAmount } = positionStats(c.bars, c.d.points, long, o);
  const num = (v: number, max = 2, useGrouping = true) => v.toLocaleString(undefined, { maximumFractionDigits: max, useGrouping });

  const rect = (y0: number, y1: number, color: string) =>
    poly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], { closed: true, fill: o.alpha, noStroke: true, color });
  const cx = (x0 + x1) / 2;
  const tc = c.d.textColor ?? "#ffffff";
  const out: Shape[] = [rect(e.y, t.y, o.profit), rect(e.y, s.y, o.stop)];

  const ex = exitT === null ? null : c.X(exitT), ey = exitT === null ? null : c.Y(exitPrice);
  if (ex !== null && ey !== null) out.push(seg({ x: x0, y: e.y }, { x: ex, y: ey }, { dash: 1, w: 1, color: "#b2b5be" }));

  if (c.hovered || c.selected) {
    const line = (name: string, dist: number, amount: number) =>
      `${name}: ${c.fp(dist)} (${((dist / pe.price) * 100).toFixed(3)}%) ${num(pips(dist, c.digits), 1)}, Amount: ${num(amount, 2, false)}`; // TV: "1,432.7" nhưng "Amount: 1250"
    out.push(
      txt({ x: cx, y: t.y + (t.y < e.y ? -14 : 14) }, line("Target", dT, tpAmount), { align: "center", bg: o.profit, color: tc, size: 12 }),
      txt({ x: cx, y: s.y + (s.y > e.y ? 14 : -14) }, line("Stop", dS, slAmount), { align: "center", bg: o.stop, color: tc, size: 12 }),
      // như TV: nhãn PnL (theo giá) nằm giữa, ngay trên đường entry
      txt({ x: cx, y: e.y }, `${closed ? "Closed" : "Open"} PnL: ${c.fp(pnlPts)}, Qty: ${num(qty)}\nRisk/reward ratio: ${num(rr)}`, { align: "center", bg: pnlPts >= 0 ? o.profit : o.stop, color: tc, size: 12 }),
    );
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
    { time: a.time, price: e.price + dir * d },
    { time: v.addBars(a.time, Math.max(1, Math.round(v.visibleBars / 7))), price: e.price },
    { time: a.time, price: e.price - dir * d },
  ];
};

const noteShapes = (c: Ctx, text: string): Shape[] => {
  const [a, b] = c.p;
  return [seg(a, b, { w: 1 }), poly(circle(a, 3, 12), { closed: true, fill: 1 }), txt(b, text, { align: "left", bg: c.d.color, size: 12 })];
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
    { key: "showAngle", label: "Angle", def: info, section: "STATS" },
    { key: "statsPosition", label: "Stats position", def: info ? "center" : "right", choices: [["left", "Left"], ["center", "Center"], ["right", "Right"]], section: "STATS" },
    { key: "alwaysShowStats", label: "Always show stats", def: info, section: "STATS" },
  ];
}

const LINE_TEXT: TextSpec = { kind: "line", size: 14, v: "top", h: "center" };

// Nội dung Stats theo các mục đã bật (mỗi nhóm 1 dòng)
export function lineStats(c: Ctx): string {
  const [pa, pb] = c.d.points;
  const on = (k: string) => Boolean(optOf(c.d, k));
  const d = pb.price - pa.price;
  const price = [
    on("showPriceRange") && c.fp(d),
    on("showPercent") && `(${pctStr(pa.price, pb.price)})`,
    on("showPips") && `${(pips(Math.abs(d), c.digits) * Math.sign(d)).toLocaleString(undefined, { maximumFractionDigits: 1 })} pips`,
  ].filter(Boolean).join(" ");
  const time = [on("showBars") && `${c.barsBetween(pa.time, pb.time)} bars`, on("showDateTime") && fmtDur(pb.time - pa.time)].filter(Boolean).join(", ");
  const [a, b] = c.p;
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
  { id: "trendline", label: "Trend line", n: 2, build: lineTool, options: lineOptions("none", false), text: LINE_TEXT },
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
    id: "crossline", label: "Cross line", n: 1,
    build: (c) => [seg({ x: c.p[0].x, y: 0 }, { x: c.p[0].x, y: c.h }), seg({ x: 0, y: c.p[0].y }, { x: c.w, y: c.p[0].y })],
  },
  // Channels
  {
    // TV: mức 0 và 1 (2 cạnh) + 0.5 nét đứt, nền 20%
    id: "channel", label: "Parallel channel", n: 3,
    options: [{ key: "extend", label: "Extend", def: "none", choices: EXTEND }, { key: "middleLine", label: "Middle line", def: true }, BG],
    build: (c) => {
      const [a, b, p] = c.p;
      const o = { x: 0, y: channelOffset(a, b, p) };
      const a2 = add(a, o), b2 = add(b, o);
      const line = (u: Pt, v: Pt, extra: O = {}): Shape => ({ k: "line", ...lineExt(c, [u, v]), ...extra }) as Shape;
      const out: Shape[] = [];
      if (optOf(c.d, "background")) out.push(poly([a, b, b2, a2], { closed: true, fill: 0.2, noStroke: true }));
      out.push(line(a, b), line(a2, b2));
      if (optOf(c.d, "middleLine")) out.push(line(lerp(a, a2, 0.5), lerp(b, b2, 0.5), { dash: 1, w: 1 }));
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
    id: "flat", label: "Flat top/bottom", n: 3, style: { color: "#ff9800" }, options: [BG],
    build: (c) => {
      const [a, b, p] = c.p;
      const f1 = { x: a.x, y: p.y }, f2 = { x: b.x, y: p.y };
      return [...(optOf(c.d, "background") ? [poly([a, b, f2, f1], { closed: true, fill: 0.2, noStroke: true })] : []), seg(a, b), seg(f1, f2)];
    },
  },
  {
    // TV: đường 2 dốc ngược đường 1, đi từ (x điểm 1, giá p3 + Δ) tới (x điểm 2, giá p3); thời gian p3
    // không dùng, handle 3 nằm ở đầu phải đường 2; tô hình nơ giữa 2 đường
    id: "disjoint", label: "Disjoint channel", n: 3, style: { color: "#089981" }, options: [BG],
    build: (c) => {
      const [a, b, p] = c.p;
      const end = { x: b.x, y: p.y }, start = { x: a.x, y: p.y + (b.y - a.y) };
      return [...(optOf(c.d, "background") ? [poly([a, b, end, start], { closed: true, fill: 0.2, noStroke: true })] : []), seg(a, b), seg(start, end)];
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
      return [...priceLevels(c, (k) => pc.price + (pb.price - pa.price) * k, x0, x1), seg(a, b, TREND), seg(b, p, TREND)];
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
  { id: "xabcd", label: "XABCD pattern", n: 5, build: (c) => harmonic(c, false) },
  { id: "cypher", label: "Cypher pattern", n: 5, build: (c) => harmonic(c, true) },
  { id: "headshoulders", label: "Head and shoulders", n: 7, style: { color: "#089981" }, build: headShoulders },
  {
    id: "abcd", label: "ABCD pattern", n: 4, style: { color: "#089981" },
    build: (c) => {
      const [A, B, C, D] = c.d.points.map((q) => q.price);
      return pattern(c, ["A", "B", "C", "D"], [[0, 2, ratioOf(C - B, B - A)], [1, 3, ratioOf(D - C, C - B)]]);
    },
  },
  { id: "trianglepattern", label: "Triangle pattern", n: 4, style: { color: "#673ab7" }, build: trianglePattern },
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
    id: "timecycles", label: "Time cycles", n: 2, style: { color: "#159980" }, options: [BG],
    build: (c) => {
      const [a, b] = c.p;
      const dx = Math.abs(b.x - a.x) || 1;
      const out: Shape[] = [];
      for (let k = Math.floor(-a.x / dx); k <= Math.ceil((c.w - a.x) / dx) && out.length < 400; k++) {
        const arc = arcPts({ x: a.x + (k + 0.5) * dx, y: a.y }, dx / 2, Math.PI, Math.PI * 2);
        if (optOf(c.d, "background")) out.push(poly(arc, { closed: true, fill: 0.5, noStroke: true, color: "#6aa84f" }));
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
  { id: "longpos", label: "Long position", n: 4, panel: "position", constrain: posConstrain(1), oneClick: (a, v) => posAt(a, v, 1), build: position },
  { id: "shortpos", label: "Short position", n: 4, panel: "position", constrain: posConstrain(-1), oneClick: (a, v) => posAt(a, v, -1), build: position },
  { id: "forecast", label: "Position forecast", n: 2, build: () => [], disabled: true },
  { id: "barspattern", label: "Bars pattern", n: 2, build: () => [], disabled: true },
  { id: "ghost", label: "Ghost feed", n: 2, build: () => [], disabled: true },
  {
    id: "sector", label: "Sector", n: 3,
    build: (c) => {
      const [a, b, p] = c.p;
      const R = dist(a, b), a0 = Math.atan2(b.y - a.y, b.x - a.x), a1 = shortSweep(a0, Math.atan2(p.y - a.y, p.x - a.x));
      return [poly([a, ...arcPts(a, R, a0, a1)], { closed: true, fill: 0.15 })];
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
  { id: "frvp", label: "Fixed range volume profile", n: 2, panel: "volume", axes: "time", build: (c) => volumeProfile(c, span(c).t0, span(c).t1) },
  { id: "avp", label: "Anchored volume profile", n: 1, panel: "volume", axes: "time", build: (c) => volumeProfile(c, pt(c, 0).time, c.bars[c.bars.length - 1]?.t ?? pt(c, 0).time, true) },
  // Measurers
  {
    id: "pricerange", label: "Price range", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const [pa, pb] = c.d.points;
      const x = (a.x + b.x) / 2;
      return [
        seg({ x: Math.min(a.x, b.x), y: a.y }, { x: Math.max(a.x, b.x), y: a.y }, { dash: 1, w: 1 }),
        seg({ x: Math.min(a.x, b.x), y: b.y }, { x: Math.max(a.x, b.x), y: b.y }, { dash: 1, w: 1 }),
        seg({ x, y: a.y }, { x, y: b.y }),
        head({ x, y: a.y }, { x, y: b.y }, 8),
        txt({ x, y: (a.y + b.y) / 2 }, `${c.fp(pb.price - pa.price)} (${pctStr(pa.price, pb.price)})`, { align: "center", bg: c.d.color, size: 11 }),
      ];
    },
  },
  {
    id: "daterange", label: "Date range", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const [pa, pb] = c.d.points;
      const y = (a.y + b.y) / 2;
      return [
        seg({ x: a.x, y: Math.min(a.y, b.y) - 30 }, { x: a.x, y: Math.max(a.y, b.y) + 30 }, { dash: 1, w: 1 }),
        seg({ x: b.x, y: Math.min(a.y, b.y) - 30 }, { x: b.x, y: Math.max(a.y, b.y) + 30 }, { dash: 1, w: 1 }),
        seg({ x: a.x, y }, { x: b.x, y }),
        head({ x: a.x, y }, { x: b.x, y }, 8),
        txt({ x: (a.x + b.x) / 2, y: y - 14 }, `${c.barsBetween(pa.time, pb.time)} bars, ${fmtDur(pb.time - pa.time)}`, { align: "center", bg: c.d.color, size: 11 }),
      ];
    },
  },
  { id: "daterangeprice", label: "Date and price range", n: 2, build: measure },
  { id: "measure", label: "Measure", n: 2, build: measure, ephemeral: true },
  { id: "zoom", label: "Zoom in", n: 2, action: "zoom", build: (c) => [poly([c.p[0], { x: c.p[1].x, y: c.p[0].y }, c.p[1], { x: c.p[0].x, y: c.p[1].y }], { closed: true, fill: 0.1, dash: 1, w: 1 })] },

  // Brushes
  { id: "brush", label: "Brush", n: -1, build: (c) => [poly(c.p)] },
  { id: "highlighter", label: "Highlighter", n: -1, style: { color: "#f5c542", width: 3 }, build: (c) => [poly(c.p, { w: c.d.width * 6, alpha: 0.35 })] },
  // Arrows
  {
    id: "arrowmarker", label: "Arrow marker", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const u = unit(sub(b, a)), n = { x: -u.y, y: u.x };
      const L = Math.min(26, dist(a, b) * 0.4), hb = sub(b, mul(u, L));
      return [poly([a, add(hb, mul(n, 3)), add(hb, mul(n, 9)), b, sub(hb, mul(n, 9)), sub(hb, mul(n, 3))], { closed: true, fill: 1 })];
    },
  },
  { id: "arrow", label: "Arrow", n: 2, build: lineTool, options: lineOptions("none", false, "arrow"), text: LINE_TEXT },
  {
    id: "arrowup", label: "Arrow mark up", n: 1, style: { color: "#089981" },
    build: (c) => {
      const { x, y } = c.p[0], s = 8 + c.d.width * 3;
      return [poly([{ x, y }, { x: x - s, y: y + s }, { x: x - s / 2, y: y + s }, { x: x - s / 2, y: y + s * 2.2 }, { x: x + s / 2, y: y + s * 2.2 }, { x: x + s / 2, y: y + s }, { x: x + s, y: y + s }], { closed: true, fill: 1 })];
    },
  },
  {
    id: "arrowdown", label: "Arrow mark down", n: 1, style: { color: "#f23645" },
    build: (c) => {
      const { x, y } = c.p[0], s = 8 + c.d.width * 3;
      return [poly([{ x, y }, { x: x - s, y: y - s }, { x: x - s / 2, y: y - s }, { x: x - s / 2, y: y - s * 2.2 }, { x: x + s / 2, y: y - s * 2.2 }, { x: x + s / 2, y: y - s }, { x: x + s, y: y - s }], { closed: true, fill: 1 })];
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
    id: "rotrect", label: "Rotated rectangle", n: 3,
    build: (c) => {
      const [a, b, p] = c.p;
      const u = unit(sub(b, a)), n = { x: -u.y, y: u.x };
      const off = mul(n, (p.x - a.x) * n.x + (p.y - a.y) * n.y);
      return [poly([a, b, add(b, off), add(a, off)], { closed: true, fill: 0.15 })];
    },
  },
  { id: "path", label: "Path", n: 0, build: (c) => (c.p.length > 1 ? [poly(c.p), head(c.p[c.p.length - 2], c.p[c.p.length - 1], 10 + c.d.width * 2)] : []) },
  { id: "circle", label: "Circle", n: 2, build: (c) => [poly(circle(c.p[0], dist(c.p[0], c.p[1])), { closed: true, fill: 0.15 })] },
  {
    id: "ellipse", label: "Ellipse", n: 2, shift: "square",
    build: (c) => {
      const m = mid(c.p[0], c.p[1]), rx = Math.abs(c.p[1].x - c.p[0].x) / 2, ry = Math.abs(c.p[1].y - c.p[0].y) / 2;
      return [poly(circle(m, 1).map((q) => ({ x: m.x + (q.x - m.x) * rx, y: m.y + (q.y - m.y) * ry })), { closed: true, fill: 0.15 })];
    },
  },
  { id: "polyline", label: "Polyline", n: 0, build: (c) => [poly(c.p, { fill: 0.1 })] },
  { id: "triangle", label: "Triangle", n: 3, build: (c) => [poly(c.p.slice(0, 3), { closed: true, fill: 0.15 })] },
  {
    id: "arc", label: "Arc", n: 3,
    build: (c) => {
      const [a, b, p] = c.p;
      const d = 2 * (a.x * (b.y - p.y) + b.x * (p.y - a.y) + p.x * (a.y - b.y));
      if (Math.abs(d) < 1e-6) return [seg(a, b)];
      const sq = (q: Pt) => q.x * q.x + q.y * q.y;
      const ctr = {
        x: (sq(a) * (b.y - p.y) + sq(b) * (p.y - a.y) + sq(p) * (a.y - b.y)) / d,
        y: (sq(a) * (p.x - b.x) + sq(b) * (a.x - p.x) + sq(p) * (b.x - a.x)) / d,
      };
      const r = dist(ctr, a);
      const ang = (q: Pt) => Math.atan2(q.y - ctr.y, q.x - ctr.x);
      const TAU = Math.PI * 2, norm = (v: number) => ((v % TAU) + TAU) % TAU;
      const a0 = ang(a), sweepB = norm(ang(b) - a0), sweepP = norm(ang(p) - a0);
      const a1 = sweepP <= sweepB ? a0 + sweepB : a0 - (TAU - sweepB);
      return [poly(arcPts(ctr, r, a0, a1, 64))];
    },
  },
  { id: "curve", label: "Curve", n: 2, build: (c) => [poly(bezier(c.p[0], { x: c.p[1].x, y: c.p[0].y }, { x: c.p[1].x, y: c.p[0].y }, c.p[1]))] },
  {
    id: "doublecurve", label: "Double curve", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const m = (a.x + b.x) / 2;
      return [poly(bezier(a, { x: m, y: a.y }, { x: m, y: b.y }, b))];
    },
  },

  // Text & notes
  { id: "text", label: "Text", n: 1, prompt: "Text", build: (c) => [txt(c.p[0], c.d.text ?? "Text", { size: 12 + c.d.width * 2 })] },
  { id: "note", label: "Note", n: 2, prompt: "Note", oneClick: (a, v) => [a, offsetPt(a, v, 8, 0.002)], build: (c) => noteShapes(c, c.d.text ?? "Note") },
  { id: "pricenote", label: "Price note", n: 2, oneClick: (a, v) => [a, offsetPt(a, v, 8, 0.002)], build: (c) => noteShapes(c, c.fp(c.d.points[0].price)) },
  {
    id: "pin", label: "Pin", n: 1, prompt: "Pin text",
    build: (c) => {
      const { x, y } = c.p[0];
      return [poly([{ x, y }, { x: x - 6, y: y - 12 }, { x: x + 6, y: y - 12 }], { closed: true, fill: 1 }), poly(circle({ x, y: y - 18 }, 8, 20), { closed: true, fill: 1 }), ...(c.d.text ? [txt({ x, y: y - 36 }, c.d.text, { align: "center", bg: c.d.color, size: 11 })] : [])];
    },
  },
  {
    id: "table", label: "Table", n: 1, prompt: "Table title",
    build: (c) => {
      const { x, y } = c.p[0];
      const cw = 70, ch = 24;
      const out: Shape[] = [poly([{ x, y }, { x: x + cw * 3, y }, { x: x + cw * 3, y: y + ch * 3 }, { x, y: y + ch * 3 }], { closed: true, fill: 0.1 })];
      for (let i = 1; i < 3; i++) out.push(seg({ x: x + cw * i, y }, { x: x + cw * i, y: y + ch * 3 }, { w: 1 }), seg({ x, y: y + ch * i }, { x: x + cw * 3, y: y + ch * i }, { w: 1 }));
      return [...out, txt({ x: x + 6, y: y + ch / 2 }, c.d.text ?? "Table", { size: 12 })];
    },
  },
  { id: "callout", label: "Callout", n: 2, prompt: "Callout", oneClick: (a, v) => [a, offsetPt(a, v, 8, 0.002)], build: (c) => noteShapes(c, c.d.text ?? "Callout") },
  {
    id: "comment", label: "Comment", n: 1, prompt: "Comment",
    build: (c) => {
      const { x, y } = c.p[0];
      return [poly([{ x, y }, { x: x + 4, y: y - 10 }, { x: x + 16, y: y - 10 }], { closed: true, fill: 1 }), txt({ x, y: y - 22 }, c.d.text ?? "Comment", { align: "left", bg: c.d.color, size: 12 })];
    },
  },
  {
    id: "pricelabel", label: "Price label", n: 1,
    build: (c) => {
      const { x, y } = c.p[0];
      return [poly([{ x, y }, { x: x + 8, y: y - 5 }, { x: x + 8, y: y + 5 }], { closed: true, fill: 1 }), txt({ x: x + 8, y }, c.fp(c.d.points[0].price), { align: "left", bg: c.d.color, size: 12 })];
    },
  },
  {
    id: "signpost", label: "Signpost", n: 1, prompt: "Signpost",
    build: (c) => {
      const { x, y } = c.p[0];
      return [seg({ x, y }, { x, y: y + 50 }), txt({ x, y: y - 10 }, c.d.text ?? "Signpost", { align: "center", bg: c.d.color, size: 12 })];
    },
  },
  {
    id: "flag", label: "Flag mark", n: 1,
    build: (c) => {
      const { x, y } = c.p[0];
      return [seg({ x, y }, { x, y: y - 34 }), poly([{ x, y: y - 34 }, { x: x + 24, y: y - 27 }, { x, y: y - 20 }], { closed: true, fill: 1 })];
    },
  },
  { id: "image", label: "Image", n: 1, build: () => [], disabled: true },
  { id: "post", label: "Post", n: 1, build: () => [], disabled: true },
  { id: "idea", label: "Idea", n: 1, build: () => [], disabled: true },
  // Emoji
  { id: "emoji", label: "Emoji", n: 1, build: (c) => [txt(c.p[0], c.d.text ?? "😀", { align: "center", size: 28 + c.d.width * 4 })], style: { width: 1 } },
];

export const SPEC = Object.fromEntries(TOOLS.map((t) => [t.id, t])) as Record<string, ToolSpec>;

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

export const DEFAULT_FAVORITES = ["shortpos", "longpos", "rect", "frvp", "hray", "trendline", "fib"];
