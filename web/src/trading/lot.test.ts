import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymbolInfo } from "@/lib/api";
import { fmtLotValue, lotDecimals, lotSpec, normalizeLot, readLot, stepLot, writeLot, type LotSpec } from "./lot";

const S: LotSpec = { min: 0.01, max: 100, step: 0.01 };
const sym = (o: Partial<SymbolInfo> = {}) => ({ name: "XAUUSDm", digits: 3, tick_size: 0.001, type: "metal", volume_min: 0.01, volume_max: 100, volume_step: 0.01, ...o }) as SymbolInfo;

describe("lotSpec", () => {
  it("lấy min/max/step của symbol", () => {
    expect(lotSpec(sym())).toEqual(S);
  });
  it("MaxLotPerOrder của EA hạ max xuống; 0/thiếu = không giới hạn", () => {
    expect(lotSpec(sym(), 0.5)?.max).toBe(0.5);
    expect(lotSpec(sym(), 500)?.max).toBe(100);
    expect(lotSpec(sym(), 0)?.max).toBe(100);
  });
  it("EA cũ chưa báo thông số → null (không đoán)", () => {
    expect(lotSpec(undefined)).toBeNull();
    expect(lotSpec(sym({ volume_min: null }))).toBeNull();
    expect(lotSpec(sym({ volume_step: undefined }))).toBeNull();
    expect(lotSpec(sym({ volume_step: 0 }))).toBeNull();
  });
  it("giới hạn của EA nhỏ hơn lot tối thiểu → không giao dịch được", () => {
    expect(lotSpec(sym({ volume_min: 0.1 }), 0.05)).toBeNull();
  });
});

describe("lotDecimals", () => {
  it.each([[0.01, 2], [0.001, 3], [0.5, 1], [1, 0], [0.25, 2], [10, 0]])("step %s → %s chữ số", (step, d) => expect(lotDecimals(step)).toBe(d));
});

describe("normalizeLot", () => {
  it("làm tròn về bội của step, không để lỗi số thực lọt ra", () => {
    expect(normalizeLot(0.1 + 0.2, S)).toBe(0.3);
    expect(normalizeLot(0.126, S)).toBe(0.13);
    expect(normalizeLot(1.005, S)).toBe(1.01);
  });
  it("kẹp trong [min, max]", () => {
    expect(normalizeLot(0, S)).toBe(0.01);
    expect(normalizeLot(-5, S)).toBe(0.01);
    expect(normalizeLot(1e6, S)).toBe(100);
  });
  it("không phải số → min", () => {
    expect(normalizeLot(NaN, S)).toBe(0.01);
    expect(normalizeLot(Infinity, S)).toBe(0.01);
  });
  it("max không phải bội của step thì hạ xuống bội gần nhất", () => {
    expect(normalizeLot(9, { min: 0.1, max: 0.55, step: 0.1 })).toBe(0.5);
  });
  it("step lớn (cổ phiếu, 1 lot)", () => {
    expect(normalizeLot(2.6, { min: 1, max: 50, step: 1 })).toBe(3);
  });
});

describe("stepLot / fmtLotValue", () => {
  it("nhảy đúng một step và dừng ở min/max", () => {
    expect(stepLot(0.1, 1, S)).toBe(0.11);
    expect(stepLot(0.01, -1, S)).toBe(0.01);
    expect(stepLot(100, 1, S)).toBe(100);
    expect(stepLot(0.29, 1, S)).toBe(0.3);
  });
  it("hiển thị đủ chữ số của step", () => {
    expect(fmtLotValue(0.1, S)).toBe("0.10");
    expect(fmtLotValue(2, { min: 1, max: 9, step: 1 })).toBe("2");
  });
});

describe("readLot / writeLot", () => {
  const store: Record<string, string> = {};
  beforeEach(() => {
    for (const k of Object.keys(store)) delete store[k];
    vi.stubGlobal("localStorage", { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => void (store[k] = v) });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("nhớ riêng từng account × symbol", () => {
    writeLot("S:1", "XAUUSDm", 0.5);
    writeLot("S:1", "EURUSD", 0.02);
    writeLot("S:2", "XAUUSDm", 3);
    expect(readLot("S:1", "XAUUSDm")).toBe(0.5);
    expect(readLot("S:1", "EURUSD")).toBe(0.02);
    expect(readLot("S:2", "XAUUSDm")).toBe(3);
    expect(readLot("S:2", "EURUSD")).toBeNull();
  });
  it("dữ liệu hỏng hoặc localStorage bị chặn → null / không ném lỗi", () => {
    store["wickloom-lots"] = "{hỏng";
    expect(readLot("S:1", "X")).toBeNull();
    expect(() => writeLot("S:1", "X", 1)).not.toThrow();
    vi.stubGlobal("localStorage", { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } });
    expect(readLot("S:1", "X")).toBeNull();
    expect(() => writeLot("S:1", "X", 1)).not.toThrow();
  });
  it("giá trị không phải số bị bỏ", () => {
    store["wickloom-lots"] = JSON.stringify({ "S:1|X": "abc" });
    expect(readLot("S:1", "X")).toBeNull();
  });
});
