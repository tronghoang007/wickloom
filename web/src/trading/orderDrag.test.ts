import { describe, expect, it } from "vitest";
import { hitLine } from "./orderDrag";

describe("hitLine", () => {
  const lines = [{ ticket: 1, y: 100 }, { ticket: 2, y: 140 }];
  it("trong ngưỡng thì trúng đường đó", () => {
    expect(hitLine(100, lines)).toBe(1);
    expect(hitLine(104, lines)).toBe(1);
    expect(hitLine(136, lines)).toBe(2);
  });
  it("ngoài ngưỡng thì không trúng gì", () => {
    expect(hitLine(120, lines)).toBeNull();
    expect(hitLine(107, lines, 6)).toBeNull();
    expect(hitLine(50, [])).toBeNull();
  });
  it("hai đường sát nhau: lấy đường gần con trỏ hơn", () => {
    const close = [{ ticket: 1, y: 100 }, { ticket: 2, y: 108 }];
    expect(hitLine(103, close)).toBe(1);
    expect(hitLine(105, close)).toBe(2);
  });
  it("ngưỡng tuỳ chỉnh", () => {
    expect(hitLine(110, lines, 12)).toBe(1);
  });
});
