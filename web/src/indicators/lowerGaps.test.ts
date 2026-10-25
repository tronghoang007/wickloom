import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { headGap, holeGaps, spliceRange } from "./lowerGaps";

const bar = (t: number, c = 1): Bar => ({ t, o: c, h: c, l: c, c, v: 1 });
const run = (from: number, count: number, step: number, c = 1): Bar[] => Array.from({ length: count }, (_, i) => bar(from + i * step, c));

describe("headGap", () => {
  it("DB đủ tới from (trong dung sai): không thiếu", () => {
    expect(headGap(run(1000, 10, 60), 60, 1000, 2000)).toBeNull();
    expect(headGap(run(1000 + 5 * 60, 10, 60), 60, 1000, 2000)).toBeNull(); // muộn đúng 5 nến
  });
  it("DB bắt đầu muộn hơn from: thiếu [from, nến đầu), neo ở nến đầu", () => {
    const g = headGap(run(3000, 10, 60), 60, 0, 4000)!;
    expect(g).toMatchObject({ kind: "head", from: 0, to: 3000, before: 3000, bars: 50, key: "head:3000" });
  });
  it("DB rỗng: thiếu cả [from, to), neo ở to; khoá không đổi theo to", () => {
    expect(headGap([], 60, 0, 600)).toMatchObject({ from: 0, to: 600, before: 600, bars: 10, key: "head:empty" });
    expect(headGap([], 60, 0, 660)!.key).toBe("head:empty");
    expect(headGap([], 60, 600, 600)).toBeNull();
  });
});

describe("holeGaps", () => {
  // M1 có 0..240 rồi nhảy tới 3600 rồi 3600..3840; M5 (oracle) phủ liên tục tới 3600
  const m1 = run(0, 5, 60).concat(run(3600, 5, 60));
  it("lỗ hổng mà khung thô có nến nằm trọn trong đó: là lỗ", () => {
    const m5 = run(0, 14, 300); // 0..3900
    const gaps = holeGaps(m1, 60, 0, m5, 300);
    expect(gaps).toEqual([{ kind: "hole", from: 300, to: 3600, before: 3600, bars: 55, key: "hole:3600" }]);
  });
  it("thị trường nghỉ (khung thô cũng không có nến trong chỗ trống): không phải lỗ", () => {
    const m5 = run(0, 1, 300).concat(run(3600, 3, 300)); // 0 rồi 3600...: M1 thiếu 300..3600 mà M5 cũng không có gì
    expect(holeGaps(m1, 60, 0, m5, 300)).toEqual([]);
  });
  it("nến khung thô chỉ chạm chỗ trống (không nằm trọn) không tính", () => {
    // M1 thiếu 300..540; M5 240 bắt đầu trước chỗ trống, M5 600 bắt đầu đúng ở cuối chỗ trống: không có nến nào nằm trọn trong 300..600
    const short = run(0, 5, 60).concat(run(600, 3, 60));
    expect(holeGaps(short, 60, 0, [bar(240), bar(600)], 300)).toEqual([]);
  });
  it("mới → cũ và bỏ lỗ trước from", () => {
    const bars = run(0, 2, 60).concat(run(1200, 2, 60), run(3000, 2, 60));
    const m5 = run(0, 12, 300);
    expect(holeGaps(bars, 60, 0, m5, 300).map((g) => g.key)).toEqual(["hole:3000", "hole:1200"]);
    expect(holeGaps(bars, 60, 1200, m5, 300).map((g) => g.key)).toEqual(["hole:3000"]);
  });
  it("không có khung thô: không biết", () => {
    expect(holeGaps(m1, 60, 0, [], 300)).toEqual([]);
  });
  it("minSteps: lỗ ngắn hơn chừng đó nến mịn không tính, đủ dài thì tính (khung chuẩn cùng độ mịn)", () => {
    const tick = run(0, 2, 60).concat(run(240, 2, 60), run(600, 2, 60)); // thiếu 2 phút (120, 180) rồi 4 phút (360..540)
    const m1 = run(0, 12, 60);
    expect(holeGaps(tick, 60, 0, m1, 60).map((g) => g.bars)).toEqual([4, 2]);
    expect(holeGaps(tick, 60, 0, m1, 60, 3).map((g) => g.bars)).toEqual([4]);
    expect(holeGaps(tick, 60, 0, m1, 60, 4).map((g) => g.bars)).toEqual([4]);
    expect(holeGaps(tick, 60, 0, m1, 60, 5)).toEqual([]);
  });
});

describe("spliceRange", () => {
  it("thay đoạn [from, to)", () => {
    const bars = [0, 60, 120, 600, 660].map((t) => bar(t));
    const out = spliceRange(bars, 180, 600, [bar(300, 9), bar(360, 9)]);
    expect(out.map((b) => b.t)).toEqual([0, 60, 120, 300, 360, 600, 660]);
  });
  it("đoạn đầu (from trước mọi nến) và DB rỗng", () => {
    expect(spliceRange([bar(100), bar(160)], 0, 100, [bar(0), bar(60)]).map((b) => b.t)).toEqual([0, 60, 100, 160]);
    expect(spliceRange([], 0, 600, [bar(0)]).map((b) => b.t)).toEqual([0]);
  });
});
