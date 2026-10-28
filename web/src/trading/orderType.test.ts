import { describe, expect, it } from "vitest";
import { defaultSide, isPendingType, marketDistance, pendingLabel, resolveOrderType, sideOfType, snapPrice, tooClose, tooFar, checkStopMove, validateMarket, validatePending, type MarketInput, type StopMoveInput, type PendingInput } from "./orderType";

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

const mk: MarketInput = { side: "buy", lot: 0.1, sl: 0, tp: 0, bid: BID, ask: ASK, digits: 3, stopsLevel: 0, spec: { min: 0.01, max: 1, step: 0.01 } };
const m = (o: Partial<MarketInput> = {}) => validateMarket({ ...mk, ...o });

describe("validateMarket", () => {
  it("không SL/TP là hợp lệ; SL/TP đúng phía thì hợp lệ", () => {
    expect(m()).toBeNull();
    expect(m({ sl: 4120, tp: 4140 })).toBeNull();
    expect(m({ side: "sell", sl: 4140, tp: 4120 })).toBeNull();
  });
  it("Buy đo từ Bid, Sell đo từ Ask", () => {
    expect(m({ sl: 4130 })).toMatch(/SL của lệnh Buy/); // = Bid
    expect(m({ sl: 4130.1 })).toMatch(/SL của lệnh Buy/); // giữa Bid và Ask vẫn sai phía
    expect(m({ tp: 4130 })).toMatch(/TP của lệnh Buy/);
    expect(m({ side: "sell", sl: 4130.2 })).toMatch(/SL của lệnh Sell/); // = Ask
    expect(m({ side: "sell", tp: 4131 })).toMatch(/TP của lệnh Sell/);
  });
  it("vùng cấm theo stops level", () => {
    expect(m({ sl: 4129.9, stopsLevel: 300 })).toMatch(/SL quá gần.*300 điểm/);
    expect(m({ tp: 4130.2, stopsLevel: 300 })).toMatch(/TP quá gần/);
    expect(m({ sl: 4129.7, stopsLevel: 300 })).toBeNull();
  });
  it("lot, thông số lot, giá thị trường", () => {
    expect(m({ spec: null })).toMatch(/thông số lot/);
    expect(m({ lot: 0 })).toMatch(/Lot phải/);
    expect(m({ lot: 2 })).toMatch(/Lot phải/);
    expect(m({ bid: 0, ask: 0 })).toMatch(/Chưa có giá/);
  });
});

const sm: StopMoveInput = { target: "position", side: "buy", kind: "sl", price: 4120, entry: 0, bid: BID, ask: ASK, digits: 3, stopsLevel: 0 };
const mv = (o: Partial<StopMoveInput> = {}) => checkStopMove({ ...sm, ...o });

describe("checkStopMove", () => {
  it("vị thế: đo từ giá đóng, đúng phía thì được", () => {
    expect(mv()).toBeNull(); // Buy SL dưới Bid
    expect(mv({ kind: "tp", price: 4140 })).toBeNull();
    expect(mv({ side: "sell", kind: "sl", price: 4140 })).toBeNull(); // Sell SL trên Ask
    expect(mv({ side: "sell", kind: "tp", price: 4120 })).toBeNull();
  });
  it("vị thế: sai phía", () => {
    expect(mv({ price: 4130 })).toMatch(/SL của lệnh Buy phải thấp hơn giá thị trường/); // = Bid
    expect(mv({ kind: "tp", price: 4125 })).toMatch(/TP của lệnh Buy phải cao hơn/);
    expect(mv({ side: "sell", kind: "sl", price: 4130.2 })).toMatch(/SL của lệnh Sell phải cao hơn/); // = Ask
    expect(mv({ side: "sell", kind: "tp", price: 4135 })).toMatch(/TP của lệnh Sell phải thấp hơn/);
  });
  it("lệnh chờ: đo từ giá vào của lệnh, không phải giá thị trường", () => {
    const o = { target: "order" as const, entry: 4100 };
    expect(mv({ ...o, price: 4090 })).toBeNull(); // dưới giá vào 4100 dù trên/dưới thị trường
    expect(mv({ ...o, price: 4110 })).toMatch(/SL của lệnh Buy phải thấp hơn giá vào/);
    expect(mv({ ...o, kind: "tp", price: 4120 })).toBeNull();
  });
  it("vùng cấm theo stops level", () => {
    expect(mv({ price: 4129.9, stopsLevel: 300 })).toMatch(/SL quá gần giá thị trường \(tối thiểu 300 điểm\)/);
    expect(mv({ price: 4129.5, stopsLevel: 300 })).toBeNull();
    expect(mv({ target: "order", entry: 4100, price: 4099.9, stopsLevel: 300 })).toMatch(/quá gần giá vào/);
  });
  it("chưa có giá để so thì để EA quyết", () => {
    expect(mv({ bid: 0, ask: 0, price: 1 })).toBeNull();
  });
});

describe("giá xa thị trường vô lý (gõ nhầm dấu phân cách) và lot lẻ step", () => {
  const spec = { min: 0.01, max: 100, step: 0.01 };
  it("tooFar: quá 50% so với giữa Bid / Ask; chưa có giá thì không xét", () => {
    expect(tooFar(4.05, BID, ASK)).toBe(true);
    expect(tooFar(41300, BID, ASK)).toBe(true);
    expect(tooFar(3000, BID, ASK)).toBe(false);
    expect(tooFar(0, BID, ASK)).toBe(false);
    expect(tooFar(4.05, 0, 0)).toBe(false);
  });
  it("market: SL của Buy ở 4.05 (\"4,050\" đọc nhầm) bị chặn dù đúng phía", () => {
    expect(validateMarket({ side: "buy", lot: 0.1, sl: 4.05, tp: 0, bid: BID, ask: ASK, digits: 3, spec })).toMatch(/quá xa/);
    expect(validateMarket({ side: "sell", lot: 0.1, sl: 0, tp: 4.05, bid: BID, ask: ASK, digits: 3, spec })).toMatch(/TP cách giá thị trường quá xa/);
  });
  it("lệnh chờ: giá vào / SL / TP quá xa bị chặn", () => {
    const base = { side: "buy" as const, price: 4120, lot: 0.1, sl: 0, tp: 0, expiration: 0, bid: BID, ask: ASK, digits: 3, spec, nowSec: 0 };
    expect(validatePending({ ...base, price: 4.12 })).toMatch(/Giá vào cách/);
    expect(validatePending({ ...base, sl: 4.1 })).toMatch(/SL cách/);
    expect(validatePending(base)).toBeNull();
  });
  it("kéo / sửa SL vị thế tới giá vô lý bị chặn", () => {
    expect(checkStopMove({ target: "position", side: "buy", kind: "sl", price: 4.1, entry: 4125, bid: BID, ask: ASK, digits: 3 })).toMatch(/quá xa/);
  });
  it("lot không phải bội của step bị chặn (trước đây kiểm lot gõ rồi lúc gửi làm tròn lên: hiện 0.015 mà gửi 0.02)", () => {
    expect(validateMarket({ side: "buy", lot: 0.015, sl: 0, tp: 0, bid: BID, ask: ASK, digits: 3, spec })).toMatch(/bội của 0.01/);
    expect(validatePending({ side: "buy", price: 4120, lot: 0.015, sl: 0, tp: 0, expiration: 0, bid: BID, ask: ASK, digits: 3, spec, nowSec: 0 })).toMatch(/bội của 0.01/);
    expect(validateMarket({ side: "buy", lot: 0.07, sl: 0, tp: 0, bid: BID, ask: ASK, digits: 3, spec })).toBeNull(); // 0.07 / 0.01 không tròn tuyệt đối trong float
  });
});
