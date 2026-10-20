import type { Drawing } from "./types";

export type Pt = { x: number; y: number };

export type Shape =
  | { k: "line"; a: Pt; b: Pt; ext?: "none" | "right" | "both"; dash?: 0 | 1 | 2; w?: number; color?: string }
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
  | { k: "axis"; y: number; text: string; bg: string; color: string }
  | { k: "text"; at: Pt; text: string; size?: number; color?: string; bg?: string; border?: string; align?: "left" | "center" | "right" };

const HIT = 6;
const BIG = 20000;

const dashArr = (d?: number) => (d === 1 ? [8, 6] : d === 2 ? [2, 4] : []);

function lineEnds(s: Extract<Shape, { k: "line" }>): [Pt, Pt] {
  const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = (dx / len) * BIG, uy = (dy / len) * BIG;
  const a = s.ext === "both" ? { x: s.a.x - ux, y: s.a.y - uy } : s.a;
  const b = s.ext === "right" || s.ext === "both" ? { x: s.b.x + ux, y: s.b.y + uy } : s.b;
  return [a, b];
}

function textBox(ctx: CanvasRenderingContext2D, s: Extract<Shape, { k: "text" }>) {
  const size = s.size ?? 12;
  ctx.font = `${size}px sans-serif`;
  const lines = s.text.split("\n");
  const lh = size * 1.3;
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width));
  const pad = s.bg || s.border ? 5 : 0;
  const h = lines.length * lh;
  const x0 = s.align === "center" ? s.at.x - w / 2 : s.align === "right" ? s.at.x - w : s.at.x;
  return { x: x0 - pad, y: s.at.y - h / 2 - pad, w: w + pad * 2, h: h + pad * 2, tx: x0, tw: w, lines, lh, top: s.at.y - h / 2 };
}

export function drawShapes(ctx: CanvasRenderingContext2D, shapes: Shape[], d: Drawing) {
  for (const s of shapes) {
    ctx.save();
    const color = ("color" in s && s.color) || d.color;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = ("w" in s && s.w) || d.width;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    const dash = "dash" in s && s.dash !== undefined ? s.dash : d.dash;
    ctx.setLineDash(dashArr(dash));

    if (s.k === "line") {
      const [a, b] = lineEnds(s);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    } else if (s.k === "poly") {
      if (s.pts.length < 2) { ctx.restore(); continue; }
      ctx.beginPath();
      ctx.moveTo(s.pts[0].x, s.pts[0].y);
      for (let i = 1; i < s.pts.length; i++) ctx.lineTo(s.pts[i].x, s.pts[i].y);
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
      const b = textBox(ctx, s);
      if (s.bg) {
        ctx.fillStyle = s.bg;
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, 4);
        ctx.fill();
      }
      if (s.border) {
        ctx.strokeStyle = s.border;
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.roundRect(b.x, b.y, b.w, b.h, 4);
        ctx.stroke();
      }
      ctx.fillStyle = s.color ?? (s.bg ? "#fff" : d.textColor ?? d.color);
      ctx.textBaseline = "middle";
      ctx.textAlign = s.align === "center" ? "center" : "left";
      const tx = s.align === "center" ? b.tx + b.tw / 2 : b.tx;
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
      const lines = s.text.split("\n");
      const w = Math.max(...lines.map((l) => l.length)) * (s.size ?? 12) * 0.6;
      const size = (s.size ?? 12) * 1.3 * lines.length;
      const x0 = s.align === "center" ? s.at.x - w / 2 : s.align === "right" ? s.at.x - w : s.at.x;
      if (p.x >= x0 - 4 && p.x <= x0 + w + 4 && Math.abs(p.y - s.at.y) <= size / 2 + 4) return true;
    }
  }
  return false;
}
