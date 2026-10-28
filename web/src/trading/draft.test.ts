import { describe, expect, it } from "vitest";
import { COLORS } from "./format";
import { defaultStop, draftLines, draftPrices, parseNum, parsePrice, type Draft } from "./draft";

const d = (o: Partial<Draft> = {}): Draft => ({ symbol: "XAUUSDm", side: "buy", mode: "pending", price: "4120", sl: "", tp: "", lot: "0.10", until: false, untilText: "", ...o });
const Q = { bid: 4130, ask: 4130.2 };

describe("parsePrice (giá có dấu phân cách nghìn)", () => {
  it("một nhóm nghìn: chọn cách đọc gần giá thị trường hơn", () => {
    expect(parsePrice("4,050", 4100)).toBe(4050); // trước đây 4.05: SL của Buy gần như không có
    expect(parsePrice("4.050", 4100)).toBe(4050); // kiểu Việt Nam (chấm = nghìn)
    expect(parsePrice("1,234", 1.1)).toBe(1.234); // EURUSD: dấu phẩy thập phân
    expect(parsePrice("1.234", 1.1)).toBe(1.234);
  });
  it("không có giá thị trường: giữ cách đọc thập phân như parseNum", () => {
    expect(parsePrice("4,050")).toBe(4.05);
  });
  it("hai nhóm nghìn trở lên chắc chắn là nghìn; có cả hai dấu hoặc không phải dạng nghìn thì như parseNum", () => {
    expect(parsePrice("1,234,567", 5)).toBe(1234567);
    expect(parsePrice("1.234.567")).toBe(1234567);
    expect(parsePrice("4,087.44", 4100)).toBe(4087.44);
    expect(parsePrice("4.087,44", 4100)).toBe(4087.44);
    expect(parsePrice("4120,5", 4100)).toBe(4120.5);
    expect(parsePrice("4120.50", 4100)).toBe(4120.5);
    expect(parsePrice("", 4100)).toBe(0);
  });
  it("draftPrices đọc giá vào / SL / TP của bản nháp theo giá thị trường", () => {
    expect(draftPrices(d({ price: "4,120", sl: "4,100", tp: "4,150.5" }), Q)).toEqual({ price: 4120, sl: 4100, tp: 4150.5 });
  });
});

describe("parseNum", () => {
  it("rỗng = 0, dấu phẩy thập phân, chuỗi dở dang", () => {
    expect(parseNum("")).toBe(0);
    expect(parseNum("  ")).toBe(0);
    expect(parseNum("4120,5")).toBe(4120.5);
    expect(parseNum("0,01")).toBe(0.01);
    expect(parseNum("4,120.50")).toBe(4120.5); // phẩy nghìn + chấm thập phân (dán từ nhãn giá)
    expect(parseNum("80,244.88")).toBe(80244.88);
    expect(parseNum("4.120,50")).toBe(4120.5); // chấm nghìn + phẩy thập phân
    expect(parseNum("1,234,567.5")).toBe(1234567.5);
    expect(parseNum("4120.")).toBe(4120);
    expect(parseNum("abc")).toBeNaN();
  });
});

describe("draftLines", () => {
  it("lệnh chờ: đường giá vào nét đứt theo hướng, nhãn loại lệnh suy ra từ giá thị trường; SL cam + TP xanh chấm chấm", () => {
    const l = draftLines(d({ sl: "4110", tp: "4140" }), "XAUUSDm", Q);
    expect(l).toMatchObject([
      { key: "d:entry", price: 4120, color: COLORS.buy, style: "solid", title: "BUY LIMIT 0.10" },
      { key: "d:sl", price: 4110, color: COLORS.sl, style: "solid", title: "SL" },
      { key: "d:tp", price: 4140, color: COLORS.tp, style: "solid", title: "TP" },
    ]);
    expect(l[0].tag).toEqual({ kind: "entry", owner: { t: "draft" }, qty: "0.10", label: "Buy limit", ghosts: [], place: "Buy", draft: true, side: "buy" });
    expect(draftLines(d({ side: "sell", price: "4140" }), "XAUUSDm", Q)[0].color).toBe(COLORS.sell);
  });
  it("thẻ giá vào có nút mờ cho SL/TP chưa đặt", () => {
    expect(draftLines(d(), "XAUUSDm", Q)[0].tag?.ghosts).toEqual(["tp", "sl"]);
    expect(draftLines(d({ tp: "4140" }), "XAUUSDm", Q)[0].tag?.ghosts).toEqual(["sl"]);
  });
  it("kéo đường vào qua giá thị trường thì nhãn đổi: Buy Limit → Buy Stop", () => {
    expect(draftLines(d({ price: "4150" }), "XAUUSDm", Q)[0].title).toBe("BUY STOP 0.10");
    expect(draftLines(d({ side: "sell", price: "4100" }), "XAUUSDm", Q)[0].title).toBe("SELL STOP 0.10");
    expect(draftLines(d({ price: "4150" }), "XAUUSDm", Q)[0].tag?.label).toBe("Buy stop");
  });
  it("chưa có giá thị trường: nhãn chỉ có hướng", () => {
    expect(draftLines(d(), "XAUUSDm", undefined)[0].title).toBe("BUY 0.10");
  });
  it("market: đường giá vào ở giá khớp (Buy ở Ask, Sell ở Bid) với nút Buy/Sell, cộng SL/TP đã đặt", () => {
    const l = draftLines(d({ mode: "market", sl: "4100" }), "XAUUSDm", Q);
    expect(l.map((x) => x.key)).toEqual(["d:entry", "d:sl"]);
    expect(l[0]).toMatchObject({ price: 4130.2, tag: { label: "Market", place: "Buy" } });
    expect(draftLines(d({ mode: "market", side: "sell" }), "XAUUSDm", Q)[0]).toMatchObject({ price: 4130, tag: { place: "Sell" } });
  });
  it("market chưa có giá thị trường: không có đường giá vào, vẫn có SL/TP đã đặt", () => {
    expect(draftLines(d({ mode: "market" }), "XAUUSDm", undefined)).toEqual([]);
    expect(draftLines(d({ mode: "market", sl: "4100" }), "XAUUSDm", undefined).map((x) => x.key)).toEqual(["d:sl"]);
  });
  it("chỉ vẽ trên chart của đúng symbol, không có bản nháp thì không có đường", () => {
    expect(draftLines(d(), "EURUSD", Q)).toEqual([]);
    expect(draftLines(null, "XAUUSDm", Q)).toEqual([]);
  });
  it("giá vào chưa nhập hợp lệ thì không vẽ", () => {
    expect(draftLines(d({ price: "" }), "XAUUSDm", Q)).toEqual([]);
    expect(draftLines(d({ price: "abc" }), "XAUUSDm", Q)).toEqual([]);
  });
});

describe("defaultStop", () => {
  it("SL của Buy và TP của Sell nằm dưới; TP của Buy và SL của Sell nằm trên", () => {
    expect(defaultStop("sl", "buy", 4000, 0.001, 3)).toBeLessThan(4000);
    expect(defaultStop("tp", "sell", 4000, 0.001, 3)).toBeLessThan(4000);
    expect(defaultStop("tp", "buy", 4000, 0.001, 3)).toBeGreaterThan(4000);
    expect(defaultStop("sl", "sell", 4000, 0.001, 3)).toBeGreaterThan(4000);
  });
  it("cách 0.25% giá, làm tròn theo tick", () => {
    expect(defaultStop("sl", "buy", 4000, 0.001, 3)).toBe(3990);
    expect(defaultStop("tp", "buy", 1.1, 0.00001, 5)).toBe(1.10275);
  });
  it("không bao giờ nằm trong vùng cấm của broker (≥ 1.5 lần stops level)", () => {
    // 0.25% của 4000 = 10; stops level 1000 điểm × 0.001 = 1 → 1.5 → vẫn 10
    expect(4000 - defaultStop("sl", "buy", 4000, 0.001, 3, 1000)).toBeGreaterThanOrEqual(1.5);
    // giá nhỏ, stops level lớn: lấy 1.5 × level
    expect(defaultStop("tp", "buy", 100, 0.01, 2, 5000)).toBeGreaterThanOrEqual(100 + 5000 * 0.01 * 1.5 - 0.01);
  });
});

describe("draftLines với nhãn lãi/lỗi", () => {
  const title = (kind: "sl" | "tp", side: string, lot: number, entry: number, price: number) => `${kind}|${side}|${lot}|${entry}|${price}`;
  it("lệnh chờ tính từ giá vào của lệnh", () => {
    const l = draftLines(d({ price: "4120", sl: "4110", tp: "4140", lot: "0.10" }), "XAUUSDm", Q, title);
    expect(l.find((x) => x.key === "d:sl")?.title).toBe("sl|buy|0.1|4120|4110");
    expect(l.find((x) => x.key === "d:tp")?.title).toBe("tp|buy|0.1|4120|4140");
  });
  it("market tính từ giá khớp: Buy ở Ask, Sell ở Bid", () => {
    expect(draftLines(d({ mode: "market", sl: "4100" }), "XAUUSDm", Q, title)[1].title).toBe("sl|buy|0.1|4130.2|4100");
    expect(draftLines(d({ mode: "market", side: "sell", tp: "4100" }), "XAUUSDm", Q, title)[1].title).toBe("tp|sell|0.1|4130|4100");
  });
  it("không có callback thì chỉ tên", () => {
    expect(draftLines(d({ sl: "4110" }), "XAUUSDm", Q).find((x) => x.key === "d:sl")?.title).toBe("SL");
  });
});
