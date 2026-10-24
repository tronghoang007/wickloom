import type { Bar, TickCell } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { byId } from "../catalog";
import { computeExtras } from "../engine";
import { newInstance } from "../instance";
import { TICK_DEPTH } from "../lower";
import type { TickSource } from "../schema";
import { bigTrades, bubbleFrom, bubbleSize, lighten, niceStep, rowSize } from "./bigTrades";

const M5 = 300;
const bar = (t: number): Bar => ({ t, o: 100, h: 101, l: 99, c: 100, v: 1 });
const bars = Array.from({ length: 20 }, (_, i) => bar(1_000_000 + i * M5)); // 20 nến M5
const cell = (t: number, p: number, up: number, dn: number): TickCell => ({ t, p, up, dn });

// nguồn tick giả: ghi lại tham số của lần gọi `big`
const source = (cells: TickCell[] | null) => {
  const calls: [number, number, number, number, number][] = [];
  const ticks: TickSource = { covered: () => true, hist: () => null, big: (t0, t1, min, limit, size) => (calls.push([t0, t1, min, limit, size]), cells) };
  return { ticks, calls };
};
const run = (ticks?: TickSource, inputs: Record<string, number | string | boolean> = {}, cut = 0, style = {}) =>
  computeExtras(bigTrades, { ...newInstance("bigtrades"), inputs, style }, bars, { offset: 0 }, [], { tick: 0.01, cut, ...(ticks ? { ticks } : {}) }).objects!;

describe("bubbleSize", () => {
  it("diện tích tăng theo volume từ cỡ nhỏ nhất tới cỡ lớn nhất, kẹp hai đầu", () => {
    expect(bubbleSize(5, 5, 25, 10, 50)).toBe(10);
    expect(bubbleSize(25, 5, 25, 10, 50)).toBe(50);
    expect(bubbleSize(100, 5, 25, 10, 50)).toBe(50); // vượt Maximum volume không to thêm
    expect(bubbleSize(1, 5, 25, 10, 50)).toBe(10);
    expect(bubbleSize(10, 5, 25, 10, 50)).toBeCloseTo(10 + 40 * Math.sqrt(0.25), 9);
  });
  it("mọi bubble cùng volume: cỡ nhỏ nhất", () => {
    expect(bubbleSize(7, 7, 7, 10, 50)).toBe(10);
  });
});

describe("niceStep / rowSize", () => {
  it("niceStep làm tròn về 1 / 2 / 5 × 10^k gần nhất theo tỉ lệ", () => {
    expect([0.1, 1, 10, 3000].map(niceStep)).toEqual([0.1, 1, 10, 2000]);
    expect(niceStep(3)).toBe(2);
    expect(niceStep(3.6)).toBe(5);
    expect(niceStep(0.07)).toBeCloseTo(0.05, 12);
    expect(niceStep(80)).toBe(100);
    expect(niceStep(7.5)).toBe(10);
  });
  const flat = (range: number, n = 10): Bar[] => Array.from({ length: n }, (_, i) => ({ ...bar(i * M5), h: 100 + range, l: 100 }));
  it("user đặt số tick thì dùng đúng số đó", () => {
    expect(rowSize(flat(60), 0.01, 250)).toBeCloseTo(2.5, 9);
  });
  it("tự động: ~1/20 biên độ trung vị, làm tròn nấc, không nhỏ hơn 1 tick", () => {
    expect(rowSize(flat(60), 0.01, 0)).toBeCloseTo(2, 9); // 3 -> 2
    expect(rowSize(flat(400), 0.01, 0)).toBeCloseTo(20, 9);
    expect(rowSize(flat(0.04), 0.01, 0)).toBeCloseTo(0.01, 12); // 0.002 < 1 tick
    expect(rowSize([], 0.01, 0)).toBe(0.01);
  });
  it("trung vị: một nến tin tức cao bất thường không làm đổi row", () => {
    const b = flat(60);
    b[4] = { ...b[4], h: 100 + 6000 };
    expect(rowSize(b, 0.01, 0)).toBeCloseTo(2, 9);
  });
});

describe("bubbleFrom", () => {
  it("nến đầu của chart; không xa hơn độ sâu tick tính từ nến cuối", () => {
    expect(bubbleFrom(bars, 3, M5)).toBe(bars[3].t);
    const far = [bar(0), bar(TICK_DEPTH * 3)];
    expect(bubbleFrom(far, 0, M5)).toBe(TICK_DEPTH * 3 + M5 - TICK_DEPTH);
  });
  it("không có nến chart (cut ngoài mảng) thì null", () => {
    expect(bubbleFrom([], 0, M5)).toBeNull();
    expect(bubbleFrom(bars, 20, M5)).toBeNull();
  });
});

describe("Big Trades", () => {
  it("có trong catalog, vẽ trên chart chính, không có plot", () => {
    expect(byId("bigtrades")).toBe(bigTrades);
    expect(bigTrades.overlay).toBe(true);
    expect(bigTrades.plots).toEqual([]);
  });

  it("ticks: phủ từ nến đầu của chart; không có nến thì null", () => {
    expect(bigTrades.ticks!({}, { bars, cut: 4, step: M5, calendar: { offset: 0 } })).toEqual({ from: bars[4].t });
    expect(bigTrades.ticks!({}, { bars: [], cut: 0, step: M5, calendar: { offset: 0 } })).toBeNull();
  });

  it("hỏi tick [nến đầu, hết nến cuối) với Minimum volume tối thiểu 1, số bubble tối đa và row giá", () => {
    const { ticks, calls } = source([]);
    run(ticks, { count: 50 }, 2);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 4)).toEqual([bars[2].t, bars[19].t + M5, 1, 50]);
    expect(calls[0][4]).toBeCloseTo(0.1, 9); // nến cao 2 -> 2 / 20, tick 0.01
    run(ticks, { min: 8, count: 50, group: 300 });
    expect(calls[1][2]).toBe(8);
    expect(calls[1][4]).toBeCloseTo(3, 9); // 300 tick
  });

  it("chưa có tick (tắt / chưa nạp xong) thì không có bubble", () => {
    expect(run(undefined).bubbles).toEqual([]);
    expect(run(source(null).ticks).bubbles).toEqual([]);
  });

  it("bubble nằm ở nến chứa phút của ô, đúng giá, màu theo bên nhiều volume hơn", () => {
    const t = bars[5].t;
    const { ticks } = source([cell(t + 60, 101.5, 8, 2), cell(t + 240, 99.5, 1, 6), cell(bars[7].t, 100, 3, 3)]);
    const b = run(ticks, { text: false }).bubbles!;
    const at = (y: number) => b.find((x) => x.y === y)!;
    expect(at(101.5)).toMatchObject({ x: 5, bg: "#26a69ab8" }); // mua nhiều hơn
    expect(at(99.5)).toMatchObject({ x: 5, bg: "#f23645b8" }); // bán nhiều hơn
    expect(at(100)).toMatchObject({ x: 7, bg: "#26a69ab8" }); // bằng nhau: bên mua
    expect(at(101.5).text).toBeUndefined();
  });

  it("cỡ theo volume giữa ô nhỏ nhất và lớn nhất; Minimum / Maximum volume đặt thang; bubble lớn đứng trước", () => {
    const cells = [cell(bars[1].t, 100, 5, 0), cell(bars[2].t, 100, 25, 0), cell(bars[3].t, 100, 0, 15)];
    const b = run(source(cells).ticks, { minSize: 10, maxSize: 50 }).bubbles!;
    expect(b.map((x) => x.r * 2)).toEqual([50, 10 + 40 * Math.sqrt(0.5), 10]); // 25, 15, 5 theo thứ tự lớn -> nhỏ
    expect(b.map((x) => x.text)).toEqual(["25", "15", "5"]);
    const fixed = run(source(cells).ticks, { min: 1, max: 100, minSize: 10, maxSize: 50 }).bubbles!;
    expect(fixed[0].r * 2).toBeCloseTo(10 + 40 * Math.sqrt(24 / 99), 9);
  });

  it("màu và độ trong suốt lấy từ Style / Opacity", () => {
    const style = { items: { buy: { color: "#112233" } } };
    const b = run(source([cell(bars[0].t, 100, 4, 0)]).ticks, { opacity: 50 }, 0, style).bubbles![0];
    expect(b.border).toBe(lighten("#112233", 0.6)); // viền sáng hơn nền để tách khỏi nến cùng màu
    expect(b.bg).toBe("#11223380");
  });

  it("lighten pha màu với trắng; màu khác định dạng giữ nguyên", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(lighten("#26a69a", 0)).toBe("#26a69a");
    expect(lighten("#26a69a", 1)).toBe("#ffffff");
    expect(lighten("red", 0.5)).toBe("red");
  });

  it("volume lớn hiện dạng gọn (K / M)", () => {
    const b = run(source([cell(bars[0].t, 100, 1500, 0), cell(bars[1].t, 100, 2_300_000, 0)]).ticks).bubbles!;
    expect(b.map((x) => x.text)).toEqual(["2.3M", "1.5K"]);
  });
});
