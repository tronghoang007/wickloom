import { describe, expect, it } from "vitest";
import type { Mt5Account } from "./mt5Api";
import { MODE_COLOR, accountSub, accountTitle, badgeColor, fmtMoney, tradingTooltip } from "./mt5Format";

const acc = (o: Partial<Mt5Account> = {}): Mt5Account => ({
  id: "S:1", server: "Exness-MT5Trial17", broker: "Exness Technologies Ltd", login: 12345678, name: "Trong", mode: "demo", currency: "USD",
  leverage: 500, online: true, active: true, seen: 1, ...o,
});

describe("badgeColor", () => {
  it("đỏ = Real, xanh lá = Demo, xám khi offline hoặc chưa có/không rõ", () => {
    expect(badgeColor(acc({ mode: "real" }))).toBe("#f23645");
    expect(badgeColor(acc({ mode: "demo" }))).toBe("#089981");
    expect(badgeColor(acc({ mode: "real", online: false }))).toBe("#787b86"); // offline: xám, không báo REAL khi không chắc đang nối
    expect(badgeColor(acc({ mode: "unknown" }))).toBe(MODE_COLOR.unknown);
    expect(badgeColor(undefined)).toBe("#787b86");
  });
});

describe("accountTitle / fmtMoney / tradingTooltip", () => {
  it("tên hiển thị: tên chủ account; EA cũ (không tên) rơi về công ty rồi server", () => {
    expect(accountTitle(acc())).toBe("Trong");
    expect(accountTitle(acc({ name: "" }))).toBe("Exness Technologies Ltd");
    expect(accountTitle(acc({ name: "", broker: "" }))).toBe("Exness-MT5Trial17");
  });

  it("dòng 2: #login đứng đầu, rồi server, đòn bẩy, offline; EA cũ không có login/đòn bẩy", () => {
    expect(accountSub(acc())).toBe("#12345678 · Exness-MT5Trial17 · 1:500");
    expect(accountSub(acc({ online: false }))).toBe("#12345678 · Exness-MT5Trial17 · 1:500 · offline");
    expect(accountSub(acc({ login: null, leverage: null }))).toBe("Exness-MT5Trial17");
  });

  it("số dư 2 chữ số thập phân, dấu phẩy ngàn, kèm tiền tệ; thiếu → —", () => {
    expect(fmtMoney(10000, "USD")).toBe("10,000.00 USD");
    expect(fmtMoney(1234567.891, "")).toBe("1,234,567.89");
    expect(fmtMoney(undefined, "USD")).toBe("—");
  });

  it("tooltip avatar: account active, kèm Demo/Real và offline; rỗng khi chưa có account", () => {
    expect(tradingTooltip([])).toBe("");
    expect(tradingTooltip([acc()])).toBe("Trading: Exness-MT5Trial17 #12345678 (Demo)");
    expect(tradingTooltip([acc({ mode: "real", online: false })])).toBe("Trading: Exness-MT5Trial17 #12345678 (Real) — offline");
    expect(tradingTooltip([acc({ login: null, mode: "unknown" })])).toBe("Trading: Exness-MT5Trial17");
    expect(tradingTooltip([acc({ active: false })])).toBe("");
  });
});
