import { describe, expect, it } from "vitest";
import { colMaxima, fpCell, fpGeometry, fpPairLayout } from "./footprint";

describe("fpPairLayout", () => {
  it("hai số quanh tâm cột: sell căn phải sát bên trái khe, buy căn trái từ bên phải khe, đối xứng qua tâm", () => {
    const at = fpPairLayout(100, 200, 14, 14, 10)!;
    expect(at.sellX).toBe(145); // tâm 150, khe 10
    expect(at.buyX).toBe(155);
    expect(150 - at.sellX).toBe(at.buyX - 150);
  });
  it("số rộng hơn nửa cột (kể cả chỉ một bên) thì bỏ chữ", () => {
    expect(fpPairLayout(100, 140, 14, 14, 10)).not.toBeNull(); // 14 + 5 = 19 <= 20 - 1
    expect(fpPairLayout(100, 140, 15, 4, 10)).toBeNull(); // sell 15 + 5 = 20 > 19
    expect(fpPairLayout(100, 140, 4, 15, 10)).toBeNull(); // buy rộng cũng bị
  });
});

describe("fpGeometry", () => {
  it("nến sát mép trái, cột ô bên phải nến: Bid x Ask / Delta / Volume một cột như nhau, Delta + Volume hai cột", () => {
    const one = fpGeometry(100, 50, "bidask");
    expect(one.cols).toHaveLength(1);
    expect(one.candleX).toBeLessThan(100); // nến lệch trái tâm, không nằm giữa
    expect(one.cols[0].x0).toBeGreaterThan(one.candleX);
    expect(one.cols[0].x1).toBeGreaterThan(one.cols[0].x0);
    expect(fpGeometry(100, 50, "volume")).toEqual(one);
    expect(fpGeometry(100, 50, "delta")).toEqual(one);
    const two = fpGeometry(100, 50, "deltavol");
    expect(two.cols).toHaveLength(2);
    expect(two.cols[1].x0).toBeGreaterThan(two.cols[0].x1);
  });
});

describe("fpCell", () => {
  it("Bid x Ask: giá trị nền = tổng volume, màu theo bên nhiều hơn (bằng nhau thì mua)", () => {
    expect(fpCell("bidask", 0, { p: 1, up: 30, dn: 10 })).toEqual({ v: 40, side: "buy" });
    expect(fpCell("bidask", 0, { p: 1, up: 3, dn: 10 })).toEqual({ v: 13, side: "sell" });
    expect(fpCell("bidask", 0, { p: 1, up: 5, dn: 5 })).toEqual({ v: 10, side: "buy" });
  });

  it("Delta = up − down, Volume = tổng, Delta + Volume = delta | tổng", () => {
    const r = { p: 1, up: 3, dn: 10 };
    expect(fpCell("delta", 0, r)).toEqual({ v: -7, side: "sell" });
    expect(fpCell("volume", 0, r)).toEqual({ v: 13, side: "sell" });
    expect(fpCell("deltavol", 0, r)).toEqual({ v: -7, side: "sell" });
    expect(fpCell("deltavol", 1, r)).toEqual({ v: 13, side: "sell" });
  });

  it("chuẩn hoá độ đậm / bề rộng theo tổng lớn nhất của nến", () => {
    const rows = [{ p: 1, up: 30, dn: 10 }, { p: 2, up: 3, dn: 4 }, { p: 3, up: 0, dn: 0 }];
    expect(colMaxima("bidask", rows, 1)).toEqual([40]);
  });
});
