import { describe, expect, it } from "vitest";
import { COLORS } from "./format";
import { defaultStop, draftLines, parseNum, type Draft } from "./draft";

const d = (o: Partial<Draft> = {}): Draft => ({ symbol: "XAUUSDm", side: "buy", mode: "pending", price: "4120", sl: "", tp: "", lot: "0.10", until: false, untilText: "", ...o });
const Q = { bid: 4130, ask: 4130.2 };

describe("parseNum", () => {
  it("rỗng = 0, dấu phẩy thập phân, chuỗi dở dang", () => {
    expect(parseNum("")).toBe(0);
    expect(parseNum("  ")).toBe(0);
    expect(parseNum("4120,5")).toBe(4120.5);
    expect(parseNum("4120.")).toBe(4120);
    expect(parseNum("abc")).toBeNaN();
  });
});

describe("draftLines", () => {
  it("lệnh chờ: đường giá vào mang nhãn loại lệnh suy ra từ giá thị trường + SL đỏ + TP xanh, nét liền", () => {
    const l = draftLines(d({ sl: "4110", tp: "4140" }), "XAUUSDm", Q);
    expect(l).toEqual([
      { key: "d:entry", price: 4120, color: COLORS.order, dashed: false, title: "BUY LIMIT 0.10" },
      { key: "d:sl", price: 4110, color: COLORS.sl, dashed: false, title: "SL" },
      { key: "d:tp", price: 4140, color: COLORS.tp, dashed: false, title: "TP" },
    ]);
  });
  it("kéo đường vào qua giá thị trường thì nhãn đổi: Buy Limit → Buy Stop", () => {
    expect(draftLines(d({ price: "4150" }), "XAUUSDm", Q)[0].title).toBe("BUY STOP 0.10");
    expect(draftLines(d({ side: "sell", price: "4100" }), "XAUUSDm", Q)[0].title).toBe("SELL STOP 0.10");
  });
  it("chưa có giá thị trường: nhãn chỉ có hướng", () => {
    expect(draftLines(d(), "XAUUSDm", undefined)[0].title).toBe("BUY 0.10");
  });
  it("market: không có đường giá vào, chỉ SL/TP đã đặt", () => {
    expect(draftLines(d({ mode: "market", sl: "4100" }), "XAUUSDm", Q).map((x) => x.key)).toEqual(["d:sl"]);
    expect(draftLines(d({ mode: "market" }), "XAUUSDm", Q)).toEqual([]);
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
    expect(draftLines(d({ mode: "market", sl: "4100" }), "XAUUSDm", Q, title)[0].title).toBe("sl|buy|0.1|4130.2|4100");
    expect(draftLines(d({ mode: "market", side: "sell", tp: "4100" }), "XAUUSDm", Q, title)[0].title).toBe("tp|sell|0.1|4130|4100");
  });
  it("không có callback thì chỉ tên", () => {
    expect(draftLines(d({ sl: "4110" }), "XAUUSDm", Q).find((x) => x.key === "d:sl")?.title).toBe("SL");
  });
});
