import { describe as suite, expect, it } from "vitest";
import type { Alert, ChannelsInfo } from "@/lib/alertsApi";
import { specFromInstance } from "./indicatorSpec";
import { checkForm, defaultForm, describe, expiryOf, failedChannels, fireNotice, formFromAlert, indicatorTriggerHint, lineAlerts, liveCount, sortAlerts, type AlertForm } from "./model";

const NOW = 1_800_000_000;
const CH = { web: true, telegram: false, mt5: false };
const base = (): AlertForm => ({ ...defaultForm("XAUUSDm", 4000.5, "M5", CH, 2), level: "4000.5" });
const alert = (o: Partial<Alert> = {}): Alert => ({
  id: "a", symbol: "XAUUSDm", cond: "cross", level: 4000.5, trigger: "once", tf: "M1", expires_at: null, name: "", message: "", channels: CH, state: "active", created_at: NOW, fired_at: null, fire_count: 0, drawing: null, indicator: null, ...o,
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

  it("labels a late fire in the notice", () => {
    const a = alert({ name: "Gold", message: "look" });
    expect(fireNotice(a, 4000.5, 2)).toEqual({ title: "Gold", text: "XAUUSDm Crossing 4,000.5 (price 4,000.5) — look" });
    expect(fireNotice(a, 4000.5, 2, true).text).toBe("(trễ) XAUUSDm Crossing 4,000.5 (price 4,000.5) — look");
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

suite("indicator alerts", () => {
  const rsi = () => specFromInstance({ id: "rsi", inputs: {} })!;
  const form = (over: Partial<AlertForm> = {}): AlertForm => ({ ...defaultForm("XAUUSDm", 70, "M15", CH, 2, null, rsi()), ...over });

  it("starts on a closed bar, like TradingView, on the chart's timeframe", () => {
    const f = form();
    expect(f).toMatchObject({ trigger: "once_per_bar_close", tf: "M15", level: "70", cond: "cross" });
    expect(f.indicator?.id).toBe("rsi");
    expect(defaultForm("X", 1, "M15", CH).trigger).toBe("once"); // alert giá thường không đổi
  });

  it("sends the indicator with the form and needs a value only when comparing with one", () => {
    const ok = checkForm(form({ level: "70" }), NOW, [], null);
    expect(ok.errors).toEqual({});
    expect(ok.input).toMatchObject({ symbol: "XAUUSDm", cond: "cross", level: 70, trigger: "once_per_bar_close", tf: "M15", indicator: { id: "rsi", plot: "rsi", vs: "level" } });
    expect(checkForm(form({ level: "" }), NOW, [], null).errors.level).toBeTruthy();
    const vsPrice = { ...rsi(), vs: "price" };
    const c = checkForm(form({ level: "", indicator: vsPrice }), NOW, [], null);
    expect(c.errors).toEqual({});
    expect(c.input?.level).toBe(0); // không dùng nhưng backend cần một số hữu hạn
  });

  it("rejects a timeframe the backend cannot build and a Smoothing line that has no numbers", () => {
    expect(checkForm(form({ tf: "MN1" }), NOW, [], null).errors.indicator).toContain("MN1");
    const sm = { ...rsi(), plot: "sm", inputs: { ...rsi().inputs, smoothType: "None" } };
    expect(checkForm(form({ indicator: sm }), NOW, [], null).errors.indicator).toContain("Smoothing");
  });

  it("is described like the backend text", () => {
    const a = alert({ cond: "cross_up", level: 70, indicator: rsi() });
    expect(describe(a, 2)).toBe("XAUUSDm RSI 14 close Crossing up 70");
    expect(describe({ ...a, indicator: { ...rsi(), vs: "price" } }, 2)).toBe("XAUUSDm RSI 14 close Crossing up Price");
    const macd = specFromInstance({ id: "macd", inputs: {} })!;
    expect(describe({ ...a, cond: "cross", indicator: macd }, 2)).toBe("XAUUSDm MACD close 12 26 9 EMA EMA Crossing Signal");
  });

  it("round-trips through the edit form", () => {
    const a = alert({ indicator: rsi(), trigger: "once_per_bar_close", tf: "M15" });
    expect(formFromAlert(a).indicator).toEqual(rsi());
  });

  it("never draws a price line for it on the chart", () => {
    expect(lineAlerts([alert({ id: "p" }), alert({ id: "i", indicator: rsi() })], "XAUUSDm").map((x) => x.id)).toEqual(["p"]);
  });

  it("puts the indicator value in the notice, and marks a late fire", () => {
    const a = { ...alert({ cond: "cross_up", level: 70, indicator: rsi() }), now: [70.4123456, 70] as [number, number] };
    expect(fireNotice(a, 4001.5, 2).text).toBe("XAUUSDm RSI 14 close Crossing up 70 (70.4123) (price 4,001.5)");
    expect(fireNotice(a, 4001.5, 2, true).text.startsWith("(trễ) ")).toBe(true);
  });

  it("explains the two kinds of trigger", () => {
    expect(indicatorTriggerHint("once_per_bar_close")).toContain("nến vừa đóng");
    expect(indicatorTriggerHint("once")).toContain("nến đang chạy");
  });
});
