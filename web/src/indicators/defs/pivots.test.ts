import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { byId } from "../catalog";
import { computeExtras } from "../engine";
import { newInstance } from "../instance";
import { autoPeriod, barStep, decimalsOf, groupPeriods, pivotLevels } from "./pivots";

const prev = { o: 95, h: 110, l: 90, c: 100 };
const price = (type: string, name: string, curOpen = 100) => pivotLevels(type, prev, curOpen).find((l) => l.name === name)!.price;

describe("công thức các mức (kỳ trước H=110 L=90 C=100 O=95)", () => {
  it("Traditional: P = HLC/3, R/S đối xứng quanh P cách đều theo biên độ", () => {
    const lv = pivotLevels("Traditional", prev, 0);
    expect(lv.map((l) => l.name)).toEqual(["P", "R1", "R2", "R3", "R4", "R5", "S1", "S2", "S3", "S4", "S5"]);
    const p = (n: string) => lv.find((l) => l.name === n)!.price;
    expect([p("P"), p("R1"), p("R2"), p("R3"), p("R4"), p("R5")]).toEqual([100, 110, 120, 130, 140, 150]);
    expect([p("S1"), p("S2"), p("S3"), p("S4"), p("S5")]).toEqual([90, 80, 70, 60, 50]);
  });
  it("Traditional với P lệch: R1 = 2P − L, S1 = 2P − H, R3 = 2P + (H − 2L)", () => {
    const o = { o: 1, h: 120, l: 90, c: 105 }; // P = 105
    const lv = Object.fromEntries(pivotLevels("Traditional", o, 0).map((l) => [l.name, l.price]));
    expect(lv.P).toBe(105);
    expect(lv.R1).toBe(2 * 105 - 90);
    expect(lv.S1).toBe(2 * 105 - 120);
    expect(lv.R2).toBe(105 + 30);
    expect(lv.R3).toBe(2 * 105 + (120 - 180));
    expect(lv.S3).toBe(2 * 105 - (240 - 90));
  });
  it("Fibonacci: 0.382 / 0.618 / 1 của biên độ", () => {
    expect(price("Fibonacci", "R1")).toBeCloseTo(107.64, 9);
    expect(price("Fibonacci", "R2")).toBeCloseTo(112.36, 9);
    expect(price("Fibonacci", "R3")).toBeCloseTo(120, 9);
    expect(price("Fibonacci", "S1")).toBeCloseTo(92.36, 9);
    expect(pivotLevels("Fibonacci", prev, 0)).toHaveLength(7);
  });
  it("Classic: P ± 1, 2, 3 biên độ", () => {
    expect(price("Classic", "R3")).toBeCloseTo(140, 9);
    expect(price("Classic", "S3")).toBeCloseTo(60, 9);
    expect(price("Classic", "R4")).toBeCloseTo(160, 9);
  });
  it("Woodie dùng giá mở của kỳ hiện tại", () => {
    expect(price("Woodie", "P", 102)).toBeCloseTo(101, 9); // (110 + 90 + 204) / 4
    expect(price("Woodie", "R1", 102)).toBeCloseTo(112, 9);
    expect(price("Woodie", "S1", 102)).toBeCloseTo(92, 9);
    expect(price("Woodie", "R3", 102)).toBeCloseTo(132, 9);
    expect(price("Woodie", "S4", 102)).toBeCloseTo(52, 9);
    expect(pivotLevels("Woodie", prev, 102)).toHaveLength(9);
  });
  it("DeMark chọn công thức theo đóng vs mở của kỳ trước; chỉ P, R1, S1", () => {
    expect(price("DM", "P")).toBeCloseTo(102.5, 9); // C > O: (2H + L + C)/4 = 410/4
    expect(price("DM", "R1")).toBeCloseTo(115, 9);
    expect(price("DM", "S1")).toBeCloseTo(95, 9);
    const down = { o: 105, h: 110, l: 90, c: 100 }; // C < O: (H + 2L + C)/4 = 390/4
    expect(pivotLevels("DM", down, 0)[0].price).toBeCloseTo(97.5, 9);
    const flat = { o: 100, h: 110, l: 90, c: 100 }; // C = O: (H + L + 2C)/4 = 400/4
    expect(pivotLevels("DM", flat, 0)[0].price).toBeCloseTo(100, 9);
    expect(pivotLevels("DM", prev, 0)).toHaveLength(3);
  });
  it("Camarilla: C ± 1.1·biên độ/12, /6, /4, /2 và R5 = H/L·C", () => {
    expect(price("Camarilla", "R1")).toBeCloseTo(100 + 22 / 12, 9);
    expect(price("Camarilla", "R4")).toBeCloseTo(111, 9);
    expect(price("Camarilla", "S4")).toBeCloseTo(89, 9);
    expect(price("Camarilla", "R5")).toBeCloseTo((110 / 90) * 100, 9);
    expect(price("Camarilla", "S5")).toBeCloseTo(100 - ((110 / 90) * 100 - 100), 9);
  });
});

describe("kỳ Auto / gom kỳ / chữ số", () => {
  it("Auto theo bước nến: ≤15m ngày, trong ngày tuần, ngày tháng, tuần+ năm", () => {
    expect(autoPeriod(60)).toBe("day");
    expect(autoPeriod(900)).toBe("day");
    expect(autoPeriod(1800)).toBe("week");
    expect(autoPeriod(4 * 3600)).toBe("week");
    expect(autoPeriod(86400)).toBe("month");
    expect(autoPeriod(7 * 86400)).toBe("year");
  });
  const mk = (t: number, c: number, o = c, h = c + 1, l = c - 1): Bar => ({ t, o, h, l, c, v: 1 });
  it("barStep là trung vị, không bị khoảng nghỉ cuối tuần làm lệch", () => {
    const bars = [mk(0, 1), mk(900, 1), mk(1800, 1), mk(2700, 1), mk(2700 + 2 * 86400, 1), mk(2700 + 2 * 86400 + 900, 1)];
    expect(barStep(bars)).toBe(900);
  });
  it("groupPeriods: O = mở nến đầu, C = đóng nến cuối, H/L cực trị, first/last", () => {
    const bars = [mk(0, 10, 9, 12, 8), mk(1, 11, 10, 15, 9), mk(2, 20, 20, 21, 19)];
    expect(groupPeriods(bars, [1, 1, 2])).toEqual([
      { o: 9, h: 15, l: 8, c: 11, first: 0, last: 1 },
      { o: 20, h: 21, l: 19, c: 20, first: 2, last: 2 },
    ]);
  });
  it("decimalsOf lấy số chữ số lớn nhất của giá gần đây", () => {
    expect(decimalsOf([mk(0, 4056.421), mk(1, 4056.4)])).toBe(3);
    expect(decimalsOf([mk(0, 4056)])).toBe(0);
    expect(decimalsOf([mk(0, 1.123456789)])).toBe(8);
  });
});

describe("object của Pivot Points", () => {
  // 5 ngày broker (offset 0, M15 → 96 nến/ngày), mỗi ngày một dải giá cố định để dễ tính tay
  const day = (d: number, lo: number, hi: number): Bar[] =>
    Array.from({ length: 96 }, (_, i) => {
      const t = d * 86400 + i * 900;
      const c = i === 95 ? lo + (hi - lo) / 2 : i === 0 ? lo + 1 : i % 2 ? hi : lo;
      return { t, o: i === 0 ? lo + 2 : c, h: Math.max(hi, c), l: Math.min(lo, c), c, v: 1 };
    });
  const bars = [...day(10, 100, 120), ...day(11, 110, 130), ...day(12, 100, 140), ...day(13, 120, 150), ...day(14, 130, 160)];
  const def = byId("pivots");
  const run = (inputs: Record<string, number | string | boolean> = {}) =>
    computeExtras(def, { ...newInstance("pivots"), inputs }, bars, { offset: 0 }).objects!;

  it("mỗi kỳ (từ kỳ thứ ba) có đủ 11 mức Traditional, nằm ngang suốt kỳ", () => {
    const o = run({ back: 2 });
    expect(o.lines).toHaveLength(2 * 11);
    const day3 = o.lines.filter((l) => l.x1 === 3 * 96);
    expect(day3).toHaveLength(11);
    expect(day3.every((l) => l.y1 === l.y2 && l.x2 === 4 * 96 - 1 && l.extend === "none")).toBe(true);
  });

  it("mức của ngày 3 tính từ H/L/C ngày 2; kỳ cuối kéo dài sang phải", () => {
    const o = run({ back: 3 });
    // ngày 2 (index 2) dùng ngày 1 (index 1: 110..130, đóng 120): P = (130 + 110 + 120)/3 = 120
    const p2 = o.lines.find((l) => l.x1 === 2 * 96 && l.color === "#fb8c00")!;
    expect(p2.y1).toBeCloseTo(120, 9);
    const last = o.lines.filter((l) => l.x1 === 4 * 96);
    expect(last.every((l) => l.extend === "right" && l.x2 === bars.length - 1)).toBe(true);
  });

  it("kỳ đầu của lịch sử không làm gốc: không có mức nào bắt đầu trước ngày thứ ba", () => {
    const o = run({ back: 50 });
    expect(Math.min(...o.lines.map((l) => l.x1))).toBe(2 * 96);
  });

  it("nhãn: tên + giá theo số chữ số, vị trí Left / Right, tắt được", () => {
    const left = run({ back: 1 }).labels;
    expect(left).toHaveLength(11);
    expect(left.every((l) => l.x === 4 * 96 && l.style === "right")).toBe(true);
    expect(left.find((l) => l.text.startsWith("P "))?.text).toMatch(/^P \d+$/); // giá nguyên -> 0 chữ số
    const right = run({ back: 1, labelsPos: "Right", prices: false }).labels;
    expect(right.every((l) => l.x === bars.length - 1 && l.style === "left")).toBe(true);
    expect(right.map((l) => l.text).sort()).toEqual(["P", "R1", "R2", "R3", "R4", "R5", "S1", "S2", "S3", "S4", "S5"].sort());
    expect(run({ labels: false }).labels).toHaveLength(0);
  });

  it("style từng mức: ẩn mức, đổi màu / độ dày / nét", () => {
    const inst = { ...newInstance("pivots"), inputs: { back: 1 }, style: { items: { R1: { visible: false as const }, S1: { color: "#123456", width: 3, lineStyle: "dotted" as const } } } };
    const o = computeExtras(def, inst, bars, { offset: 0 }).objects!;
    expect(o.lines).toHaveLength(10); // thiếu R1
    expect(o.labels.some((l) => l.text.startsWith("R1"))).toBe(false);
    const s1 = o.labels.find((l) => l.text.startsWith("S1"))!;
    expect(s1.color).toBe("#123456");
    const line = o.lines.find((l) => l.color === "#123456")!;
    expect(line).toMatchObject({ width: 3, style: "dotted" });
  });

  it("màu theo vai trò (P cam, R đỏ, S xanh); đổi kiểu đổi số mức; Weekly gom nhiều ngày", () => {
    const o = run({ back: 1 });
    expect(new Set(o.lines.map((l) => l.color))).toEqual(new Set(["#fb8c00", "#f23645", "#089981"]));
    expect(run({ back: 1, type: "DM" }).lines).toHaveLength(3);
    expect(run({ back: 1, type: "Fibonacci" }).lines).toHaveLength(7);
    const w = run({ frame: "Weekly", back: 5 });
    expect(w.lines.length).toBeLessThan(5 * 11); // 5 ngày chỉ nằm trong 1–2 tuần, kỳ đầu bị bỏ
  });

  it("quá ít nến / không nến: không ném lỗi", () => {
    expect(computeExtras(def, newInstance("pivots"), [], { offset: 0 }).objects).toEqual({ lines: [], labels: [], boxes: [] });
    expect(computeExtras(def, newInstance("pivots"), bars.slice(0, 1), { offset: 0 }).objects!.lines).toHaveLength(0);
  });
});
