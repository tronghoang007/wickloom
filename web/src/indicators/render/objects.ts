import type {
    IPrimitivePaneRenderer,
    IPrimitivePaneView,
    IChartApiBase,
    ISeriesApi,
    ISeriesPrimitive,
    Logical,
    SeriesAttachedParameter,
    SeriesType,
    Time,
} from "lightweight-charts";
import type { LabelSize, LabelStyle, LineStyleName, ObjBubble, ObjLine, ObjectSet } from "../schema";

/** Cỡ chữ (px) của `size.*` trong Pine: xấp xỉ, chỉnh lại khi so với TV. */
export const LABEL_PX: Record<LabelSize, number> = { tiny: 8, small: 10, normal: 12, large: 16, huge: 24 };

export type Seg = { x1: number; y1: number; x2: number; y2: number };

/** Kéo dài đoạn thẳng theo hướng của nó tới mép `left` / `right` (cùng đơn vị với đoạn). Đoạn đứng không kéo được theo x. */
export function extendSegment(s: Seg, ext: NonNullable<ObjLine["extend"]>, left: number, right: number): Seg {
  if (ext === "none" || s.x1 === s.x2) return s;
  const [a, b] = s.x1 <= s.x2 ? [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }] : [{ x: s.x2, y: s.y2 }, { x: s.x1, y: s.y1 }];
  const m = (b.y - a.y) / (b.x - a.x);
  if ((ext === "left" || ext === "both") && left < a.x) {
    a.y += m * (left - a.x);
    a.x = left;
  }
  if ((ext === "right" || ext === "both") && right > b.x) {
    b.y += m * (right - b.x);
    b.x = right;
  }
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** Toạ độ ngang của chỉ số nến lẻ `v`: LWC chỉ đổi được chỉ số nguyên (số lẻ trả về 0, tức mép trái), nên nội suy giữa hai chỉ số nguyên liền kề (`at` = đổi chỉ số nguyên ra toạ độ). */
export function fractionalX(at: (i: number) => number | null, v: number): number | null {
  const i = Math.floor(v);
  const a = at(i);
  if (v === i) return a;
  const b = at(i + 1);
  return a === null || b === null ? null : a + (b - a) * (v - i);
}

/** Khung chữ: tâm (x, y) và kích thước, cùng đơn vị. */
export type TextBox = { x: number; y: number; w: number; h: number };

/** Chọn nhãn nào được vẽ: duyệt theo thứ tự ưu tiên (bubble lớn trước), bỏ nhãn đè lên một nhãn đã chọn, để các bubble chồng nhau vẫn còn một số đọc được. `true` = vẽ. */
export function pickLabels(boxes: TextBox[]): boolean[] {
  const kept: TextBox[] = [];
  return boxes.map((b) => {
    const hit = kept.some((k) => Math.abs(k.x - b.x) * 2 < k.w + b.w && Math.abs(k.y - b.y) * 2 < k.h + b.h);
    if (!hit) kept.push(b);
    return !hit;
  });
}

export type LabelLayout = {
  bubble: { x: number; y: number; w: number; h: number } | null; // null: chỉ có chữ
  pointer: [number, number][] | null; // tam giác chỉ vào điểm neo
  textX: number; // tâm chữ
  textY: number;
};

/** Bố cục label quanh điểm neo (px,py): bubble + mũi nhọn theo `style` như `label.style_label_*`. `font` là cỡ chữ, `textW` bề rộng chữ cùng đơn vị. */
export function layoutLabel(px: number, py: number, textW: number, font: number, style: LabelStyle): LabelLayout {
  const padX = Math.round(font * 0.5);
  const padY = Math.round(font * 0.35);
  const tip = Math.round(font * 0.5); // chiều cao mũi nhọn
  const w = textW + 2 * padX;
  const h = font + 2 * padY;
  const at = (x: number, y: number): Pick<LabelLayout, "bubble" | "textX" | "textY"> => ({ bubble: { x, y, w, h }, textX: x + w / 2, textY: y + h / 2 });
  switch (style) {
    case "down": {
      const b = at(px - w / 2, py - tip - h);
      return { ...b, pointer: [[px - tip, py - tip], [px + tip, py - tip], [px, py]] };
    }
    case "up": {
      const b = at(px - w / 2, py + tip);
      return { ...b, pointer: [[px - tip, py + tip], [px + tip, py + tip], [px, py]] };
    }
    case "left": {
      const b = at(px + tip, py - h / 2);
      return { ...b, pointer: [[px + tip, py - tip], [px + tip, py + tip], [px, py]] };
    }
    case "right": {
      const b = at(px - tip - w, py - h / 2);
      return { ...b, pointer: [[px - tip, py - tip], [px - tip, py + tip], [px, py]] };
    }
    case "center":
      return { ...at(px - w / 2, py - h / 2), pointer: null };
    default:
      return { bubble: null, pointer: null, textX: px, textY: py };
  }
}

const isClear = (c: string | undefined): c is undefined | "" => !c;

/** Nét đứt/chấm theo độ dày `w` (px bitmap). */
const dash = (style: LineStyleName | undefined, w: number): number[] => (style === "dashed" ? [6 * w, 6 * w] : style === "dotted" ? [w, 3 * w] : []);

/** Vẽ line / label / box của một indicator (xem `ObjectSet`). Gắn vào series neo nên theo thang giá của indicator; chỉ vẽ phần nằm trong khung nhìn. */
export class ObjectsPrimitive implements ISeriesPrimitive<Time> {
  private data: ObjectSet | null = null;
  private chart: IChartApiBase<Time> | null = null;
  private series: ISeriesApi<SeriesType> | null = null;
  private redraw: (() => void) | null = null;

  attached(p: SeriesAttachedParameter<Time>) {
    this.chart = p.chart;
    this.series = p.series;
    this.redraw = p.requestUpdate;
  }
  detached() {
    this.chart = null;
    this.series = null;
    this.redraw = null;
  }

  set(data: ObjectSet | null) {
    this.data = data;
    this.redraw?.();
  }

  paneViews(): readonly IPrimitivePaneView[] {
    return [this.view];
  }

  // z của object so với nến chưa chốt với TV: tạm vẽ trên cùng (box có nền trong suốt nên vẫn thấy nến)
  private view: IPrimitivePaneView = {
    zOrder: () => "top",
    renderer: (): IPrimitivePaneRenderer => ({
      draw: (target) => {
        const d = this.data;
        const chart = this.chart;
        const series = this.series;
        if (!d || !chart || !series) return;
        const ts = chart.timeScale();
        const X = (i: number) => ts.logicalToCoordinate(i as Logical);
        const Y = (p: number) => series.priceToCoordinate(p);
        target.useBitmapCoordinateSpace(({ context: ctx, bitmapSize, horizontalPixelRatio: hpr, verticalPixelRatio: vpr }) => {
          for (const b of d.boxes) {
            const xa = X(b.x1), xb = X(b.x2), ya = Y(b.y1), yb = Y(b.y2);
            if (xa === null || xb === null || ya === null || yb === null) continue;
            const left = Math.min(xa, xb) * hpr;
            const right = b.extendRight ? bitmapSize.width : Math.max(xa, xb) * hpr;
            const top = Math.min(ya, yb) * vpr;
            const height = Math.abs(yb - ya) * vpr;
            if (right < 0 || left > bitmapSize.width) continue;
            if (!isClear(b.bg)) {
              ctx.fillStyle = b.bg;
              ctx.fillRect(left, top, right - left, height);
            }
            if (!isClear(b.border)) {
              const w = Math.max(1, Math.round((b.borderWidth ?? 1) * hpr));
              ctx.strokeStyle = b.border;
              ctx.lineWidth = w;
              ctx.setLineDash(dash(b.borderStyle, w));
              ctx.strokeRect(left + w / 2, top + w / 2, Math.max(0, right - left - w), Math.max(0, height - w));
            }
          }
          for (const l of d.lines) {
            const xa = X(l.x1), xb = X(l.x2), ya = Y(l.y1), yb = Y(l.y2);
            if (xa === null || xb === null || ya === null || yb === null) continue;
            const s = extendSegment({ x1: xa * hpr, y1: ya * vpr, x2: xb * hpr, y2: yb * vpr }, l.extend ?? "none", 0, bitmapSize.width);
            if (Math.max(s.x1, s.x2) < 0 || Math.min(s.x1, s.x2) > bitmapSize.width) continue;
            const w = Math.max(1, Math.round((l.width ?? 1) * hpr));
            ctx.strokeStyle = l.color;
            ctx.lineWidth = w;
            ctx.setLineDash(dash(l.style, w));
            ctx.beginPath();
            ctx.moveTo(s.x1, s.y1);
            ctx.lineTo(s.x2, s.y2);
            ctx.stroke();
          }
          ctx.setLineDash([]);
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          for (const l of d.labels) {
            const x = X(l.x), y = Y(l.y);
            if (x === null || y === null || x < -200 || x > bitmapSize.width / hpr + 200) continue;
            const font = Math.round(LABEL_PX[l.size ?? "small"] * vpr);
            ctx.font = `${font}px -apple-system, "Trebuchet MS", sans-serif`;
            const lay = layoutLabel(x * hpr, y * vpr, ctx.measureText(l.text).width, font, l.style ?? "none");
            if (lay.bubble && !isClear(l.bg)) {
              ctx.fillStyle = l.bg;
              ctx.fillRect(lay.bubble.x, lay.bubble.y, lay.bubble.w, lay.bubble.h);
              if (lay.pointer) {
                ctx.beginPath();
                lay.pointer.forEach(([px, py], k) => (k ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
                ctx.closePath();
                ctx.fill();
              }
            }
            ctx.fillStyle = l.color;
            ctx.fillText(l.text, lay.textX, lay.textY);
          }
          const numbers: { b: ObjBubble; x: number; y: number }[] = [];
          for (const b of d.bubbles ?? []) {
            const x = fractionalX(X, b.x), y = Y(b.y); // x lẻ: bubble nằm đúng phút trong nến
            if (x === null || y === null || x < -b.r || x > bitmapSize.width / hpr + b.r) continue;
            const r = b.r * hpr;
            ctx.beginPath();
            ctx.arc(x * hpr, y * vpr, r, 0, 2 * Math.PI);
            ctx.fillStyle = b.bg;
            ctx.fill();
            if (!isClear(b.border)) {
              ctx.lineWidth = Math.max(1, Math.round((b.borderWidth ?? 1) * hpr));
              ctx.strokeStyle = b.border;
              ctx.stroke();
            }
            if (b.text) numbers.push({ b, x: x * hpr, y: y * vpr });
          }
          // Số vẽ sau mọi vòng tròn (không bị bubble nhỏ hơn nằm trên che) với cỡ chữ cố định (Text Size như DeepCharts), bubble nhỏ hơn chữ thì chữ tràn ra ngoài;
          // bubble chồng nhau (phút khác nhau cùng row) chỉ giữ số của bubble lớn nhất
          const fonts = numbers.map(({ b }) => `${Math.round((b.textSize ?? 11) * vpr)}px -apple-system, "Trebuchet MS", sans-serif`);
          const boxes = numbers.map(({ b, x, y }, i) => {
            ctx.font = fonts[i];
            return { x, y, w: ctx.measureText(b.text ?? "").width, h: (b.textSize ?? 11) * vpr };
          });
          const show = pickLabels(boxes);
          numbers.forEach(({ b, x, y }, i) => {
            if (!show[i]) return;
            ctx.font = fonts[i];
            ctx.fillStyle = b.textColor ?? "#ffffff";
            ctx.fillText(b.text ?? "", x, y);
          });
        });
      },
    }),
  };
}
