import { describe, expect, it } from "vitest";
import { isNumText, parseNumText, stepNum } from "./numberField";

describe("isNumText", () => {
  it("cho gõ dở: rỗng, dấu, dấu thập phân đứng cuối hoặc đầu", () => {
    for (const s of ["", "-", "+", ".", ",", "3", "3.", "3,", ".5", "3.5", "3,5", "-0.25", "+2", "007"]) expect(isNumText(s), s).toBe(true);
  });
  it("chặn chữ cái, hai dấu thập phân, dấu ở giữa, khoảng trắng", () => {
    for (const s of ["a", "3a", "1e3", "1.2.3", "1.2,3", "3-", "--1", " 3", "3 ", "0x10", "Infinity"]) expect(isNumText(s), s).toBe(false);
  });
});

describe("parseNumText", () => {
  it("đọc cả dấu chấm lẫn dấu phẩy, kể cả số gõ dở có số", () => {
    expect(parseNumText("3.5")).toBe(3.5);
    expect(parseNumText("3,5")).toBe(3.5);
    expect(parseNumText("3.")).toBe(3);
    expect(parseNumText(".5")).toBe(0.5);
    expect(parseNumText("-0.25")).toBe(-0.25);
    expect(parseNumText("+2")).toBe(2);
  });
  it("chưa có chữ số nào thì NaN", () => {
    for (const s of ["", "-", "+", ".", ",", " "]) expect(parseNumText(s), s).toBeNaN();
  });
});

describe("stepNum", () => {
  it("cộng / trừ một bước, bỏ sai số nhị phân", () => {
    expect(stepNum(3.5, 1, 0.1)).toBe(3.6);
    expect(stepNum(0.2, 1, 0.1)).toBe(0.3); // cộng thường 0.2 + 0.1 ra 0.30000000000000004
    expect(stepNum(3.5, -1, 0.1)).toBe(3.4);
    expect(stepNum(9, 1, 1)).toBe(10);
  });
  it("kẹp trong [min, max]", () => {
    expect(stepNum(10, 1, 0.1, 0, 10)).toBe(10);
    expect(stepNum(0, -1, 0.1, 0, 10)).toBe(0);
    expect(stepNum(50, 1, 1, 0, 10)).toBe(10); // đang gõ vượt khoảng rồi bấm mũi tên: về biên
  });
});
