import { describe, expect, it } from "vitest";
import { defaultSide, isPendingType, marketDistance, pendingLabel, resolveOrderType, sideOfType, snapPrice, tooClose, validatePending, type PendingInput } from "./orderType";

const BID = 4130;
const ASK = 4130.2;

describe("resolveOrderType", () => {
  it("Buy: dưới Ask = Limit, trên Ask = Stop", () => {
    expect(resolveOrderType("buy", 4120, BID, ASK)).toBe("buy_limit");
    expect(resolveOrderType("buy", 4140, BID, ASK)).toBe("buy_stop");
  });
  it("Sell: trên Bid = Limit, dưới Bid = Stop", () => {
    expect(resolveOrderType("sell", 4140, BID, ASK)).toBe("sell_limit");
    expect(resolveOrderType("sell", 4120, BID, ASK)).toBe("sell_stop");
  });
  it("đúng bằng giá thị trường (Ask với Buy, Bid với Sell) → null", () => {
    expect(resolveOrderType("buy", ASK, BID, ASK)).toBeNull();
    expect(resolveOrderType("sell", BID, BID, ASK)).toBeNull();
  });
  it("giữa Bid và Ask: Buy vẫn đo theo Ask, Sell theo Bid", () => {
    expect(resolveOrderType("buy", 4130.1, BID, ASK)).toBe("buy_limit");
    expect(resolveOrderType("sell", 4130.1, BID, ASK)).toBe("sell_limit");
  });
  it("giá nhảy qua mức vào thì loại đổi: Buy 4120 là Limit, thị trường rơi xuống 4118 thì thành Stop", () => {
    expect(resolveOrderType("buy", 4120, 4125, 4125.2)).toBe("buy_limit");
    expect(resolveOrderType("buy", 4120, 4117.8, 4118)).toBe("buy_stop");
  });
});

describe("helpers", () => {
  it("nhãn, hướng, kiểu hợp lệ", () => {
    expect(pendingLabel("sell_stop")).toBe("Sell stop");
    expect(sideOfType("buy_stop")).toBe("buy");
    expect(sideOfType("sell_limit")).toBe("sell");
    expect(isPendingType("buy_limit")).toBe(true);
    expect(isPendingType("buy_stop_limit")).toBe(false);
  });
  it("hướng mặc định theo vị trí so với thị trường", () => {
    expect(defaultSide(4100, BID, ASK)).toBe("buy");
    expect(defaultSide(4200, BID, ASK)).toBe("sell");
  });
  it("làm tròn giá theo tick_size, không để lỗi số thực lọt ra", () => {
    expect(snapPrice(4120.12345, 0.001, 3)).toBe(4120.123);
    expect(snapPrice(1.234567, 0.00001, 5)).toBe(1.23457);
    expect(snapPrice(4120.07, 0.05, 2)).toBe(4120.05);
    expect(snapPrice(4120.1234, 0, 2)).toBe(4120.12); // tick_size thiếu: theo digits
  });
  it("khoảng cách tới mép thị trường theo từng loại lệnh", () => {
    expect(marketDistance("buy_limit", 4120, BID, ASK)).toBeCloseTo(10.2);
    expect(marketDistance("buy_stop", 4140, BID, ASK)).toBeCloseTo(9.8);
    expect(marketDistance("sell_limit", 4140, BID, ASK)).toBeCloseTo(10);
    expect(marketDistance("sell_stop", 4120, BID, ASK)).toBeCloseTo(10);
  });
});

describe("tooClose (stops level)", () => {
  it("không có ràng buộc → luôn false", () => {
    expect(tooClose("buy_limit", 4130.1, BID, ASK, 0, 3)).toBe(false);
    expect(tooClose("buy_limit", 4130.1, BID, ASK, null, 3)).toBe(false);
  });
  it("trong vùng cấm → true; đúng mép thì được", () => {
    // 300 điểm × 0.001 = 0.3
    expect(tooClose("buy_limit", 4129.95, BID, ASK, 300, 3)).toBe(true); // ask - price = 0.25
    expect(tooClose("buy_limit", 4129.9, BID, ASK, 300, 3)).toBe(false); // = 0.30 đúng mép (sai số số thực không làm hỏng)
    expect(tooClose("sell_stop", 4129.8, BID, ASK, 300, 3)).toBe(true);
  });
});

const base: PendingInput = { side: "buy", price: 4120, lot: 0.1, sl: 0, tp: 0, expiration: 0, bid: BID, ask: ASK, digits: 3, stopsLevel: 0, spec: { min: 0.01, max: 1, step: 0.01 }, nowSec: 1_000_000 };
const v = (o: Partial<PendingInput> = {}) => validatePending({ ...base, ...o });

describe("validatePending", () => {
  it("hợp lệ → null", () => {
    expect(v()).toBeNull();
    expect(v({ sl: 4110, tp: 4140 })).toBeNull();
    expect(v({ side: "sell", price: 4140, sl: 4150, tp: 4120 })).toBeNull();
  });
  it("giá vào", () => {
    expect(v({ price: NaN })).toMatch(/Nhập giá/);
    expect(v({ price: 0 })).toMatch(/Nhập giá/);
    expect(v({ price: ASK })).toMatch(/bằng giá thị trường/);
  });
  it("thiếu thông số lot / lot ngoài khoảng / chưa có giá", () => {
    expect(v({ spec: null })).toMatch(/thông số lot/);
    expect(v({ lot: 0.001 })).toMatch(/Lot phải/);
    expect(v({ lot: 5 })).toMatch(/Lot phải/);
    expect(v({ bid: 0, ask: 0 })).toMatch(/Chưa có giá/);
  });
  it("vùng cấm của broker, nói rõ số điểm", () => {
    expect(v({ price: 4129.95, stopsLevel: 300 })).toMatch(/tối thiểu 300 điểm/);
  });
  it("SL/TP đúng phía theo hướng", () => {
    expect(v({ sl: 4125 })).toMatch(/SL của lệnh Buy phải thấp hơn/);
    expect(v({ tp: 4115 })).toMatch(/TP của lệnh Buy phải cao hơn/);
    expect(v({ side: "sell", price: 4140, sl: 4135 })).toMatch(/SL của lệnh Sell phải cao hơn/);
    expect(v({ side: "sell", price: 4140, tp: 4145 })).toMatch(/TP của lệnh Sell phải thấp hơn/);
  });
  it("SL/TP quá gần giá vào theo stops level", () => {
    expect(v({ sl: 4119.9, stopsLevel: 300 })).toMatch(/SL quá gần/);
    expect(v({ tp: 4120.1, stopsLevel: 300 })).toMatch(/TP quá gần/);
    expect(v({ sl: 4119.5, stopsLevel: 300 })).toBeNull();
  });
  it("hết hạn phải ở tương lai", () => {
    expect(v({ expiration: 1_000_030 })).toMatch(/hết hạn/);
    expect(v({ expiration: 999_000 })).toMatch(/hết hạn/);
    expect(v({ expiration: 1_003_600 })).toBeNull();
  });
});
