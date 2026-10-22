import { describe, expect, it } from "vitest";
import { baseName, iconSpec, symbolCurrencies } from "./symbolIcon";

describe("baseName", () => {
  it("bỏ hậu tố của sàn: m thường cuối, _x10 / _x100, 247", () => {
    expect(baseName("EURUSDm")).toBe("EURUSD");
    expect(baseName("AAPLm")).toBe("AAPL");
    expect(baseName("US30_x10m")).toBe("US30");
    expect(baseName("XAUUSD247m")).toBe("XAUUSD");
    expect(baseName("DXYm")).toBe("DXY");
  });
  it("chỉ bỏ chữ m THƯỜNG cuối (chữ M hoa là một phần của mã)", () => {
    expect(baseName("MMM")).toBe("MMM");
    expect(baseName("GM")).toBe("GM");
    expect(baseName("m")).toBe("m");
  });
});

describe("iconSpec", () => {
  it("cặp forex: hai lá cờ (base trên trái, quote dưới phải)", () => {
    expect(iconSpec("EURUSDm", "forex")).toEqual({ base: { t: "flag", code: "EU" }, quote: { t: "flag", code: "US" } });
    expect(iconSpec("GBPJPYm", "forex")).toEqual({ base: { t: "flag", code: "GB" }, quote: { t: "flag", code: "JP" } });
    expect(iconSpec("AUDMXNm", "forex").quote).toEqual({ t: "flag", code: "MX" });
  });
  it("tiền lạ (không có cờ): huy hiệu chữ 3 ký tự, màu ổn định", () => {
    const a = iconSpec("VUVUSDm", "forex");
    expect(a.base).toMatchObject({ t: "text", text: "VUV" });
    expect(iconSpec("VUVUSDm", "forex")).toEqual(a);
  });
  it("kim loại: một thỏi theo loại kim loại, bất kể đồng định giá; XAUUSD247 cũng vậy", () => {
    expect(iconSpec("XAUUSDm", "forex")).toEqual({ base: { t: "metal", m: "XAU" } });
    expect(iconSpec("XAGEURm", "forex")).toEqual({ base: { t: "metal", m: "XAG" } });
    expect(iconSpec("XAUUSD247m", "forex")).toEqual({ base: { t: "metal", m: "XAU" } });
    expect(iconSpec("XPTUSDm", "forex").base).toEqual({ t: "metal", m: "XPT" });
  });
  it("crypto/USD: chỉ đồng coin; định giá bằng đồng khác thì thêm vòng nhỏ", () => {
    expect(iconSpec("BTCUSDm", "crypto")).toEqual({ base: { t: "coin", sym: "BTC" } });
    expect(iconSpec("BTCUSDTm", "crypto")).toEqual({ base: { t: "coin", sym: "BTC" } });
    expect(iconSpec("ETHBTCm", "crypto")).toEqual({ base: { t: "coin", sym: "ETH" }, quote: { t: "coin", sym: "BTC" } });
    expect(iconSpec("BTCJPYm", "crypto")).toEqual({ base: { t: "coin", sym: "BTC" }, quote: { t: "flag", code: "JP" } });
    expect(iconSpec("BTCXAUm", "crypto").quote).toEqual({ t: "metal", m: "XAU" });
    expect(iconSpec("1INCHUSDm", "crypto")).toEqual({ base: { t: "coin", sym: "1INCH" } });
  });
  it("nhận ra crypto theo tên cả khi không có type (không nhầm thành cặp forex BTC/USD)", () => {
    expect(iconSpec("BTCUSD")).toEqual({ base: { t: "coin", sym: "BTC" } });
    expect(iconSpec("EURUSD")).toEqual({ base: { t: "flag", code: "EU" }, quote: { t: "flag", code: "US" } });
  });
  it("chỉ số: cờ nước, kể cả hợp đồng _x10 / _x100 (type 'other' của sàn)", () => {
    expect(iconSpec("US30m", "index").base).toEqual({ t: "flag", code: "US" });
    expect(iconSpec("US30_x10m", "other").base).toEqual({ t: "flag", code: "US" });
    expect(iconSpec("USTEC_x100m", "other").base).toEqual({ t: "flag", code: "US" });
    expect(iconSpec("UK100m", "index").base).toEqual({ t: "flag", code: "GB" });
    expect(iconSpec("DE30m", "index").base).toEqual({ t: "flag", code: "DE" });
    expect(iconSpec("STOXX50m", "index").base).toEqual({ t: "flag", code: "EU" });
    expect(iconSpec("JP225m", "index").base).toEqual({ t: "flag", code: "JP" });
    expect(iconSpec("AUS200m", "index").base).toEqual({ t: "flag", code: "AU" });
  });
  it("dầu, khí, chỉ số đô la", () => {
    expect(iconSpec("USOILm", "other").base).toEqual({ t: "oil", brent: false });
    expect(iconSpec("UKOILm", "other").base).toEqual({ t: "oil", brent: true });
    expect(iconSpec("XNGUSDm", "other").base).toEqual({ t: "gas" });
    expect(iconSpec("DXYm", "forex").base).toEqual({ t: "dxy" });
  });
  it("cổ phiếu: chữ đầu của mã trên nền màu thương hiệu / màu băm; mã 1 chữ (C, F) vẫn đúng", () => {
    expect(iconSpec("AAPLm", "stocks").base).toMatchObject({ t: "text", text: "AA" });
    expect(iconSpec("AMZNm", "stocks").base).toMatchObject({ t: "text", color: "#ff9900" });
    expect(iconSpec("Cm", "stocks").base).toMatchObject({ t: "text", text: "C" });
    expect(iconSpec("BATm", "stocks").base).toMatchObject({ t: "text", text: "BA" }); // BAT là cổ phiếu ở đây, không phải coin
    expect(iconSpec("XOMm", "stocks").base).toMatchObject({ t: "text", text: "XO" });
  });
  it("mọi symbol thật của sàn đều ra icon (không ném lỗi)", () => {
    for (const [n, t] of [["AUDCZKm", "forex"], ["BWPUSDm", "forex"], ["XNIUSDm", "forex"], ["US500_x100m", "other"], ["HTUSDm", "crypto"], ["Fm", "stocks"]] as const) expect(() => iconSpec(n, t)).not.toThrow();
  });
});

describe("symbolCurrencies", () => {
  it("cặp forex: cả hai đồng", () => {
    expect(symbolCurrencies("EURUSDm", "forex")).toEqual(["EUR", "USD"]);
    expect(symbolCurrencies("GBPJPYm", "forex")).toEqual(["GBP", "JPY"]);
    expect(symbolCurrencies("VUVUSDm", "forex")).toEqual(["USD"]);
  });
  it("kim loại / dầu / khí / chỉ số đô la / cổ phiếu: USD (kim loại định giá bằng đồng khác thì đồng đó)", () => {
    expect(symbolCurrencies("XAUUSDm", "forex")).toEqual(["USD"]);
    expect(symbolCurrencies("XAUEURm", "forex")).toEqual(["EUR"]);
    expect(symbolCurrencies("USOILm", "other")).toEqual(["USD"]);
    expect(symbolCurrencies("DXYm", "forex")).toEqual(["USD"]);
    expect(symbolCurrencies("AAPLm", "stocks")).toEqual(["USD"]);
  });
  it("crypto: USD, hoặc đồng định giá nếu là tiền pháp định", () => {
    expect(symbolCurrencies("BTCUSDm", "crypto")).toEqual(["USD"]);
    expect(symbolCurrencies("BTCUSDTm", "crypto")).toEqual(["USD"]);
    expect(symbolCurrencies("BTCJPYm", "crypto")).toEqual(["JPY"]);
    expect(symbolCurrencies("ETHBTCm", "crypto")).toEqual(["USD"]);
  });
  it("chỉ số: tiền của nước đó", () => {
    expect(symbolCurrencies("US500m", "index")).toEqual(["USD"]);
    expect(symbolCurrencies("UK100m", "index")).toEqual(["GBP"]);
    expect(symbolCurrencies("DE30m", "index")).toEqual(["EUR"]);
    expect(symbolCurrencies("JP225m", "index")).toEqual(["JPY"]);
    expect(symbolCurrencies("AUS200m", "index")).toEqual(["AUD"]);
  });
});
