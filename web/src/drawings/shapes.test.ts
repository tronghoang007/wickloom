import { describe, expect, it } from "vitest";
import { hitShapes, textBox, type Shape } from "./shapes";

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
