import { describe, expect, it } from "vitest";
import { extendSegment, layoutLabel } from "./objects";

describe("extendSegment", () => {
  const s = { x1: 100, y1: 50, x2: 200, y2: 100 }; // dốc 0.5

  it("none giữ nguyên", () => {
    expect(extendSegment(s, "none", 0, 1000)).toBe(s);
  });
  it("right kéo theo độ dốc tới mép phải", () => {
    expect(extendSegment(s, "right", 0, 400)).toEqual({ x1: 100, y1: 50, x2: 400, y2: 200 });
  });
  it("left kéo tới mép trái", () => {
    expect(extendSegment(s, "left", 0, 400)).toEqual({ x1: 0, y1: 0, x2: 200, y2: 100 });
  });
  it("both kéo hai đầu; đầu vào ngược chiều vẫn đúng", () => {
    const r = extendSegment({ x1: 200, y1: 100, x2: 100, y2: 50 }, "both", 0, 400);
    expect(r).toEqual({ x1: 0, y1: 0, x2: 400, y2: 200 });
  });
  it("đoạn đã vượt mép thì không bị co lại", () => {
    expect(extendSegment(s, "right", 0, 150)).toEqual({ x1: 100, y1: 50, x2: 200, y2: 100 });
  });
  it("đoạn đứng không kéo theo x", () => {
    const v = { x1: 100, y1: 0, x2: 100, y2: 80 };
    expect(extendSegment(v, "both", 0, 400)).toBe(v);
  });
});

describe("layoutLabel", () => {
  const font = 10;
  const w = 40;

  it("down: bubble nằm trên điểm neo, mũi nhọn chỉ xuống điểm", () => {
    const l = layoutLabel(100, 100, w, font, "down");
    expect(l.bubble!.y + l.bubble!.h).toBeLessThan(100);
    expect(l.bubble!.x + l.bubble!.w / 2).toBeCloseTo(100);
    expect(l.pointer![2]).toEqual([100, 100]);
    expect(l.textY).toBeLessThan(100);
  });
  it("up: bubble nằm dưới điểm neo", () => {
    const l = layoutLabel(100, 100, w, font, "up");
    expect(l.bubble!.y).toBeGreaterThan(100);
    expect(l.pointer![2]).toEqual([100, 100]);
  });
  it("left: bubble nằm bên phải điểm neo (mũi nhọn quay sang trái)", () => {
    const l = layoutLabel(100, 100, w, font, "left");
    expect(l.bubble!.x).toBeGreaterThan(100);
    expect(l.bubble!.y + l.bubble!.h / 2).toBeCloseTo(100);
    expect(l.textX).toBeGreaterThan(100);
  });
  it("right: bubble nằm bên trái điểm neo", () => {
    const l = layoutLabel(100, 100, w, font, "right");
    expect(l.bubble!.x + l.bubble!.w).toBeLessThan(100);
  });
  it("center: bubble ngay giữa điểm neo, không mũi nhọn", () => {
    const l = layoutLabel(100, 100, w, font, "center");
    expect(l.pointer).toBeNull();
    expect(l.textX).toBeCloseTo(100);
    expect(l.textY).toBeCloseTo(100);
  });
  it("none: chỉ có chữ tại điểm neo", () => {
    expect(layoutLabel(100, 100, w, font, "none")).toEqual({ bubble: null, pointer: null, textX: 100, textY: 100 });
  });
  it("bubble rộng hơn chữ (có padding)", () => {
    expect(layoutLabel(0, 0, w, font, "center").bubble!.w).toBeGreaterThan(w);
  });
});
