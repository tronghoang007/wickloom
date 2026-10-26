import { describe as suite, expect, it } from "vitest";
import type { Alert, ChannelsInfo } from "@/lib/alertsApi";
import { checkForm, defaultForm, describe, expiryOf, failedChannels, formFromAlert, lineAlerts, liveCount, sortAlerts, type AlertForm } from "./model";

const NOW = 1_800_000_000;
const CH = { web: true, telegram: false, mt5: false };
const base = (): AlertForm => ({ ...defaultForm("XAUUSDm", 4000.5, "M5", CH, 2), level: "4000.5" });
const alert = (o: Partial<Alert> = {}): Alert => ({
  id: "a", symbol: "XAUUSDm", cond: "cross", level: 4000.5, trigger: "once", tf: "M1", expires_at: null, name: "", message: "", channels: CH, state: "active", created_at: NOW, fired_at: null, fire_count: 0, ...o,
});
const tg = (linked: boolean): ChannelsInfo => ({ telegram: { configured: true, linked, name: null }, mt5: { online: false, version: null, supports: false, push_enabled: null } });

suite("defaultForm", () => {
  it("fills the price rounded to the symbol's digits and keeps a usable timeframe", () => {
    expect(defaultForm("EURUSD", 1.0850123456, "M5", CH, 5).level).toBe("1.08501");
    expect(defaultForm("EURUSD", null, "M5", CH).level).toBe("");
    expect(defaultForm("EURUSD", 1, "MN1", CH).tf).toBe("M1"); // backend không dựng được nến tháng
    expect(defaultForm("EURUSD", 1, "H4", CH).tf).toBe("H4");
  });

  it("copies the default channels instead of sharing the object", () => {
    const f = defaultForm("X", 1, "M1", CH);
    f.channels.mt5 = true;
    expect(CH.mt5).toBe(false);
  });
});

suite("checkForm", () => {
  it("builds the API input from a valid form", () => {
    const { input, errors } = checkForm({ ...base(), name: " Gold ", message: " hi " }, NOW, ["XAUUSDm"], null);
    expect(errors).toEqual({});
    expect(input).toEqual({ symbol: "XAUUSDm", cond: "cross", level: 4000.5, trigger: "once", tf: "M5", expires_at: null, name: "Gold", message: "hi", channels: CH });
  });

  it("accepts a decimal comma", () => {
    expect(checkForm({ ...base(), level: "4000,5" }, NOW, [], null).input?.level).toBe(4000.5);
  });

  it("rejects empty or non-numeric prices and unknown symbols", () => {
    expect(checkForm({ ...base(), level: "" }, NOW, [], null).errors.level).toBeTruthy();
    expect(checkForm({ ...base(), level: "abc" }, NOW, [], null).errors.level).toBeTruthy();
    expect(checkForm({ ...base(), level: "1e15" }, NOW, [], null).errors.level).toBeTruthy();
    expect(checkForm({ ...base(), symbol: "NOPE" }, NOW, ["XAUUSDm"], null).errors.symbol).toContain("NOPE");
    expect(checkForm({ ...base(), symbol: "NOPE" }, NOW, [], null).errors.symbol).toBeUndefined(); // chưa có danh sách symbol: không chặn
  });

  it("enforces text limits and at least one channel", () => {
    expect(checkForm({ ...base(), name: "x".repeat(61) }, NOW, [], null).errors.name).toBeTruthy();
    expect(checkForm({ ...base(), message: "x".repeat(201) }, NOW, [], null).errors.message).toBeTruthy();
    expect(checkForm({ ...base(), message: "x".repeat(200) }, NOW, [], null).input).not.toBeNull();
    expect(checkForm({ ...base(), channels: { web: false, telegram: false, mt5: false } }, NOW, [], null).errors.channels).toBeTruthy();
  });

  it("blocks Telegram until it is linked", () => {
    const f = { ...base(), channels: { web: true, telegram: true, mt5: false } };
    expect(checkForm(f, NOW, [], tg(false)).errors.channels).toContain("Telegram");
    expect(checkForm(f, NOW, [], tg(true)).input).not.toBeNull();
    expect(checkForm(f, NOW, [], null).input).not.toBeNull(); // chưa biết trạng thái kênh: để backend quyết
  });

  it("computes the expiry", () => {
    expect(checkForm({ ...base(), expiry: "7d" }, NOW, [], null).input?.expires_at).toBe(NOW + 7 * 86400);
    expect(checkForm({ ...base(), expiry: "custom", expiresAt: "" }, NOW, [], null).errors.expiry).toBeTruthy();
    expect(checkForm({ ...base(), expiry: "custom", expiresAt: "2001-01-01T00:00" }, NOW, [], null).errors.expiry).toContain("tương lai");
    const future = new Date((NOW + 3600) * 1000);
    const local = `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}-${String(future.getDate()).padStart(2, "0")}T${String(future.getHours()).padStart(2, "0")}:${String(future.getMinutes()).padStart(2, "0")}`;
    const got = checkForm({ ...base(), expiry: "custom", expiresAt: local }, NOW, [], null).input?.expires_at;
    expect(Math.abs((got ?? 0) - (NOW + 3600))).toBeLessThan(60); // ô nhập chỉ chính xác tới phút
  });
});

suite("form <-> alert", () => {
  it("round-trips an alert with a custom expiry", () => {
    const a = alert({ expires_at: NOW + 5 * 3600, name: "n", message: "m", trigger: "once_per_bar", tf: "H1" });
    const f = formFromAlert(a);
    expect(f).toMatchObject({ symbol: "XAUUSDm", level: "4000.5", expiry: "custom", trigger: "once_per_bar", tf: "H1", name: "n", message: "m" });
    expect(Math.abs((expiryOf(f, NOW) ?? 0) - a.expires_at!)).toBeLessThan(60);
    expect(formFromAlert(alert()).expiry).toBe("none");
  });
});

suite("helpers", () => {
  it("describes like the backend messages", () => {
    expect(describe({ symbol: "XAUUSDm", cond: "cross_up", level: 4000.5 }, 2)).toBe("XAUUSDm Crossing up 4,000.5");
  });

  it("counts live alerts and picks the ones drawn on a chart", () => {
    const list = [alert({ id: "1" }), alert({ id: "2", state: "paused" }), alert({ id: "3", state: "triggered" }), alert({ id: "4", symbol: "BTCUSDm" })];
    expect(liveCount(list)).toBe(3);
    expect(lineAlerts(list, "XAUUSDm").map((a) => a.id)).toEqual(["1", "2"]);
  });

  it("sorts live alerts first (newest first), then finished ones by when they fired", () => {
    const list = [
      alert({ id: "old", created_at: 1 }),
      alert({ id: "done1", state: "triggered", fired_at: 50 }),
      alert({ id: "new", created_at: 9 }),
      alert({ id: "done2", state: "expired", fired_at: 80 }),
    ];
    expect(sortAlerts(list).map((a) => a.id)).toEqual(["new", "old", "done2", "done1"]);
  });

  it("reports failed channels but not a closed browser tab", () => {
    expect(failedChannels({ web: "không có tab Wickloom nào đang mở", telegram: "ok" })).toEqual([]);
    expect(failedChannels({ telegram: "Telegram từ chối (403)", mt5: "EA offline", web: "ok" })).toEqual([
      { kind: "telegram", reason: "Telegram từ chối (403)" },
      { kind: "mt5", reason: "EA offline" },
    ]);
  });
});
