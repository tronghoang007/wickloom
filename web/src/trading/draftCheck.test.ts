import { describe, expect, it } from "vitest";
import type { SymbolInfo } from "@/lib/api";
import type { Mt5Account } from "@/lib/mt5Api";
import type { Draft } from "./draft";
import { draftError, type DraftEnv } from "./draftCheck";

const sym = { name: "XAUUSDm", digits: 3, tick_size: 0.001, type: "metal", volume_min: 0.01, volume_max: 100, volume_step: 0.01, stops_level: 0 } as SymbolInfo;
const account = { id: "S:1", mode: "demo", online: true, active: true, ea_trading: true, trade_allowed: true, terminal_trade_allowed: true } as Mt5Account;
const env: DraftEnv = { sym, quote: { bid: 4130, ask: 4130.2 }, account, status: "user", loaded: true, nowSec: 1_000_000 };
const draft = (o: Partial<Draft> = {}): Draft => ({ symbol: "XAUUSDm", side: "buy", mode: "market", price: "", sl: "", tp: "", lot: "0.10", until: false, untilText: "", ...o });

describe("draftError", () => {
  it("market hợp lệ, có hoặc không SL/TP", () => {
    expect(draftError(draft(), env)).toBeNull();
    expect(draftError(draft({ sl: "4120", tp: "4140" }), env)).toBeNull();
  });
  it("chặn chung (real, EA tắt...) đi trước luật của lệnh", () => {
    expect(draftError(draft(), { ...env, account: { ...account, mode: "real" } })).toMatch(/demo/);
    expect(draftError(draft(), { ...env, account: { ...account, ea_trading: false } })).toMatch(/TradingEnabled/);
    expect(draftError(draft(), { ...env, quote: undefined })).toMatch(/Chưa có giá/);
  });
  it("market: SL sai phía", () => {
    expect(draftError(draft({ sl: "4135" }), env)).toMatch(/SL của lệnh Buy/);
  });
  it("lệnh chờ: cần giá vào hợp lệ, đúng phía SL/TP", () => {
    expect(draftError(draft({ mode: "pending", price: "" }), env)).toMatch(/Nhập giá/);
    expect(draftError(draft({ mode: "pending", price: "4120" }), env)).toBeNull();
    expect(draftError(draft({ mode: "pending", price: "4120", sl: "4125" }), env)).toMatch(/SL của lệnh Buy/);
    expect(draftError(draft({ mode: "pending", price: "4130.2" }), env)).toMatch(/bằng giá thị trường/);
  });
  it("hết hạn: bật mà chưa chọn giờ, hoặc ở quá khứ", () => {
    expect(draftError(draft({ mode: "pending", price: "4120", until: true }), env)).toMatch(/hết hạn/);
    expect(draftError(draft({ mode: "pending", price: "4120", until: true, untilText: "1970-01-01T00:00" }), env)).toMatch(/hết hạn/);
  });
  it("thiếu thông số lot (EA cũ)", () => {
    expect(draftError(draft(), { ...env, sym: { ...sym, volume_min: null } })).toMatch(/thông số lot/);
  });
});
