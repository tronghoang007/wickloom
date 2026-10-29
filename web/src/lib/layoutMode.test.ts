import { describe, expect, it } from "vitest";
import { DESKTOP_MIN, TABLET_MIN, layoutModeFor } from "./layoutMode";

describe("layoutModeFor", () => {
  it("điện thoại dọc / ngang nhỏ là phone", () => {
    expect(layoutModeFor(320)).toBe("phone");
    expect(layoutModeFor(390)).toBe("phone");
    expect(layoutModeFor(TABLET_MIN - 1)).toBe("phone");
  });

  it("từ 768px đến dưới 1280px là tablet", () => {
    expect(layoutModeFor(TABLET_MIN)).toBe("tablet");
    expect(layoutModeFor(1024)).toBe("tablet");
    expect(layoutModeFor(DESKTOP_MIN - 1)).toBe("tablet");
  });

  it("từ 1280px trở lên là desktop", () => {
    expect(layoutModeFor(DESKTOP_MIN)).toBe("desktop");
    expect(layoutModeFor(1440)).toBe("desktop");
  });

  it("mốc trùng breakpoint md / xl mặc định của Tailwind", () => {
    expect(TABLET_MIN).toBe(768);
    expect(DESKTOP_MIN).toBe(1280);
  });
});
