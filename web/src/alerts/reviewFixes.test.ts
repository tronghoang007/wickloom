import type { Alert, ChannelsInfo } from "@/lib/alertsApi";
import { describe, expect, it } from "vitest";
import { checkForm, defaultForm, expiryOf, formFromAlert, inputAt, mt5Blocked, parseInputAt } from "./model";

// Hồi quy cho review 2026-10-28: ô hạn "Custom" theo múi giờ của Settings (không phải giờ máy), kênh MT5 chỉ cho chủ máy.

const info = (mt5: Partial<ChannelsInfo["mt5"]> & { allowed?: boolean }): ChannelsInfo =>
  ({ web: {}, telegram: { configured: true, linked: true, name: null }, mt5: { online: true, version: "2.19", supports: true, push_enabled: true, ...mt5 } }) as ChannelsInfo;

describe("hạn Custom theo múi giờ của Settings", () => {
  const t = Date.UTC(2026, 9, 28, 15, 0) / 1000; // 15:00 UTC = 22:00 giờ VN

  it("hiện và đọc giờ treo tường của múi giờ đã chọn", () => {
    expect(inputAt(t, "Asia/Ho_Chi_Minh")).toBe("2026-10-28T22:00");
    expect(inputAt(t, "Etc/UTC")).toBe("2026-10-28T15:00");
    expect(parseInputAt("2026-10-28T22:00", "Asia/Ho_Chi_Minh")).toBe(t);
    expect(parseInputAt("2026-10-28T15:00", "Etc/UTC")).toBe(t);
    expect(parseInputAt("", "Etc/UTC")).toBeNaN();
  });

  it("đổi giờ mùa hè: lệch giờ lấy tại chính thời điểm hết hạn", () => {
    const summer = Date.UTC(2026, 6, 1, 12, 0) / 1000; // New York UTC-4
    const winter = Date.UTC(2026, 11, 1, 12, 0) / 1000; // New York UTC-5
    expect(parseInputAt(inputAt(summer, "America/New_York"), "America/New_York")).toBe(summer);
    expect(parseInputAt(inputAt(winter, "America/New_York"), "America/New_York")).toBe(winter);
  });

  it("form sửa alert giữ nguyên hạn khi lưu lại", () => {
    const a = { expires_at: t, cond: "cross", level: 1, symbol: "XAUUSDm", trigger: "once", tf: "M1", name: "", message: "", channels: { web: true, telegram: false, mt5: false }, drawing: null, indicator: null } as unknown as Alert;
    const f = formFromAlert(a, "Etc/UTC");
    expect(f.expiresAt).toBe("2026-10-28T15:00");
    expect(expiryOf(f, t - 3600, "Etc/UTC")).toBe(t);
  });
});

describe("kênh MT5 chỉ cho chủ máy", () => {
  it("backend báo allowed = false thì form chặn; backend cũ không báo thì không chặn", () => {
    expect(mt5Blocked(info({ allowed: false }))).toBe(true);
    expect(mt5Blocked(info({ allowed: true }))).toBe(false);
    expect(mt5Blocked(info({}))).toBe(false);
    expect(mt5Blocked(null)).toBe(false);
    const f = { ...defaultForm("XAUUSDm", 4000, "M1", { web: false, telegram: false, mt5: true }), level: "4000" };
    expect(checkForm(f, 0, [], info({ allowed: false })).errors.channels).toMatch(/chủ máy/);
    expect(checkForm(f, 0, [], info({ allowed: true })).input).not.toBeNull();
  });
});
