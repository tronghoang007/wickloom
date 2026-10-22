import { describe, expect, it } from "vitest";
import { withAlpha } from "./focus";

describe("withAlpha", () => {
  it("#rrggbb + độ đục → #rrggbbaa", () => {
    expect(withAlpha("#ff9800", 0.3)).toBe("#ff98004d");
    expect(withAlpha("#2962ff", 1)).toBe("#2962ffff");
    expect(withAlpha("#2962ff", 0)).toBe("#2962ff00");
  });
  it("kẹp độ đục vào [0, 1]; màu không phải #rrggbb thì giữ nguyên", () => {
    expect(withAlpha("#089981", 2)).toBe("#089981ff");
    expect(withAlpha("rgb(1,2,3)", 0.5)).toBe("rgb(1,2,3)");
  });
});
