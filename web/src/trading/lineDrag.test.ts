import { describe, expect, it } from "vitest";
import { hitLine } from "./lineDrag";

describe("hitLine", () => {
  const lines = [{ id: "o:1", y: 100 }, { id: "d:sl", y: 140 }];
  it("trong ngưỡng thì trúng đường đó", () => {
    expect(hitLine(100, lines)).toBe("o:1");
    expect(hitLine(104, lines)).toBe("o:1");
    expect(hitLine(136, lines)).toBe("d:sl");
  });
  it("ngoài ngưỡng thì không trúng gì", () => {
    expect(hitLine(120, lines)).toBeNull();
    expect(hitLine(107, lines, 6)).toBeNull();
    expect(hitLine(50, [])).toBeNull();
  });
  it("hai đường sát nhau: lấy đường gần con trỏ hơn", () => {
    const close = [{ id: "a", y: 100 }, { id: "b", y: 108 }];
    expect(hitLine(103, close)).toBe("a");
    expect(hitLine(105, close)).toBe("b");
  });
  it("ngưỡng tuỳ chỉnh", () => {
    expect(hitLine(110, lines, 12)).toBe("o:1");
  });
});
