import type { Bar, TickCell } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { byId } from "../catalog";
import { computeExtras } from "../engine";
import { newInstance } from "../instance";
import { TICK_DEPTH } from "../lower";
import type { TickStat } from "@/lib/api";
import type { TickSource } from "../schema";
import { BIG_POOL, MAX_SHOWN, bigTrades, bubbleFrom, bubbleSize, bubbleX, lighten, niceStep, refRange, rowSize, sizeFractions, topInRange } from "./bigTrades";

const M5 = 300;
const bar = (t: number): Bar => ({ t, o: 100, h: 101, l: 99, c: 100, v: 1 });
const bars = Array.from({ length: 20 }, (_, i) => bar(1_000_000 + i * M5)); // 20 nến M5
const cell = (t: number, p: number, up: number, dn: number): TickCell => ({ t, p, up, dn });

// thống kê volume giả: mean 5, độ lệch chuẩn 10 (12500 / 100 - 25 = 100), nên ngưỡng = 5 + 10 × sigma
const STAT: TickStat = { n: 100, sum: 500, sumsq: 12_500 };
const NO_CELLS: TickStat = { n: 0, sum: 0, sumsq: 0 }; // khoảng thống kê không có ô nào: chưa có ngưỡng, hiện mọi ô

// nguồn tick giả: ghi lại tham số của lần gọi `big` / `stat`
const source = (cells: TickCell[] | null, exact?: (t0: number, t1: number, min: number, limit: number) => TickCell[] | null, stat: TickStat | null = NO_CELLS) => {
  const calls: [number, number, number, number, number][] = [];
  const statCalls: [number, number, number][] = [];
  const ticks: TickSource = {
    covered: () => true, hist: () => null,
    stat: (t0, t1, size) => (statCalls.push([t0, t1, size]), stat),
    big: (t0, t1, min, limit, size) => (calls.push([t0, t1, min, limit, size]), limit === BIG_POOL || !exact ? cells : exact(t0, t1, min, limit)),
  };
  return { ticks, calls, statCalls };
};
const run = (ticks?: TickSource, inputs: Record<string, number | string | boolean> = {}, cut = 0, style = {}, range?: { from: number; to: number }, chart = bars) =>
  computeExtras(bigTrades, { ...newInstance("bigtrades"), inputs, style }, chart, { offset: 0 }, [], { tick: 0.01, cut, ...(range ? { range } : {}), ...(ticks ? { ticks } : {}) }).objects!;

describe("sizeFractions", () => {
  it("dev > 0: trung bình ở giữa, ±dev độ lệch chuẩn là hai đầu, kẹp ngoài khoảng đó", () => {
    expect(sizeFractions([1, 5, 9], 0, 0, 2).map((x) => +x.toFixed(6))).toEqual([0.193814, 0.5, 0.806186]); // sd = 3.266, 0.5 ± 4/(2·2·3.266)
    expect(sizeFractions([0, 0, 0, 0, 0, 0, 0, 0, 0, 100], 0, 0, 1)).toEqual([...Array(9).fill(0.5 - 10 / (2 * 30)), 1]); // 1 bubble khổng lồ không ép các bubble kia về 0
  });
  it("cùng volume → ở giữa; dev = 0 → theo diện tích giữa lo và hi", () => {
    expect(sizeFractions([7, 7], 0, 0, 2)).toEqual([0.5, 0.5]);
    expect(sizeFractions([5, 25], 5, 25, 0)).toEqual([0, 1]);
  });
  it("thang theo `ref`: cùng volume thì cùng cỡ dù tập đang hiện khác nhau", () => {
    const ref = [1, 5, 9];
    expect(sizeFractions([9], 0, 0, 2, ref)).toEqual([sizeFractions(ref, 0, 0, 2)[2]]);
    expect(sizeFractions([9, 8, 7], 0, 0, 2, ref)[0]).toBe(sizeFractions(ref, 0, 0, 2)[2]);
  });
});

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

describe("bubbleX", () => {
  const t5 = [0, 300, 600];
  it("nến M5: giữa phút nằm đúng chỗ của nó trong nến, chỉ số nến - 0,5 .. + 0,5", () => {
    expect([0, 60, 120, 180, 240].map((s) => +bubbleX(t5, 300 + s, 300).toFixed(6))).toEqual([0.6, 0.8, 1, 1.2, 1.4]);
  });
  it("nến M1: đúng tâm nến", () => {
    expect([0, 60, 120].map((t) => bubbleX([0, 60, 120], t, 60))).toEqual([0, 1, 2]);
  });
  it("nến cuối, phút nằm trong khoảng nghỉ (không có nến phủ) và vùng sau nến cuối", () => {
    expect(+bubbleX(t5, 600 + 240, 300).toFixed(6)).toBe(2.4); // nến cuối
    expect(bubbleX([0, 300, 3600], 300 + 1200, 300)).toBe(1.5); // trong chỗ trống giữa hai nến: kẹp ở cuối nến trước, không tràn sang nến khác
    expect(bubbleX(t5, 600 + 900, 300)).toBe(5); // sau nến cuối quá một nến: chỉ số ngoại suy
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
    run(ticks, {}, 2);
    expect(calls).toHaveLength(1);
    expect(calls[0].slice(0, 4)).toEqual([bars[2].t, bars[19].t + M5, 1, BIG_POOL]); // cả khoảng đã nạp; các bubble của vùng nhìn chọn sau
    expect(calls[0][4]).toBeCloseTo(0.1, 9); // nến cao 2 -> 2 / 20, tick 0.01
    run(ticks, { min: 8, group: 300 });
    expect(calls[1][2]).toBe(8);
    expect(calls[1][4]).toBeCloseTo(3, 9); // 300 tick
  });

  it("Sensitivity (sigma): mặc định 3,5 và không còn ô Bubble count", () => {
    const keys = bigTrades.inputs.map((i) => i.key);
    expect(bigTrades.inputs.find((i) => i.key === "sigma")!.default).toBe(3.5);
    expect(keys).not.toContain("count");
    const cells = [cell(bars[3].t, 100, 30, 0), cell(bars[5].t, 100, 36, 0), cell(bars[8].t, 100, 50, 0), cell(bars[9].t, 100, 41, 0)];
    expect(run(source(cells, undefined, STAT).ticks, { text: true }).bubbles!.map((b) => b.text)).toEqual(["50", "41"]); // không đặt sigma: 5 + 3,5 × 10 = 40
  });

  // nến M5 của `bars`, khối 100 nến = 30 000 s: cả 20 nến nằm trong một khối
  it("zoom chỉ cắt bớt cùng một tập bubble (ngưỡng tính quanh mép phải), không thêm ô nhỏ vào", () => {
    const cells = [cell(bars[3].t, 100, 45, 0), cell(bars[5].t, 100, 39, 0), cell(bars[8].t, 100, 60, 0), cell(bars[10].t, 100, 70, 0), cell(bars[12].t, 100, 41, 0), cell(bars[14].t, 100, 55, 0), cell(bars[16].t, 100, 48, 0),
      cell(bars[17].t, 100, 50, 0), cell(bars[18].t, 100, 40, 0), cell(bars[19].t, 100, 30, 0)];
    const view = (range?: { from: number; to: number }) => run(source(cells, undefined, STAT).ticks, { sigma: 4, text: true }, 0, {}, range).bubbles!.map((b) => b.text);
    // ngưỡng 5 + 4 × 10 = 45
    expect(view()).toEqual(["70", "60", "55", "50", "48", "45"]);
    expect(view({ from: 10, to: 19 })).toEqual(["70", "55", "50", "48"]); // zoom vào: bớt ô ngoài vùng nhìn (60 / 45), 41 / 40 / 39 / 30 vẫn không hiện
    expect(view({ from: 17, to: 19 })).toEqual(["50"]);
    expect(view({ from: 0, to: 19 })).toEqual(view());
  });

  it("ngưỡng = trung bình + sigma × độ lệch chuẩn volume của mọi ô trong khoảng thống kê, hỏi thống kê theo khối cố định", () => {
    const cells = [cell(bars[3].t, 100, 30, 0), cell(bars[5].t, 100, 36, 0), cell(bars[8].t, 100, 50, 0), cell(bars[12].t, 100, 12, 0)];
    const { ticks, statCalls } = source(cells, undefined, STAT);
    const texts = (inputs: Record<string, number>) => run(ticks, { text: true, ...inputs }).bubbles!.map((b) => b.text);
    expect(texts({ sigma: 3 })).toEqual(["50", "36"]); // 5 + 3 × 10 = 35
    expect(texts({ sigma: 2 })).toEqual(["50", "36", "30"]); // 25
    expect(texts({ sigma: 0 })).toEqual(["50", "36", "30", "12"]); // 0 không phải tắt: ngưỡng = trung bình (5)
    expect(statCalls[0].slice(0, 2)).toEqual([bars[0].t, 1_020_000]); // 6 khối 30 000 s tới hết khối chứa mép phải (đóng khối, không theo nến cuối) nên khoá không đổi theo từng nến
    expect(statCalls[0][2]).toBeCloseTo(0.1, 9);
  });

  it("chưa có thống kê thì chưa có bubble; khoảng thống kê không có ô nào thì hiện mọi ô; ngưỡng không thấp hơn 1", () => {
    const cells = Array.from({ length: 10 }, (_, i) => cell(bars[i].t, 100, 21 + i, 0));
    const texts = (stat: TickStat | null, inputs: Record<string, number> = {}) => run(source(cells, undefined, stat).ticks, { text: true, ...inputs }).bubbles!.map((b) => b.text);
    expect(texts(null)).toEqual([]);
    expect(texts({ n: 0, sum: 0, sumsq: 0 }).length).toBe(10);
    expect(texts({ n: 4, sum: 0, sumsq: 0 }).length).toBe(10); // trung bình 0, độ lệch 0 -> ngưỡng 1
  });

  it("Minimum volume > 0 đặt ngưỡng cố định thay cho sigma và không hỏi thống kê", () => {
    const cells = Array.from({ length: 10 }, (_, i) => cell(bars[i].t, 100, 21 + i, 0)); // 21..30
    const { ticks, statCalls } = source(cells, undefined, STAT);
    expect(run(ticks, { sigma: 3, min: 28, text: true }).bubbles!.map((b) => b.text)).toEqual(["30", "29", "28"]); // sigma 3 sẽ đặt ngưỡng 35
    expect(statCalls).toEqual([]);
  });

  it("ô Sensitivity (sigma) xám đi khi Minimum volume > 0", () => {
    const sigma = bigTrades.inputs.find((i) => i.key === "sigma")!;
    expect(sigma.enabledIf!({ min: 0 })).toBe(true);
    expect(sigma.enabledIf!({ min: 5 })).toBe(false);
  });

  it("trần số bubble hiện cùng lúc là MAX_SHOWN: giữ các ô lớn nhất của vùng nhìn", () => {
    const cells = Array.from({ length: MAX_SHOWN + 10 }, (_, i) => cell(bars[i % 20].t, 100 + i, 1 + i, 0)); // volume 1..310
    const b = run(source(cells).ticks, { text: true }).bubbles!;
    expect(b).toHaveLength(MAX_SHOWN);
    expect([b[0].text, b[b.length - 1].text]).toEqual(["310", "11"]);
  });

  it("vùng nhìn bắt đầu trước nến đầu của chart (cut) thì kẹp vào nến đầu", () => {
    const cells = [cell(bars[1].t, 100, 90, 0), cell(bars[4].t, 100, 5, 0)];
    expect(run(source(cells).ticks, { text: true }, 3, {}, { from: 3, to: 19 }).bubbles!.map((b) => b.text)).toEqual(["5"]);
  });

  it("pool chưa đầy: đã đủ dữ liệu, không hỏi thêm dù vùng nhìn có ít ô", () => {
    const { ticks, calls } = source([cell(bars[12].t, 100, 9, 0)], () => []);
    run(ticks, {}, 0, {}, { from: 10, to: 19 });
    expect(calls).toHaveLength(1);
  });

  it("pool đầy mà thiếu ô trong vùng nhìn: hỏi riêng khoảng thiếu, kết quả đó thay phần lấy từ pool", () => {
    const pool = Array.from({ length: BIG_POOL }, (_, i) => cell(bars[i % 8].t, 100 + i, 100 + i, 0)); // pool toàn ô ở nến 0..7 (volume >= 100); sau đó chỉ có ô nhỏ hơn mọi ô của pool
    const rest = [cell(bars[12].t, 100, 40, 0), cell(bars[13].t, 100, 3, 0), cell(bars[14].t, 100, 8, 0), cell(bars[15].t, 100, 7, 0), cell(bars[17].t, 100, 6, 0), cell(bars[18].t, 100, 5, 0), cell(bars[19].t, 100, 4, 0)];
    const exact = (t0: number, t1: number, min: number, limit: number) => rest.filter((k) => k.t >= t0 && k.t < t1 && k.up >= min).sort((a, b) => b.up - a.up).slice(0, limit);
    const { ticks, calls } = source(pool, exact, STAT);
    const b = run(ticks, { sigma: 0.2, text: true }, 0, {}, { from: 11, to: 19 }).bubbles!; // ngưỡng 5 + 0,2 × 10 = 7
    expect(calls).toHaveLength(2);
    expect(calls[1].slice(0, 4)).toEqual([bars[0].t, bars[19].t + M5, 7, MAX_SHOWN]); // vùng nhìn nới ra theo khối 30 000 s (cắt ở đầu tick / hết nến cuối): ô >= ngưỡng; pool không có ô nào ở đó nên hỏi riêng
    expect(b.map((x) => x.text)).toEqual(["40", "8", "7"]);
  });

  it("đang chờ kết quả hỏi riêng thì vẫn hiện bubble lấy từ pool (không nhấp nháy)", () => {
    const pool = Array.from({ length: BIG_POOL }, (_, i) => cell(bars[i % 8].t, 100 + i, 100 + i, 0));
    pool.push(cell(bars[12].t, 100, 40, 0));
    const { ticks, calls } = source(pool, () => null, STAT);
    const b = run(ticks, { sigma: 0.2, text: true }, 0, {}, { from: 11, to: 19 }).bubbles!; // ngưỡng 7; vùng nhìn không có ô nào trong pool trừ ô 40 ở nến 12
    expect(calls).toHaveLength(2);
    expect(b.map((x) => x.text)).toEqual(["40"]);
  });

  it("zoom (mép phải giữ nguyên) không đổi cỡ và độ đậm của bubble: thang theo quanh mép phải, không theo riêng các ô đang hiện", () => {
    const cells = [cell(bars[1].t, 100, 90, 0), cell(bars[2].t, 100, 80, 0), cell(bars[3].t, 100, 70, 0), cell(bars[16].t, 100, 9, 0), cell(bars[17].t, 100, 8, 0), cell(bars[18].t, 100, 7, 0)];
    const view = (range?: { from: number; to: number }) => run(source(cells).ticks, { text: true }, 0, {}, range).bubbles!.find((b) => b.text === "9")!;
    const wide = view(), zoomed = view({ from: 10, to: 19 }); // vùng nhìn 10 nến chỉ có 9 / 8 / 7: theo thang riêng của các ô đang hiện thì "9" sẽ thành bubble lớn nhất
    expect(zoomed.r).toBe(wide.r);
    expect(zoomed.bg).toBe(wide.bg);
    expect(view({ from: 0, to: 19 }).r).toBe(wide.r);
  });

  it("kéo về đoạn vắng: thang theo đoạn đó, không phải chấm nhỏ nhất vì cả chart có đoạn dữ dội hơn nhiều", () => {
    const chart = Array.from({ length: 400 }, (_, i) => bar(1_000_000 + i * M5)); // 400 nến M5 = 4 khối 30 000 s: nến 0..66 / 67..166 / 167..266 / 267..366 / 367..399
    const cells = [cell(chart[5].t, 100, 10, 0), cell(chart[6].t, 100, 12, 0), cell(chart[7].t, 100, 8, 0), cell(chart[395].t, 100, 100, 0), cell(chart[396].t, 100, 120, 0), cell(chart[397].t, 100, 90, 0)];
    const quiet = run(source(cells).ticks, { text: true }, 0, {}, { from: 0, to: 70 }, chart).bubbles!; // mép phải ở nến 70: thang lấy nến 0..166, không có ô dữ dội ở cuối
    expect(quiet.map((b) => b.text)).toEqual(["12", "10", "8"]);
    expect(quiet.find((b) => b.text === "12")!.r * 2).toBeGreaterThan(30); // theo thang chung với ô 120 thì chỉ 5 (nhỏ nhất)
  });

  it("refRange: khối 100 nến cố định theo giờ, lấy khối chứa mép phải và các khối trước nó, cắt ở hết nến cuối và đầu tick", () => {
    const cells = Array.from({ length: 10 }, (_, i) => cell(i * 100, 1, i + 1, 0)); // ô ở t 0..900 volume 1..10
    const vol = (r: TickCell[]) => r.map((k) => k.up).sort((a, c) => a - c);
    const ref = (viewEnd: number, end: number, t0: number, blocks?: number) => vol(topInRange(cells, ...refRange(viewEnd, end, t0, 2, blocks), 100)); // nến 2 s: khối 200 s
    expect(refRange(450, 1000, 0, 2)).toEqual([200, 600]);
    expect(ref(450, 1000, 0)).toEqual([3, 4, 5, 6]); // mép phải 450 ở khối 400..600, cộng khối 200..400 -> ô t 200..500
    expect(ref(450, 1000, 0, 6)).toEqual([1, 2, 3, 4, 5, 6]); // nhiều khối hơn nhưng không sớm hơn đầu tick
    expect(ref(450, 500, 0)).toEqual([3, 4, 5]); // cắt ở hết nến cuối (500)
    expect(ref(150, 1000, 300)).toEqual([]); // không sớm hơn đầu tick
  });

  it("Maximum volume chỉ có tác dụng khi Standard deviation = 0 (ô xám đi khi > 0)", () => {
    const max = bigTrades.inputs.find((i) => i.key === "max")!;
    expect(max.enabledIf!({ dev: 2 })).toBe(false);
    expect(max.enabledIf!({ dev: 0 })).toBe(true);
  });

  it("chưa có tick (tắt / chưa nạp xong) thì không có bubble", () => {
    expect(run(undefined).bubbles).toEqual([]);
    expect(run(source(null).ticks).bubbles).toEqual([]);
  });

  it("bubble nằm ở nến chứa phút của ô, đúng giá, màu theo bên nhiều volume hơn", () => {
    const t = bars[5].t;
    const { ticks } = source([cell(t + 60, 101.5, 8, 2), cell(t + 240, 99.5, 1, 6), cell(bars[7].t, 100, 3, 3)]);
    const b = run(ticks, { text: false, opacityMin: 72, opacityMax: 72 }).bubbles!;
    const at = (y: number) => b.find((x) => x.y === y)!;
    expect(at(101.5)).toMatchObject({ x: 4.8, bg: "#26a69ab8" }); // mua nhiều hơn; phút thứ 2 của nến 5 phút: giữa phút ở 0,3 bề rộng nến (chỉ số 5 - 0,5 + 0,3)
    expect(at(99.5)).toMatchObject({ x: 5.4, bg: "#f23645b8" }); // bán nhiều hơn; phút thứ 5
    expect(at(100)).toMatchObject({ x: 6.6, bg: "#26a69ab8" }); // bằng nhau: bên mua; phút đầu của nến 7
    expect(at(101.5).text).toBeUndefined();
  });

  it("các phút của cùng một nến cùng row giá không chồng đúng lên nhau: x khác nhau theo phút, vẫn trong nến", () => {
    const t = bars[5].t;
    const b = run(source([cell(t, 100, 40, 0), cell(t + 60, 100, 41, 0), cell(t + 120, 100, 42, 0), cell(t + 180, 100, 43, 0), cell(t + 240, 100, 44, 0)]).ticks).bubbles!;
    const xs = b.map((x) => +x.x.toFixed(6)).sort((a, c) => a - c);
    expect(xs).toEqual([4.6, 4.8, 5, 5.2, 5.4]);
    expect(new Set(xs).size).toBe(5);
  });

  it("cỡ theo volume giữa ô nhỏ nhất và lớn nhất; Minimum / Maximum volume đặt thang; bubble lớn đứng trước", () => {
    const cells = [cell(bars[1].t, 100, 5, 0), cell(bars[2].t, 100, 25, 0), cell(bars[3].t, 100, 0, 15)];
    const b = run(source(cells).ticks, { minSize: 10, maxSize: 50, text: true, dev: 0 }).bubbles!;
    expect(b.map((x) => x.r * 2)).toEqual([50, 10 + 40 * Math.sqrt(0.5), 10]); // 25, 15, 5 theo thứ tự lớn -> nhỏ
    expect(b.map((x) => x.text)).toEqual(["25", "15", "5"]);
    const fixed = run(source(cells).ticks, { min: 1, max: 100, minSize: 10, maxSize: 50, dev: 0 }).bubbles!;
    expect(fixed[0].r * 2).toBeCloseTo(10 + 40 * Math.sqrt(24 / 99), 9);
  });

  it("mặc định: Minimum 5 / Maximum 50 như ATAS; cỡ theo độ lệch chuẩn (2), đậm dần 40% → 90%, volume hiện cỡ 11, không rỗng", () => {
    const b = run(source([cell(bars[0].t, 100, 1, 0), cell(bars[1].t, 100, 9, 0)]).ticks).bubbles!;
    expect(b.map((x) => x.r * 2)).toEqual([38.75, 16.25]); // trung bình 5, độ lệch 4: z = ±4/(2·2·4) = ±0.25 quanh giữa
    expect(b.map((x) => x.text)).toEqual(["9", "1"]);
    expect(b[0]).toMatchObject({ textSize: 11, textColor: "#ffffff", border: lighten("#26a69a", 0.6) });
    expect(b[0].bg).toBe(`#26a69a${Math.round((0.4 + 0.5 * 0.75) * 255).toString(16)}`);
  });

  it("dev = 0: cỡ và độ đậm chạy hết từ nhỏ nhất tới lớn nhất theo diện tích giữa Minimum / Maximum volume", () => {
    const b = run(source([cell(bars[0].t, 100, 1, 0), cell(bars[1].t, 100, 9, 0)]).ticks, { dev: 0 }).bubbles!;
    expect(b.map((x) => x.r * 2)).toEqual([50, 5]);
    expect(b.map((x) => x.bg)).toEqual(["#26a69ae6", "#26a69a66"]); // 90% và 40%
  });

  it("Hollow fill: nền trong suốt, viền màu bên mua/bán dày 2px, vẫn đậm dần theo cỡ", () => {
    const b = run(source([cell(bars[0].t, 100, 1, 0), cell(bars[1].t, 100, 0, 9)]).ticks, { hollow: true, dev: 0 }).bubbles!;
    expect(b.map((x) => x.bg)).toEqual(["#f2364500", "#26a69a00"]);
    expect(b.map((x) => x.border)).toEqual(["#f23645e6", "#26a69a66"]);
    expect(b.every((x) => x.borderWidth === 2)).toBe(true);
  });

  it("Text size / Volume text lấy từ input và Style", () => {
    const b = run(source([cell(bars[0].t, 100, 4, 0)]).ticks, { textSize: 14 }, 0, { items: { text: { color: "#ffcc00" } } }).bubbles![0];
    expect(b).toMatchObject({ text: "4", textSize: 14, textColor: "#ffcc00" });
  });

  it("màu và độ trong suốt lấy từ Style / Opacity", () => {
    const style = { items: { buy: { color: "#112233" } } };
    const b = run(source([cell(bars[0].t, 100, 4, 0)]).ticks, { opacityMin: 50, opacityMax: 50 }, 0, style).bubbles![0];
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
    const b = run(source([cell(bars[0].t, 100, 1500, 0), cell(bars[1].t, 100, 2_300_000, 0)]).ticks, { text: true }).bubbles!;
    expect(b.map((x) => x.text)).toEqual(["2.3M", "1.5K"]);
  });
});
