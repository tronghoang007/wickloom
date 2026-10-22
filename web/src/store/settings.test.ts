import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings } from "./settings";

describe("mergeSettings", () => {
  it("field mới lấy mặc định, setting đã lưu được giữ", () => {
    const s = mergeSettings({ fontSize: 15 });
    expect(s.fontSize).toBe(15);
    expect(s.oneClick).toBe(false);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it("confirmClose=false của bản thử trước thành One-click trading bật; có oneClick rồi thì không đè", () => {
    expect(mergeSettings({ confirmClose: false }).oneClick).toBe(true);
    expect(mergeSettings({ confirmClose: true }).oneClick).toBe(false);
    expect(mergeSettings({ confirmClose: false, oneClick: false }).oneClick).toBe(false);
  });
});
