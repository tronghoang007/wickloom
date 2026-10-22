import { describe, expect, it } from "vitest";
import type { Mt5Account } from "@/lib/mt5Api";
import { tradeBlock, webTrading, type GateInput } from "./gate";

const acc = { id: "S:1", mode: "demo", online: true, active: true, ea_trading: true, trade_allowed: true, terminal_trade_allowed: true } as Mt5Account;
const ok: GateInput = { replay: false, status: "user", loaded: true, account: acc, spec: { min: 0.01, max: 1, step: 0.01 }, hasQuote: true };
const block = (o: Partial<GateInput> = {}, a: Partial<Mt5Account> = {}) => tradeBlock({ ...ok, ...o, account: o.account === undefined && "account" in o ? undefined : { ...acc, ...a } });

describe("tradeBlock", () => {
  it("đủ điều kiện → null", () => expect(block()).toBeNull());

  it("Replay chặn trước mọi thứ, kể cả với khách", () => {
    expect(block({ replay: true })).toMatch(/Replay/);
    expect(block({ replay: true, status: "guest" })).toMatch(/Replay/);
  });

  it("khách: không chặn (bấm sẽ ra popup đăng nhập); đang xác định đăng nhập thì chờ", () => {
    expect(block({ status: "guest", account: undefined, spec: null, hasQuote: false })).toBeNull();
    expect(block({ status: "loading" })).toMatch(/kết nối/);
  });

  it("chưa tải account / chưa có account / offline", () => {
    expect(block({ loaded: false })).toMatch(/Đang tải/);
    expect(tradeBlock({ ...ok, account: undefined })).toMatch(/Chưa có account/);
    expect(block({}, { online: false })).toMatch(/offline/);
  });

  it("T2: chỉ demo — real/contest/unknown bị chặn", () => {
    for (const mode of ["real", "contest", "unknown"] as const) expect(block({}, { mode })).toMatch(/demo/);
  });

  it("EA chưa bật giao dịch hoặc là EA cũ (thiếu cờ) → chặn", () => {
    expect(block({}, { ea_trading: false })).toMatch(/TradingEnabled/);
    expect(block({}, { ea_trading: undefined })).toMatch(/TradingEnabled/);
  });

  it("AutoTrading của terminal / account không cho giao dịch", () => {
    expect(block({}, { terminal_trade_allowed: false })).toMatch(/AutoTrading/);
    expect(block({}, { trade_allowed: false })).toMatch(/investor/);
    expect(block({}, { trade_allowed: undefined, terminal_trade_allowed: undefined })).toBeNull(); // chưa biết thì để backend/EA quyết
  });

  it("thiếu thông số lot hoặc giá", () => {
    expect(block({ spec: null })).toMatch(/thông số lot/);
    expect(block({ hasQuote: false })).toMatch(/Chưa có giá/);
  });
});

describe("webTrading", () => {
  it("giải thích trạng thái ở tab Account", () => {
    expect(webTrading({ ...acc, mode: "real" })).toMatch(/demo/);
    expect(webTrading({ ...acc, ea_trading: undefined })).toMatch(/EA ≥ 2\.12/);
    expect(webTrading({ ...acc, ea_trading: false, ea_version: "2.12" })).toBe("Tắt (TradingEnabled)");
    expect(webTrading({ ...acc, max_lot: 0.5 })).toBe("Bật · tối đa 0.5 lot/lệnh");
    expect(webTrading(acc)).toBe("Bật");
  });
});
