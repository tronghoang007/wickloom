import { describe, expect, it } from "vitest";
import type { Bar } from "@/lib/api";
import { barsBetween, logicalToTime, shiftAnchors, timeToLogical } from "./coords";

const H = 3600;
const bar = (t: number): Bar => ({ t, o: 1, h: 1, l: 1, c: 1, v: 1 });
// H1: thứ Sáu 12:00–20:00 (9 nến), nghỉ cuối tuần, thứ Hai 00:00–15:00 (16 nến)
const FRI_12 = Date.UTC(2026, 9, 16, 12) / 1000;
const MON_00 = Date.UTC(2026, 9, 19, 0) / 1000;
const BARS = [
  ...Array.from({ length: 9 }, (_, i) => bar(FRI_12 + i * H)),
  ...Array.from({ length: 16 }, (_, i) => bar(MON_00 + i * H)),
];
const MON_15 = MON_00 + 15 * H;

describe("timeToLogical / logicalToTime", () => {
  it("trả về chỉ số nến, nghỉ cuối tuần không tính", () => {
    expect(timeToLogical(BARS, H, FRI_12)).toBe(0);
    expect(timeToLogical(BARS, H, MON_00)).toBe(9);
    expect(timeToLogical(BARS, H, MON_15)).toBe(24);
  });

  it("ngoại suy theo step ngoài vùng dữ liệu", () => {
    expect(timeToLogical(BARS, H, FRI_12 - 2 * H)).toBe(-2);
    expect(timeToLogical(BARS, H, MON_15 + 3 * H)).toBe(27);
    expect(logicalToTime(BARS, H, -2)).toBe(FRI_12 - 2 * H);
    expect(logicalToTime(BARS, H, 27)).toBe(MON_15 + 3 * H);
  });

  it("logicalToTime bắt vào nến gần nhất", () => {
    expect(logicalToTime(BARS, H, 8.6)).toBe(MON_00);
    expect(logicalToTime(BARS, H, 8.4)).toBe(FRI_12 + 8 * H);
  });

  it("không có nến thì null", () => {
    expect(timeToLogical([], H, FRI_12)).toBeNull();
    expect(logicalToTime([], H, 3)).toBeNull();
  });
});

describe("barsBetween (lỗi #2)", () => {
  it("đếm theo chỉ số nến như TradingView, không phải Δt/step", () => {
    expect(barsBetween(BARS, H, FRI_12, MON_15)).toBe(24);
    expect(Math.round((MON_15 - FRI_12) / H)).toBe(75); // cách cũ
  });

  it("có dấu theo chiều đo", () => {
    expect(barsBetween(BARS, H, MON_15, FRI_12)).toBe(-24);
  });

  it("qua mép phải dữ liệu vẫn đếm tiếp theo step", () => {
    expect(barsBetween(BARS, H, MON_00, MON_15 + 5 * H)).toBe(20);
  });

  it("không có nến thì dùng Δt/step", () => {
    expect(barsBetween([], H, FRI_12, FRI_12 + 5 * H)).toBe(5);
  });
});

describe("shiftAnchors (lỗi #4)", () => {
  const pts = [
    { time: FRI_12 + 6 * H, price: 4100 },
    { time: MON_00 + 2 * H, price: 4087.6 },
  ];

  it("dịch mọi điểm cùng số nến và cùng chênh giá → hình giữ nguyên", () => {
    const out = shiftAnchors(BARS, H, pts, 3, 5.5)!;
    expect(out[0]).toEqual({ time: MON_00, price: 4105.5 }); // nến 6 + 3 = nến 9
    expect(out[1]).toEqual({ time: MON_00 + 5 * H, price: 4093.1 });
    const width = (a: typeof pts) => barsBetween(BARS, H, a[0].time, a[1].time);
    expect(width(out)).toBe(width(pts));
    expect(out[1].price - out[0].price).toBeCloseTo(pts[1].price - pts[0].price, 9);
  });

  it("dBars = 0 giữ nguyên thời gian", () => {
    const odd = [{ time: FRI_12 + 1234, price: 1 }];
    expect(shiftAnchors(BARS, H, odd, 0, 1)).toEqual([{ time: FRI_12 + 1234, price: 2 }]);
  });

  it("dịch được ra ngoài vùng dữ liệu", () => {
    expect(shiftAnchors(BARS, H, [{ time: MON_15, price: 1 }], 2, 0)).toEqual([{ time: MON_15 + 2 * H, price: 1 }]);
  });
});
