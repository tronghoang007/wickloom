import type { Bar } from "@/lib/api";
import type { Pt, Shape } from "./shapes";
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

export type ToolSpec = {
  id: string;
  label: string;
  n: number; // số điểm; 0 = nhiều điểm (double-click/Enter để kết thúc), -1 = vẽ tay
  oneClick?: (a: Anchor, step: number, span: number) => Anchor[]; // 1 click tạo đủ điểm mặc định; span = khoảng giá đang hiển thị
  build: (c: Ctx) => Shape[];
  handles?: (c: Ctx) => Pt[];
  style?: Partial<Pick<Drawing, "color" | "width" | "dash">>;
  prompt?: string; // hỏi text khi tạo
  ephemeral?: boolean;
  panel?: "position" | "volume";
  constrain?: (pts: Anchor[], moved: number, tick?: number) => void; // tick: kẹp giá khi kéo trên chart
  action?: "zoom";
  disabled?: boolean;
};

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

const FC = ["#787b86", "#f23645", "#ff9800", "#4caf50", "#089981", "#00bcd4", "#787b86", "#2962ff", "#9c27b0"];
const FIB = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618];
const pctStr = (a: number, b: number) => `${(((b - a) / a) * 100).toFixed(2)}%`;
const pt = (c: Ctx, i: number) => c.d.points[i];

function fmtDur(sec: number) {
  sec = Math.abs(sec);
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return [d && `${d}d`, h && `${h}h`, (m || (!d && !h)) && `${m}m`].filter(Boolean).join(" ");
}

function lineLevels(c: Ctx, levels: number[], extend = false): Shape[] {
  const [a, b] = c.p;
  const [pa, pb] = [pt(c, 0).price, pt(c, 1).price];
  const left = Math.min(a.x, b.x), right = extend ? c.w : Math.max(a.x, b.x);
  const out: Shape[] = [];
  let prev: number | null = null;
  levels.forEach((lvl, i) => {
    const y = b.y - (b.y - a.y) * lvl;
    const color = FC[i % FC.length];
    if (prev !== null) out.push(poly([{ x: left, y: prev }, { x: right, y: prev }, { x: right, y }, { x: left, y }], { closed: true, fill: 0.07, noStroke: true, color }));
    out.push(seg({ x: left, y }, { x: right, y }, { color, w: 1 }));
    out.push(txt({ x: left + 4, y: y - 7 }, `${lvl} (${c.fp(pb - (pb - pa) * lvl)})`, { size: 11, color }));
    prev = y;
  });
  out.push(seg(a, b, { dash: 1, w: 1, color: "#787b86" }));
  return out;
}

function channelOffset(a: Pt, b: Pt, c: Pt) {
  const slope = b.x === a.x ? 0 : (b.y - a.y) / (b.x - a.x);
  return c.y - (a.y + slope * (c.x - a.x));
}

function fork(c: Ctx, v: 0 | 1 | 2 | 3): Shape[] {
  const [p0, p1, p2] = c.p;
  const o = v === 1 ? { x: p0.x, y: (p0.y + p1.y) / 2 } : v === 2 ? mid(p0, p1) : p0;
  const m = mid(p1, p2);
  const dir = unit(sub(m, o));
  const far = (p: Pt) => add(p, mul(dir, 20000));
  const out: Shape[] = [
    poly([p1, far(p1), far(p2), p2], { closed: true, fill: 0.06, noStroke: true }),
    ray(o, add(o, dir)),
    ray(p1, add(p1, dir)),
    ray(p2, add(p2, dir)),
    seg(p1, p2, { dash: 1, w: 1 }),
  ];
  if (v === 3) {
    out.push(ray(mid(m, p1), add(mid(m, p1), dir), { dash: 1, w: 1 }));
    out.push(ray(mid(m, p2), add(mid(m, p2), dir), { dash: 1, w: 1 }));
  }
  if (o !== p0) out.push(seg(p0, o, { dash: 2, w: 1 }));
  return out;
}

function gridBox(a: Pt, b: Pt, divs: number[], diag = true): Shape[] {
  const x = (t: number) => a.x + (b.x - a.x) * t, y = (t: number) => a.y + (b.y - a.y) * t;
  const out: Shape[] = [poly([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], { closed: true, fill: 0.05 })];
  for (const t of divs) {
    out.push(seg({ x: x(t), y: a.y }, { x: x(t), y: b.y }, { w: 1 }));
    out.push(seg({ x: a.x, y: y(t) }, { x: b.x, y: y(t) }, { w: 1 }));
  }
  if (diag) {
    out.push(seg(a, b, { w: 1 }));
    out.push(seg({ x: a.x, y: b.y }, { x: b.x, y: a.y }, { w: 1 }));
  }
  return out;
}

function letters(c: Ctx, names: string[], bg = false): Shape[] {
  return c.p.slice(0, names.length).map((p, i, arr) => {
    const nb = [arr[i - 1], arr[i + 1]].filter(Boolean) as Pt[];
    const avg = nb.length ? nb.reduce((s, q) => s + q.y, 0) / nb.length : p.y + 1;
    const above = p.y < avg;
    return txt({ x: p.x, y: p.y + (above ? -14 : 14) }, names[i], bg ? { align: "center", bg: c.d.color, size: 11 } : { align: "center", size: 12 });
  });
}

function pattern(c: Ctx, names: string[], dashed: [number, number][], fills: number[][] = []): Shape[] {
  const p = c.p;
  return [
    ...fills.map((f) => poly(f.map((i) => p[i]), { closed: true, fill: 0.1, noStroke: true })),
    poly(p.slice(0, names.length)),
    ...dashed.map(([i, j]) => seg(p[i], p[j], { dash: 1, w: 1 })),
    ...letters(c, names),
  ];
}

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

export const POS_DEFAULTS = { account: 1000, lot: 1, risk: 2, profit: "#089981", stop: "#f23645", alpha: 0.25 };

// Khối lượng theo % rủi ro và kết quả lệnh: đi từng nến sau entry tới mép phải, chạm stop
// trước (cùng nến thì tính stop) hay target trước; chưa chạm thì P&L theo giá đóng cửa.
export function positionStats(bars: Bar[], points: Anchor[], long: boolean, o: Pick<typeof POS_DEFAULTS, "account" | "lot" | "risk">) {
  const [pe, pT, pR, pS] = points;
  const dT = Math.abs(pT.price - pe.price), dS = Math.abs(pS.price - pe.price) || 1e-9;
  const riskAmt = (o.account * o.risk) / 100;
  const qtyRaw = riskAmt / (dS * o.lot);
  const qty = qtyRaw >= 10 ? Math.round(qtyRaw) : +qtyRaw.toFixed(2);

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
  const pnl = (long ? exitPrice - pe.price : pe.price - exitPrice) * qty * o.lot;
  return { dT, dS, riskAmt, qty, closed, exitPrice, exitT, pnl };
}

// points: [entry, target, right-edge, stop]
function position(c: Ctx): Shape[] {
  const o = { ...POS_DEFAULTS, ...c.d.opts } as typeof POS_DEFAULTS;
  const [e, t, r, s] = c.p;
  const pe = c.d.points[0];
  const long = c.d.type !== "shortpos"; // như TV: theo loại tool, không suy từ vị trí target
  const x0 = Math.min(e.x, r.x), x1 = Math.max(e.x, r.x);
  const { dT, dS, riskAmt, qty, closed, exitPrice, exitT, pnl } = positionStats(c.bars, c.d.points, long, o);
  const tick = 10 ** -c.digits;
  const money = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  const rect = (y0: number, y1: number, color: string) =>
    poly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], { closed: true, fill: o.alpha, noStroke: true, color });
  const cx = (x0 + x1) / 2;
  const tc = c.d.textColor ?? "#ffffff";
  const out: Shape[] = [rect(e.y, t.y, o.profit), rect(e.y, s.y, o.stop)];

  const ex = exitT === null ? null : c.X(exitT), ey = exitT === null ? null : c.Y(exitPrice);
  if (ex !== null && ey !== null) out.push(seg({ x: x0, y: e.y }, { x: ex, y: ey }, { dash: 1, w: 1, color: "#b2b5be" }));

  if (c.hovered || c.selected) {
    out.push(
      txt({ x: cx, y: t.y + (t.y < e.y ? -14 : 14) }, `Target: ${c.fp(dT)} (${((dT / pe.price) * 100).toFixed(3)}%) ${(dT / tick).toLocaleString(undefined, { maximumFractionDigits: 1 })}, Amount: ${money(qty * o.lot * dT)}`, { align: "center", bg: o.profit, color: tc, size: 12 }),
      txt({ x: cx, y: s.y + (s.y > e.y ? 14 : -14) }, `Stop: ${c.fp(dS)} (${((dS / pe.price) * 100).toFixed(3)}%) ${(dS / tick).toLocaleString(undefined, { maximumFractionDigits: 1 })}, Amount: ${money(riskAmt)}`, { align: "center", bg: o.stop, color: tc, size: 12 }),
      // như TV: nhãn PnL nằm giữa, ngay trên đường entry, không viền
      txt({ x: cx, y: e.y }, `${closed ? "Closed" : "Open"} P&L: ${money(pnl)}, Qty: ${qty}\nRisk/Reward Ratio: ${(dT / dS).toFixed(2)}`, { align: "center", bg: pnl >= 0 ? o.profit : o.stop, color: tc, size: 12 }),
    );
  }
  return out;
}

// points: [entry, target, right-edge, stop]. Như TV: target luôn ở phía lời, stop ở phía lỗ,
// cách entry ít nhất 1 tick - kéo quá entry thì bị kẹp lại chứ không tự đổi Long <-> Short.
// Không có tick (ô nhập giá trong Settings, đang gõ dở) thì không kẹp.
export const posConstrain = (dir: 1 | -1) => (p: Anchor[], i: number, tick?: number) => {
  const [e, t, , s] = p;
  if (tick !== undefined) {
    if (i === 0) {
      const lo = dir === 1 ? s.price + tick : t.price + tick;
      const hi = dir === 1 ? t.price - tick : s.price - tick;
      if (lo <= hi) e.price = Math.min(hi, Math.max(lo, e.price));
    } else if (i === 1) {
      t.price = dir === 1 ? Math.max(t.price, e.price + tick) : Math.min(t.price, e.price - tick);
    } else if (i === 3) {
      s.price = dir === 1 ? Math.min(s.price, e.price - tick) : Math.max(s.price, e.price + tick);
    }
  }
  if (i === 0) {
    t.time = s.time = e.time;
    p[2].price = e.price;
  } else if (i === 1 || i === 3) p[i].time = e.time;
  else if (i === 2) p[2].price = e.price;
};

// Như TV: 1 click tạo khối vừa mắt theo khung đang xem - target/stop cách entry ~8% khoảng
// giá hiển thị, rộng 20 nến (trước: ±0.1% giá, 8 nến -> khối vài px, nhãn đè nhau).
const posAt = (a: Anchor, s: number, dir: 1 | -1, span: number): Anchor[] => {
  const d = span > 0 ? span * 0.08 : a.price * 0.002;
  return [
    a,
    { time: a.time, price: a.price + dir * d },
    { time: a.time + s * 20, price: a.price },
    { time: a.time, price: a.price - dir * d },
  ];
};

const noteShapes = (c: Ctx, text: string): Shape[] => {
  const [a, b] = c.p;
  return [seg(a, b, { w: 1 }), poly(circle(a, 3, 12), { closed: true, fill: 1 }), txt(b, text, { align: "left", bg: c.d.color, size: 12 })];
};

const offsetPt = (a: Anchor, step: number, bars = 10, pct = 0.002): Anchor => ({ time: a.time + step * bars, price: a.price * (1 + pct) });

const span = (c: Ctx) => ({ t0: Math.min(pt(c, 0).time, pt(c, 1).time), t1: Math.max(pt(c, 0).time, pt(c, 1).time) });

// ---------- catalog ----------
export const TOOLS: ToolSpec[] = [
  // Lines
  { id: "trendline", label: "Trend line", n: 2, build: (c) => [seg(c.p[0], c.p[1])] },
  { id: "ray", label: "Ray", n: 2, build: (c) => [ray(c.p[0], c.p[1])] },
  {
    id: "infoline", label: "Info line", n: 2,
    build: (c) => {
      const [pa, pb] = c.d.points;
      const bars = c.barsBetween(pa.time, pb.time);
      return [seg(c.p[0], c.p[1]), txt(mid(c.p[0], c.p[1]), `${c.fp(pb.price - pa.price)} (${pctStr(pa.price, pb.price)}) ${bars} bars`, { align: "center", bg: c.d.color, size: 11 })];
    },
  },
  { id: "extended", label: "Extended line", n: 2, build: (c) => [{ k: "line", a: c.p[0], b: c.p[1], ext: "both" } as Shape] },
  {
    id: "trendangle", label: "Trend angle", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const deg = (-Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      return [seg(a, b), seg(a, { x: b.x, y: a.y }, { dash: 1, w: 1 }), txt({ x: b.x + 6, y: b.y }, `${deg.toFixed(0)}°`, { bg: c.d.color, size: 11 })];
    },
  },
  {
    id: "hline", label: "Horizontal line", n: 1,
    build: (c) => [seg({ x: 0, y: c.p[0].y }, { x: c.w, y: c.p[0].y }), txt({ x: 6, y: c.p[0].y - 8 }, c.fp(c.d.points[0].price), { size: 11 })],
    handles: (c) => [{ x: c.w / 2, y: c.p[0].y }],
  },
  { id: "hray", label: "Horizontal ray", n: 1, build: (c) => [seg(c.p[0], { x: c.w, y: c.p[0].y })] },
  {
    id: "vline", label: "Vertical line", n: 1,
    build: (c) => [seg({ x: c.p[0].x, y: 0 }, { x: c.p[0].x, y: c.h })],
    handles: (c) => [{ x: c.p[0].x, y: c.h / 2 }],
  },
  {
    id: "crossline", label: "Cross line", n: 1,
    build: (c) => [seg({ x: c.p[0].x, y: 0 }, { x: c.p[0].x, y: c.h }), seg({ x: 0, y: c.p[0].y }, { x: c.w, y: c.p[0].y })],
  },
  // Channels
  {
    id: "channel", label: "Parallel channel", n: 3,
    build: (c) => {
      const [a, b, p] = c.p;
      const o = { x: 0, y: channelOffset(a, b, p) };
      const a2 = add(a, o), b2 = add(b, o);
      return [poly([a, b, b2, a2], { closed: true, fill: 0.1, noStroke: true }), seg(a, b), seg(a2, b2), seg(lerp(a, a2, 0.5), lerp(b, b2, 0.5), { dash: 1, w: 1 })];
    },
  },
  {
    id: "regression", label: "Regression trend", n: 2,
    build: (c) => {
      const { t0, t1 } = span(c);
      const bars = c.bars.filter((b) => b.t >= t0 && b.t <= t1);
      if (bars.length < 3) return [];
      const n = bars.length, xs = bars.map((_, i) => i), ys = bars.map((b) => b.c);
      const mx = (n - 1) / 2, my = ys.reduce((s, v) => s + v, 0) / n;
      const slope = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0) / xs.reduce((s, x) => s + (x - mx) ** 2, 0);
      const icp = my - slope * mx;
      const sd = Math.sqrt(ys.reduce((s, y, i) => s + (y - (icp + slope * i)) ** 2, 0) / n);
      const xa = c.X(bars[0].t), xb = c.X(bars[n - 1].t);
      const line = (off: number) => [c.Y(icp + off), c.Y(icp + slope * (n - 1) + off)];
      if (xa === null || xb === null) return [];
      const [m0, m1] = line(0), [u0, u1] = line(2 * sd), [l0, l1] = line(-2 * sd);
      if ([m0, m1, u0, u1, l0, l1].some((v) => v === null)) return [];
      const P = (x: number, y: number | null) => ({ x, y: y as number });
      return [
        poly([P(xa, u0), P(xb, u1), P(xb, l1), P(xa, l0)], { closed: true, fill: 0.1, noStroke: true }),
        seg(P(xa, m0), P(xb, m1)),
        seg(P(xa, u0), P(xb, u1), { w: 1 }),
        seg(P(xa, l0), P(xb, l1), { w: 1 }),
      ];
    },
  },
  {
    id: "flat", label: "Flat top/bottom", n: 3,
    build: (c) => {
      const [a, b, p] = c.p;
      const f1 = { x: a.x, y: p.y }, f2 = { x: b.x, y: p.y };
      return [poly([a, b, f2, f1], { closed: true, fill: 0.1, noStroke: true }), seg(a, b), seg(f1, f2)];
    },
  },
  {
    id: "disjoint", label: "Disjoint channel", n: 3,
    build: (c) => {
      const [a, b, p] = c.p;
      const q = add(p, sub(b, a));
      return [poly([a, b, q, p], { closed: true, fill: 0.1, noStroke: true }), seg(a, b), seg(p, q)];
    },
  },
  // Pitchforks
  { id: "pitchfork", label: "Pitchfork", n: 3, build: (c) => fork(c, 0) },
  { id: "schiff", label: "Schiff pitchfork", n: 3, build: (c) => fork(c, 1) },
  { id: "mschiff", label: "Modified Schiff pitchfork", n: 3, build: (c) => fork(c, 2) },
  { id: "insidefork", label: "Inside pitchfork", n: 3, build: (c) => fork(c, 3) },

  // Fib
  { id: "fib", label: "Fib retracement", n: 2, build: (c) => lineLevels(c, FIB), style: { width: 1 } },
  {
    id: "fibext", label: "Trend-based fib extension", n: 3, style: { width: 1 },
    build: (c) => {
      const [a, b, p] = c.p;
      const [pa, pb, pc] = c.d.points;
      const left = Math.min(a.x, b.x, p.x), right = Math.max(a.x, b.x, p.x);
      const out: Shape[] = [seg(a, b, { dash: 1, w: 1 }), seg(b, p, { dash: 1, w: 1 })];
      [0, 0.382, 0.618, 1, 1.618, 2.618].forEach((lvl, i) => {
        const price = pc.price + (pb.price - pa.price) * lvl;
        const y = c.Y(price);
        if (y === null) return;
        const color = FC[i % FC.length];
        out.push(seg({ x: left, y }, { x: right, y }, { color, w: 1 }));
        out.push(txt({ x: left + 4, y: y - 7 }, `${lvl} (${c.fp(price)})`, { size: 11, color }));
      });
      return out;
    },
  },
  {
    id: "fibchannel", label: "Fib channel", n: 3, style: { width: 1 },
    build: (c) => {
      const [a, b, p] = c.p;
      const off = channelOffset(a, b, p);
      return [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].flatMap((lvl, i) =>
        [ray({ x: a.x, y: a.y + off * lvl }, { x: b.x, y: b.y + off * lvl }, { color: FC[i], w: 1 }), txt({ x: b.x + 4, y: b.y + off * lvl }, String(lvl), { size: 10, color: FC[i] })],
      ).concat(seg(a, b, { dash: 1, w: 1 }));
    },
  },
  {
    id: "fibtimezone", label: "Fib time zone", n: 2, style: { width: 1 },
    build: (c) => {
      const [a, b] = c.p;
      const dx = b.x - a.x || 1;
      const out: Shape[] = [seg(a, { x: b.x, y: a.y }, { dash: 1, w: 1 })];
      for (const f of [0, 1, 2, 3, 5, 8, 13, 21, 34, 55, 89]) {
        const x = a.x + dx * f;
        if (x > c.w + 50 || x < -50) continue;
        out.push(seg({ x, y: 0 }, { x, y: c.h }, { w: 1, color: "#787b86" }), txt({ x: x + 3, y: 10 }, String(f), { size: 10 }));
      }
      return out;
    },
  },
  {
    id: "fibfan", label: "Fib speed resistance fan", n: 2, style: { width: 1 },
    build: (c) => {
      const [a, b] = c.p;
      return [
        seg({ x: b.x, y: a.y }, b, { dash: 1, w: 1 }),
        seg(a, { x: b.x, y: a.y }, { dash: 1, w: 1 }),
        ...[0.25, 0.382, 0.5, 0.618, 0.75, 1].map((l, i) => ray(a, { x: b.x, y: a.y + (b.y - a.y) * l }, { color: FC[(i + 1) % FC.length], w: 1 })),
      ];
    },
  },
  {
    id: "fibtimeext", label: "Trend-based fib time", n: 3, style: { width: 1 },
    build: (c) => {
      const [a, b, p] = c.p;
      const dx = b.x - a.x;
      const out: Shape[] = [seg(a, b, { dash: 1, w: 1 }), seg(b, p, { dash: 1, w: 1 })];
      [0, 0.382, 0.5, 0.618, 1, 1.382, 1.618, 2, 2.618].forEach((l, i) => {
        const x = p.x + dx * l;
        out.push(seg({ x, y: 0 }, { x, y: c.h }, { w: 1, color: FC[i % FC.length] }), txt({ x: x + 3, y: 10 }, String(l), { size: 10 }));
      });
      return out;
    },
  },
  {
    id: "fibcircles", label: "Fib circles", n: 2, style: { width: 1 },
    build: (c) => {
      const [a, b] = c.p;
      const m = mid(a, b), r = dist(a, b) / 2;
      return [seg(a, b, { dash: 1, w: 1 }), ...[0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618, 2.618].map((l, i) => poly(circle(m, r * l), { closed: true, fill: 0.03, color: FC[(i + 1) % FC.length], w: 1 }))];
    },
  },
  {
    id: "fibspiral", label: "Fib spiral", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const R = dist(a, b), t0 = Math.atan2(b.y - a.y, b.x - a.x), k = Math.log(1.618) / (Math.PI / 2);
      const pts = Array.from({ length: 400 }, (_, i) => {
        const th = t0 - (8 * Math.PI * (399 - i)) / 399;
        const r = R * Math.exp(k * (th - t0));
        return { x: a.x + r * Math.cos(th), y: a.y + r * Math.sin(th) };
      });
      return [seg(a, b, { dash: 1, w: 1 }), poly(pts)];
    },
  },
  {
    id: "fibarcs", label: "Fib speed resistance arcs", n: 2, style: { width: 1 },
    build: (c) => {
      const [a, b] = c.p;
      const R = dist(a, b), ang = Math.atan2(a.y - b.y, a.x - b.x);
      return [seg(a, b, { dash: 1, w: 1 }), ...[0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618].map((l, i) => poly(arcPts(b, R * l, ang - Math.PI / 2, ang + Math.PI / 2), { color: FC[(i + 1) % FC.length], w: 1 }))];
    },
  },
  {
    id: "fibwedge", label: "Fib wedge", n: 3, style: { width: 1 },
    build: (c) => {
      const [a, b, p] = c.p;
      const R = dist(a, b), a0 = Math.atan2(b.y - a.y, b.x - a.x), a1 = shortSweep(a0, Math.atan2(p.y - a.y, p.x - a.x));
      return [seg(a, b), seg(a, p), ...[0.236, 0.382, 0.5, 0.618, 0.786, 1, 1.618].map((l, i) => poly(arcPts(a, R * l, a0, a1), { color: FC[(i + 1) % FC.length], w: 1 }))];
    },
  },
  {
    id: "pitchfan", label: "Pitchfan", n: 3, style: { width: 1 },
    build: (c) => {
      const [a, b, p] = c.p;
      return [seg(b, p, { dash: 1, w: 1 }), ...[0, 0.236, 0.382, 0.5, 0.618, 0.786, 1].map((t, i) => ray(a, lerp(b, p, t), { color: FC[i % FC.length], w: 1 }))];
    },
  },
  // Gann
  { id: "gannbox", label: "Gann box", n: 2, style: { width: 1 }, build: (c) => gridBox(c.p[0], c.p[1], [0.25, 0.382, 0.5, 0.618, 0.75, 1].map((v) => v)) },
  {
    id: "gannsqfixed", label: "Gann square fixed", n: 2, style: { width: 1 },
    build: (c) => {
      const [a, b] = c.p;
      const s = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
      const e = { x: a.x + Math.sign(b.x - a.x || 1) * s, y: a.y + Math.sign(b.y - a.y || 1) * s };
      return gridBox(a, e, [1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 1]);
    },
  },
  { id: "gannsquare", label: "Gann square", n: 2, style: { width: 1 }, build: (c) => gridBox(c.p[0], c.p[1], [1 / 8, 2 / 8, 3 / 8, 4 / 8, 5 / 8, 6 / 8, 7 / 8, 1]) },
  {
    id: "gannfan", label: "Gann fan", n: 2, style: { width: 1 },
    build: (c) => {
      const [a, b] = c.p;
      const dx = b.x - a.x, dy = b.y - a.y;
      const R: [number, string][] = [[8, "8x1"], [4, "4x1"], [3, "3x1"], [2, "2x1"], [1, "1x1"], [1 / 2, "1x2"], [1 / 3, "1x3"], [1 / 4, "1x4"], [1 / 8, "1x8"]];
      return R.flatMap(([r, name], i) => {
        const e = { x: a.x + dx, y: a.y + dy * r };
        return [ray(a, e, { color: FC[i % FC.length], w: 1 }), txt({ x: e.x + 3, y: e.y }, name, { size: 10, color: FC[i % FC.length] })];
      });
    },
  },

  // Patterns
  { id: "xabcd", label: "XABCD pattern", n: 5, build: (c) => pattern(c, ["X", "A", "B", "C", "D"], [[0, 2], [2, 4], [1, 3], [0, 4]], [[0, 1, 2], [2, 3, 4]]) },
  { id: "cypher", label: "Cypher pattern", n: 5, build: (c) => pattern(c, ["X", "A", "B", "C", "D"], [[0, 2], [2, 4], [1, 3], [0, 4]], [[0, 1, 2], [2, 3, 4]]) },
  {
    id: "headshoulders", label: "Head and shoulders", n: 7,
    build: (c) => [
      poly(c.p),
      ray(c.p[2], c.p[4], { color: "#f23645" }),
      txt({ x: c.p[1].x, y: c.p[1].y - 14 }, "Left Shoulder", { align: "center", size: 11 }),
      txt({ x: c.p[3].x, y: c.p[3].y - 14 }, "Head", { align: "center", size: 11 }),
      txt({ x: c.p[5].x, y: c.p[5].y - 14 }, "Right Shoulder", { align: "center", size: 11 }),
    ],
  },
  { id: "abcd", label: "ABCD pattern", n: 4, build: (c) => pattern(c, ["A", "B", "C", "D"], [[0, 2], [1, 3]]) },
  {
    id: "trianglepattern", label: "Triangle pattern", n: 4,
    build: (c) => [poly([c.p[0], c.p[2], c.p[3], c.p[1]], { closed: true, fill: 0.08, noStroke: true }), poly(c.p), ray(c.p[0], c.p[2], { w: 1 }), ray(c.p[1], c.p[3], { w: 1 }), ...letters(c, ["A", "B", "C", "D"])],
  },
  { id: "threedrives", label: "Three drives pattern", n: 7, build: (c) => [poly(c.p), ...letters(c, ["0", "1", "2", "3", "4", "5", "6"])] },
  { id: "elliottimpulse", label: "Elliott impulse wave (1·2·3·4·5)", n: 6, build: (c) => [poly(c.p), ...letters(c, ["0", "1", "2", "3", "4", "5"], true)] },
  { id: "elliottcorrection", label: "Elliott correction wave (A·B·C)", n: 4, build: (c) => [poly(c.p), ...letters(c, ["0", "A", "B", "C"], true)] },
  { id: "elliotttriangle", label: "Elliott triangle wave (A·B·C·D·E)", n: 6, build: (c) => [poly(c.p), ...letters(c, ["0", "A", "B", "C", "D", "E"], true)] },
  { id: "elliottdouble", label: "Elliott double combo wave (W·X·Y)", n: 4, build: (c) => [poly(c.p), ...letters(c, ["0", "W", "X", "Y"], true)] },
  { id: "elliotttriple", label: "Elliott triple combo wave (W·X·Y·X·Z)", n: 6, build: (c) => [poly(c.p), ...letters(c, ["0", "W", "X", "Y", "X", "Z"], true)] },
  // Cycles
  {
    id: "cyclic", label: "Cyclic lines", n: 2, style: { width: 1 },
    build: (c) => {
      const dx = Math.abs(c.p[1].x - c.p[0].x) || 1;
      const out: Shape[] = [];
      for (let k = Math.floor(-c.p[0].x / dx); k <= Math.ceil((c.w - c.p[0].x) / dx) && out.length < 400; k++) {
        const x = c.p[0].x + k * dx;
        out.push(seg({ x, y: 0 }, { x, y: c.h }));
      }
      return out;
    },
  },
  {
    id: "timecycles", label: "Time cycles", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const dx = Math.abs(b.x - a.x) || 1;
      const out: Shape[] = [];
      for (let k = Math.floor(-a.x / dx); k <= Math.ceil((c.w - a.x) / dx) && out.length < 200; k++) {
        const cx = a.x + (k + 0.5) * dx;
        out.push(poly(arcPts({ x: cx, y: a.y }, dx / 2, Math.PI, Math.PI * 2).map((q) => ({ x: q.x, y: a.y + (q.y - a.y) * 0.6 })), { fill: 0.08 }));
      }
      return out;
    },
  },
  {
    id: "sine", label: "Sine line", n: 2,
    build: (c) => {
      const [a, b] = c.p;
      const dx = b.x - a.x || 1;
      const pts: Pt[] = [];
      for (let x = 0; x <= c.w; x += 3) pts.push({ x, y: a.y + (b.y - a.y) * Math.sin(((Math.PI / 2) * (x - a.x)) / dx) });
      return [poly(pts)];
    },
  },

  // Forecasting
  { id: "longpos", label: "Long position", n: 4, panel: "position", constrain: posConstrain(1), oneClick: (a, s, span) => posAt(a, s, 1, span), build: position },
  { id: "shortpos", label: "Short position", n: 4, panel: "position", constrain: posConstrain(-1), oneClick: (a, s, span) => posAt(a, s, -1, span), build: position },
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
    id: "avwap", label: "Anchored VWAP", n: 1,
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
  { id: "frvp", label: "Fixed range volume profile", n: 2, panel: "volume", build: (c) => volumeProfile(c, span(c).t0, span(c).t1) },
  { id: "avp", label: "Anchored volume profile", n: 1, panel: "volume", build: (c) => volumeProfile(c, pt(c, 0).time, c.bars[c.bars.length - 1]?.t ?? pt(c, 0).time, true) },
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
  { id: "arrow", label: "Arrow", n: 2, build: (c) => [seg(c.p[0], c.p[1]), head(c.p[0], c.p[1], 10 + c.d.width * 2)] },
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
  { id: "rect", label: "Rectangle", n: 2, build: (c) => [poly([c.p[0], { x: c.p[1].x, y: c.p[0].y }, c.p[1], { x: c.p[0].x, y: c.p[1].y }], { closed: true, fill: 0.15 })] },
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
    id: "ellipse", label: "Ellipse", n: 2,
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
  { id: "note", label: "Note", n: 2, prompt: "Note", oneClick: (a, s) => [a, offsetPt(a, s, 8, 0.002)], build: (c) => noteShapes(c, c.d.text ?? "Note") },
  { id: "pricenote", label: "Price note", n: 2, oneClick: (a, s) => [a, offsetPt(a, s, 8, 0.002)], build: (c) => noteShapes(c, c.fp(c.d.points[0].price)) },
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
  { id: "callout", label: "Callout", n: 2, prompt: "Callout", oneClick: (a, s) => [a, offsetPt(a, s, 8, 0.002)], build: (c) => noteShapes(c, c.d.text ?? "Callout") },
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
