import type { Drawing } from "./types";

export type Pt = { x: number; y: number };
export type Ext = "none" | "left" | "right" | "both"; // kéo dài đường qua đầu a (left) / đầu b (right)

export type Shape =
  | { k: "line"; a: Pt; b: Pt; ext?: Ext; dash?: 0 | 1 | 2; w?: number; color?: string }
  | {
      k: "poly";
      pts: Pt[];
      closed?: boolean;
      fill?: number; // alpha tô nền
      noStroke?: boolean;
      dash?: 0 | 1 | 2;
      w?: number;
      alpha?: number;
      color?: string;
    }
  | { k: "axis"; y: number; text: string; bg: string; color: string; always?: boolean; band?: boolean } // always: hiện cả khi không chọn; band: dải sáng giữa các nhãn band trên trục giá
  | {
      k: "text";
      at: Pt;
      text: string;
      size?: number;
      color?: string;
      bg?: string;
      border?: string;
      align?: "left" | "center" | "right";
      bold?: boolean;
      italic?: boolean;
      angle?: number; // radian, xoay quanh at (chữ chạy dọc theo trend line như TV)
      radius?: number; // bo góc ô nền (mặc định 4; Comment của TV bo tròn hẳn)
    };

const HIT = 6;
const TEXT_PAD = 3; // dung sai click quanh hộp chữ
const BIG = 20000;

const dashArr = (d?: number) => (d === 1 ? [8, 6] : d === 2 ? [2, 4] : []);

function lineEnds(s: Extract<Shape, { k: "line" }>): [Pt, Pt] {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = (dx / len) * BIG, uy = (dy / len) * BIG;
  const a = s.ext === "both" || s.ext === "left" ? { x: s.a.x - ux, y: s.a.y - uy } : s.a;
  const b = s.ext === "right" || s.ext === "both" ? { x: s.b.x + ux, y: s.b.y + uy } : s.b;
  return [a, b];
}

// Canvas riêng chỉ để đo chữ: vẽ và hit-test dùng chung 1 hộp (emoji, tiếng Việt đo đúng).
// Không có DOM (test) thì ước theo số ký tự.
let measurer: CanvasRenderingContext2D | null | undefined;
function textWidth(text: string, font: string, size: number) {
  if (measurer === undefined) measurer = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (!measurer) return text.length * size * 0.6;
  measurer.font = font;
  return measurer.measureText(text).width;
}

type TextShape = Extract<Shape, { k: "text" }>;

export function textBox(s: TextShape) {
  const size = s.size ?? 12;
  const font = `${s.italic ? "italic " : ""}${s.bold ? "bold " : ""}${size}px sans-serif`;
  const lines = s.text.split("\n");
  const lh = size * 1.3;
  const w = Math.max(...lines.map((l) => textWidth(l, font, size)));
  const pad = s.bg || s.border ? 5 : 0;
  const h = lines.length * lh;
  const x0 = s.align === "center" ? s.at.x - w / 2 : s.align === "right" ? s.at.x - w : s.at.x;
  return { x: x0 - pad, y: s.at.y - h / 2 - pad, w: w + pad * 2, h: h + pad * 2, tx: x0, tw: w, lines, lh, top: s.at.y - h / 2, font };
}

// Nét ngang/dọc và hình chữ nhật thẳng trục: bắt vào lưới pixel thiết bị để nét 1px không bị nhòe
// thành 2px mờ. pr = số pixel thiết bị trên 1 pixel CSS (ctx đã scale theo pr).
function pixelGrid(pr: number, width: number) {
  const dev = Math.max(1, Math.round(width * pr));
  const half = dev % 2 === 1;
  return {
    width: dev / pr,
    stroke: (v: number) => (half ? Math.floor(v * pr) + 0.5 : Math.round(v * pr)) / pr,
    fill: (v: number) => Math.round(v * pr) / pr,
  };
}

const axisAligned = (pts: Pt[], closed?: boolean) => {
  const n = pts.length;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    if (a.x !== b.x && a.y !== b.y) return false;
  }
  return true;
};

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], d: Drawing, pr = 1) {
  for (const s of shapes) {
    ctx.save();
    const color = ("color" in s && s.color) || d.color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    const grid = pixelGrid(pr, ("w" in s && s.w) || d.width);
    ctx.lineWidth = grid.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const dash = "dash" in s && s.dash !== undefined ? s.dash : d.dash;
    ctx.setLineDash(dashArr(dash));

    if (s.k === "line") {
      let [a, b] = lineEnds(s);
      if (a.x === b.x || a.y === b.y) {
        const q = (p: Pt) => ({ x: grid.stroke(p.x), y: grid.stroke(p.y) });
        [a, b] = [q(a), q(b)];
      }
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (s.k === "poly") {
      if (s.pts.length < 2) { ctx.restore(); continue; }
      let pts = s.pts;
      if (axisAligned(pts, s.closed)) {
        const f = s.noStroke ? grid.fill : grid.stroke;
        pts = pts.map((p) => ({ x: f(p.x), y: f(p.y) }));
      }
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
      if (s.closed) ctx.closePath();
      if (s.fill) {
        ctx.globalAlpha = s.fill;
        ctx.fill();
      }
      if (!s.noStroke) {
        ctx.globalAlpha = s.alpha ?? 1;
        ctx.stroke();
      }
    } else if (s.k === "text") {
      // chữ xoay: vẽ trong hệ tọa độ gốc tại at
      const t = s.angle ? { ...s, at: { x: 0, y: 0 } } : s;
      if (s.angle) {
        ctx.translate(s.at.x, s.at.y);
        ctx.rotate(s.angle);
      }
      const b = textBox(t);
      ctx.font = b.font;
      if (t.bg) {
        ctx.fillStyle = t.bg;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(t.radius ?? 4, b.h / 2));
        ctx.fill();
      }
      if (t.border) {
        ctx.strokeStyle = t.border;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(t.radius ?? 4, b.h / 2));
        ctx.stroke();
      }
      ctx.fillStyle = t.color ?? (t.bg ? "#fff" : d.textColor ?? d.color);
      ctx.textBaseline = "middle";
      ctx.textAlign = t.align === "center" ? "center" : "left";
      const tx = t.align === "center" ? b.tx + b.tw / 2 : b.tx;
      b.lines.forEach((line, i) => ctx.fillText(line, tx, b.top + b.lh * (i + 0.5)));
    }
    ctx.restore();
  }
}

function segDist(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function inPoly(p: Pt, pts: Pt[]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function hitShapes(shapes: Shape[], p: Pt): boolean {
  for (const s of shapes) {
    if (s.k === "line") {
      const [a, b] = lineEnds(s);
      if (segDist(p, a, b) <= HIT) return true;
    } else if (s.k === "poly") {
      const n = s.pts.length;
      if (!s.noStroke) {
        for (let i = 0; i < n - 1; i++) if (segDist(p, s.pts[i], s.pts[i + 1]) <= HIT) return true;
        if (s.closed && n > 2 && segDist(p, s.pts[n - 1], s.pts[0]) <= HIT) return true;
      }
      if (s.fill && s.closed && inPoly(p, s.pts)) return true;
    } else if (s.k === "text") {
      // chữ xoay: đưa điểm click về hệ tọa độ của chữ
      let q = p;
      if (s.angle) {
        const dx = p.x - s.at.x, dy = p.y - s.at.y, c = Math.cos(-s.angle), sn = Math.sin(-s.angle);
        q = { x: dx * c - dy * sn, y: dx * sn + dy * c };
      }
      const b = textBox(s.angle ? { ...s, at: { x: 0, y: 0 } } : s);
      if (q.x >= b.x - TEXT_PAD && q.x <= b.x + b.w + TEXT_PAD && q.y >= b.y - TEXT_PAD && q.y <= b.y + b.h + TEXT_PAD) return true;
    }
  }
  return false;
}
