import { describe, expect, it } from "vitest";
import { drawShapes, hitShapes, textBox, type Shape } from "./shapes";

describe("hitShapes với text (lỗi #7)", () => {
  const label: Extract<Shape, { k: "text" }> = { k: "text", at: { x: 100, y: 50 }, text: "Target: 12.5\nR:R 2", align: "center", bg: "#000", size: 12 };

  it("hit-test dùng cùng hộp với lúc vẽ (gồm cả viền nền)", () => {
    const b = textBox(label);
    expect(hitShapes([label], { x: b.x + 1, y: b.y + 1 })).toBe(true);
    expect(hitShapes([label], { x: b.x + b.w - 1, y: b.y + b.h - 1 })).toBe(true);
    expect(hitShapes([label], { x: b.x + b.w + 10, y: 50 })).toBe(false);
    expect(hitShapes([label], { x: 100, y: b.y - 10 })).toBe(false);
  });

  it("canh trái/giữa/phải theo điểm neo", () => {
    for (const align of ["left", "center", "right"] as const) {
      const s = { ...label, align, bg: undefined };
      const b = textBox(s);
      const cx = align === "left" ? b.x + b.w / 2 : align === "right" ? b.x + b.w / 2 : 100;
      expect(hitShapes([s], { x: cx, y: 50 })).toBe(true);
    }
    expect(textBox({ ...label, align: "left", bg: undefined }).x).toBe(100);
    const r = textBox({ ...label, align: "right", bg: undefined });
    expect(r.x + r.w).toBeCloseTo(100, 9);
  });

  it("chữ nhiều dòng: hộp cao theo số dòng", () => {
    const one = textBox({ ...label, text: "a" });
    const two = textBox({ ...label, text: "a\nb" });
    expect(two.h - one.h).toBeCloseTo(12 * 1.3, 9);
  });
});

describe("drawShapes bắt nét vào lưới pixel thiết bị", () => {
  // ctx giả: chỉ ghi lại tọa độ moveTo/lineTo và lineWidth
  const fakeCtx = () => {
    const pts: [number, number][] = [];
    const widths: number[] = [];
    const ctx = new Proxy({} as Record<string, unknown>, {
      get: (t, k) => {
        if (k === "moveTo" || k === "lineTo") return (x: number, y: number) => pts.push([x, y]);
        if (k in t) return t[k as string];
        return () => {};
      },
      set: (t, k, v) => { if (k === "lineWidth") widths.push(v); t[k as string] = v; return true; },
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, pts, widths };
  };
  const d = { id: "x", type: "hline", points: [], color: "#fff", width: 1, locked: false, hidden: false };

  it("nét ngang 1px ở DPR 1 nằm giữa pixel (x.5)", () => {
    const { ctx, pts } = fakeCtx();
    drawShapes(ctx, [{ k: "line", a: { x: 10.3, y: 20.2 }, b: { x: 90.7, y: 20.2 } }], d, 1);
    expect(pts).toEqual([[10.5, 20.5], [90.5, 20.5]]);
  });

  it("nét 1px ở DPR 2 nằm trên biên pixel thiết bị", () => {
    const { ctx, pts } = fakeCtx();
    drawShapes(ctx, [{ k: "line", a: { x: 10, y: 20.3 }, b: { x: 90, y: 20.3 } }], d, 2);
    expect(pts.map(([x, y]) => [x * 2, y * 2])).toEqual([[20, 41], [180, 41]]);
  });

  it("DPR 1.5: độ dày làm tròn ra số pixel thiết bị nguyên", () => {
    const { ctx, widths } = fakeCtx();
    drawShapes(ctx, [{ k: "line", a: { x: 0, y: 0 }, b: { x: 5, y: 9 } }], d, 1.5);
    expect(widths[0] * 1.5).toBe(2);
  });

  it("đường chéo không bị dịch", () => {
    const { ctx, pts } = fakeCtx();
    drawShapes(ctx, [{ k: "line", a: { x: 0.3, y: 0.3 }, b: { x: 5.2, y: 9.9 } }], d, 1);
    expect(pts).toEqual([[0.3, 0.3], [5.2, 9.9]]);
  });

  it("hình chữ nhật chỉ tô nền: bắt vào biên pixel", () => {
    const { ctx, pts } = fakeCtx();
    const r = [{ x: 1.4, y: 2.6 }, { x: 8.6, y: 2.6 }, { x: 8.6, y: 7.2 }, { x: 1.4, y: 7.2 }];
    drawShapes(ctx, [{ k: "poly", pts: r, closed: true, fill: 0.2, noStroke: true }], d, 1);
    expect(pts).toEqual([[1, 3], [9, 3], [9, 7], [1, 7]]);
  });
});
