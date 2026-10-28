import type { Bar, FpCell } from "@/lib/api";
import { describe, expect, it, vi } from "vitest";
import { computeExtras } from "../engine";
import { newInstance } from "../instance";
import type { TickSource } from "../schema";
import { MAX_FP_ROWS, fpBar, fpPair, fpRowSize, fpText, footprint, isImbalance, stackedRuns, type ImbalanceOpts } from "./footprint";

const M5 = 300;
const W = M5 * 64; // cửa sổ xin tick
const T0 = 100 * W; // nến đầu đúng đầu cửa sổ
const bar = (i: number, over: Partial<Bar> = {}): Bar => ({ t: T0 + i * M5, o: 100, h: 110, l: 90, c: 105, v: 1, ...over });
const bars = Array.from({ length: 200 }, (_, i) => bar(i));
const imb = (over: Partial<ImbalanceOpts> = {}): ImbalanceOpts => ({ enabled: true, pct: 300, minDiff: 0, zero: true, stacked: true, stackN: 3, ...over });

describe("fpRowSize", () => {
  const flat = (range: number, n = 40): Bar[] => Array.from({ length: n }, (_, i) => bar(i, { o: 100, c: 100, h: 100 + range, l: 100 }));
  const inputs = (over = {}) => ({ rowMode: "Auto", atrLen: 14, ticks: 10, ...over });
  it("Manual: số tick user đặt", () => {
    expect(fpRowSize(flat(10), 0.01, inputs({ rowMode: "Manual", ticks: 25 }))).toBeCloseTo(0.25, 12);
  });
  it("Auto: 0.2 × ATR làm tròn nấc 1 / 2 / 5, không nhỏ hơn 1 tick", () => {
    expect(fpRowSize(flat(10), 0.01, inputs())).toBeCloseTo(2, 9); // 0.2 × 10 = 2.0
    expect(fpRowSize(flat(60), 0.01, inputs())).toBeCloseTo(10, 9); // 12 -> 10
    expect(fpRowSize(flat(0.01), 0.01, inputs())).toBeCloseTo(0.01, 12);
    expect(fpRowSize([], 0.01, inputs())).toBeCloseTo(0.01, 12);
  });
  it("Auto: nến đang chạy (nến cuối) không đổi row size", () => {
    const base = flat(10, 60);
    const spiky = [...base.slice(0, -1), bar(59, { o: 100, c: 100, h: 1000, l: 100 })]; // nến cuối đang chạy giãn rất rộng
    expect(fpRowSize(spiky, 0.01, inputs())).toBeCloseTo(fpRowSize(base, 0.01, inputs()), 12);
  });
  it("Auto: một nến đã đóng biến động mạnh chưa làm nhảy nấc (trung vị nhiều nến)", () => {
    const quiet = flat(10, 60);
    const withSpike = [...quiet, bar(60, { o: 100, c: 100, h: 200, l: 100 }), bar(61, { o: 100, c: 100, h: 110, l: 100 })]; // ATR nến cuối đóng tăng ~64%: cách cũ nhảy 2 -> 5
    expect(fpRowSize(quiet, 0.01, inputs())).toBeCloseTo(2, 9);
    expect(fpRowSize(withSpike, 0.01, inputs())).toBeCloseTo(2, 9);
  });
  it("Auto: biến động đổi hẳn thì row size đổi theo", () => {
    const calm = flat(10, 60);
    const wild = [...calm, ...flat(60, 60).map((b, i) => ({ ...b, t: T0 + (60 + i) * M5 }))];
    expect(fpRowSize(wild, 0.01, inputs())).toBeCloseTo(10, 9);
  });
  it("nến quá cao so với row (1 tick / row trên khung lớn): row cao thêm để mỗi nến không quá MAX_FP_ROWS row", () => {
    const tall = flat(5000); // biên độ 5000 giá, tick 0.01 = 500 000 tick
    const size = fpRowSize(tall, 0.01, inputs({ rowMode: "Manual", ticks: 1 }));
    expect(5000 / size).toBeLessThanOrEqual(MAX_FP_ROWS + 1e-6);
    expect(fpRowSize(flat(1), 0.01, inputs({ rowMode: "Manual", ticks: 1 }))).toBeCloseTo(0.01, 12); // nến thường: đúng như user đặt
    const rows = Array.from({ length: 200_000 }, (_, i): [number, number, number] => [i, 1, 0]);
    expect(() => fpBar(0, tall[0], rows, 0.01, 70, { enabled: true, pct: 300, minDiff: 0, zero: false, stacked: false, stackN: 3 })).not.toThrow(); // không spread hàng trăm nghìn phần tử
  });

  it("Auto: chỉ có một nến thì dùng nến đó", () => {
    expect(fpRowSize(flat(10, 1), 0.01, inputs({ atrLen: 1 }))).toBeCloseTo(2, 9);
  });
});

describe("imbalance", () => {
  it("bên lớn >= pct% bên nhỏ và chênh >= minDiff; đối diện 0 tuỳ `zero`", () => {
    expect(isImbalance(30, 10, imb())).toBe(true); // đúng 300%
    expect(isImbalance(29, 10, imb())).toBe(false);
    expect(isImbalance(30, 10, imb({ minDiff: 21 }))).toBe(false);
    expect(isImbalance(5, 0, imb())).toBe(true);
    expect(isImbalance(5, 0, imb({ zero: false }))).toBe(false);
    expect(isImbalance(0, 0, imb())).toBe(false);
  });
  it("stackedRuns: chỉ chuỗi >= n row liên tiếp", () => {
    expect(stackedRuns([true, true, false, true, true, true, true, false, true], 3)).toEqual([false, false, false, true, true, true, true, false, false]);
    expect(stackedRuns([], 3)).toEqual([]);
  });
});

describe("fpBar", () => {
  const b = bar(0);
  it("không có tick: không row, không POC", () => {
    expect(fpBar(7, b, [], 1, 70, imb())).toMatchObject({ x: 7, rows: [], poc: -1, vl: -1, vh: -1, buyImb: [] });
  });

  it("row liên tục từ thấp tới cao (row trống = 0), cộng dồn ô cùng row, p = row × size", () => {
    const f = fpBar(0, b, [[102, 1, 0], [100, 2, 3], [100, 1, 1]], 0.5, 70, imb({ enabled: false }));
    expect(f.rows).toEqual([{ p: 50, up: 3, dn: 4 }, { p: 50.5, up: 0, dn: 0 }, { p: 51, up: 1, dn: 0 }]);
    expect(f.poc).toBe(0); // 7 lớn nhất
  });

  it("imbalance chéo: mua ở row i so với bán ở row i-1, bán ở row i so với mua ở row i+1", () => {
    // (up, dn): r0 (1, 30) | r1 (5, 4) | r2 (20, 6) | r3 (3, 0)
    const f = fpBar(0, b, [[0, 1, 30], [1, 5, 4], [2, 20, 6], [3, 3, 0]], 1, 70, imb({ stacked: false }));
    expect(f.buyImb).toEqual([false, false, true, false]); // r2: 20 >= 3 × 4 (bán r1); r1: 5 < 3 × 30; r3: 3 < 3 × 6
    expect(f.sellImb).toEqual([true, false, false, false]); // r0: 30 >= 3 × 5 (mua r1); r2: 6 < 3 × 3; r3 không có bán
    expect(f.stackBuy).toEqual([false, false, false, false]);
  });

  it("tắt imbalance: không cờ nào; stacked: chuỗi buy imbalance từ 3 row trở lên được đánh dấu", () => {
    const cells: [number, number, number][] = [0, 1, 2, 3, 4].map((r) => [r, 10, 1]);
    expect(fpBar(0, b, cells, 1, 70, imb({ enabled: false })).buyImb.some(Boolean)).toBe(false);
    const f = fpBar(0, b, cells, 1, 70, imb()); // r1..r4: 10 >= 3 × 1 -> chuỗi 4 row
    expect(f.buyImb).toEqual([false, true, true, true, true]);
    expect(f.stackBuy).toEqual([false, true, true, true, true]);
    expect(fpBar(0, b, cells, 1, 70, imb({ stackN: 5 })).stackBuy.some(Boolean)).toBe(false);
  });

  it("POC = row nhiều volume nhất; Value Area bao POC và đủ % tổng volume (như volume profile)", () => {
    // tổng (lên + xuống): r0 5, r1 10, r2 40, r3 20, r4 5 -> tổng 80
    const f = fpBar(0, b, [[0, 3, 2], [1, 5, 5], [2, 25, 15], [3, 10, 10], [4, 2, 3]], 1, 70, imb({ enabled: false }));
    expect(f.poc).toBe(2);
    expect(f.vl).toBeLessThanOrEqual(2);
    expect(f.vh).toBeGreaterThanOrEqual(2);
    const inVa = f.rows.slice(f.vl, f.vh + 1).reduce((s, r) => s + r.up + r.dn, 0);
    expect(inVa / 80).toBeGreaterThanOrEqual(0.5); // POC 40 + hàng xóm lớn nhất 20 = 60 / 80 > 70% mục tiêu 56
  });
});

describe("fpPair", () => {
  it("[sell, buy]: Normal đủ số, K gọn, Auto đủ số nếu cả hai số vừa", () => {
    expect(fpPair(35, 61, "normal")).toEqual(["35", "61"]);
    expect(fpPair(1234, 61, "normal")).toEqual(["1234", "61"]);
    expect(fpPair(1234, 61, "k")).toEqual(["1.2K", "61"]);
    expect(fpPair(1234, 61, "auto")).toEqual(["1234", "61"]);
    expect(fpPair(1234, 61, "auto", (a, b) => !(a === "1234" && b === "61"))).toEqual(["1.2K", "61"]);
    expect(fpPair(0, 3, "auto")).toEqual(["0", "3"]); // số 0 vẫn hiện như ATAS
  });
});

describe("fpText", () => {
  it("Normal luôn đủ số, K luôn gọn từ 1000, Auto đủ số nếu vừa ô không thì gọn", () => {
    expect(fpText(1234, "normal")).toBe("1234");
    expect(fpText(1234, "k")).toBe("1.2K");
    expect(fpText(999, "k")).toBe("999");
    expect(fpText(1234, "auto")).toBe("1234");
    expect(fpText(1234, "auto", (s) => s.length <= 4 && s !== "1234")).toBe("1.2K");
    expect(fpText(-2500, "k")).toBe("-2.5K");
  });
});

// --- indicator: footprints(ctx) --------------------------------------------------------------------------------
type Fp = NonNullable<TickSource["fp"]>;
const run = (fp: Fp | undefined, range: { from: number; to: number }, inputs: Record<string, number | string | boolean> = {}, covered = true) => {
  const ticks: TickSource | undefined = fp ? { covered: () => covered, hist: () => null, fp } : undefined;
  return computeExtras(footprint, { ...newInstance("footprint"), inputs: { rowMode: "Manual", ticks: 1, ...inputs } }, bars, { offset: 0 }, [], { tick: 1, cut: 0, range, ...(ticks ? { ticks } : {}) }).footprints!;
};

describe("footprint.footprints", () => {
  it("xin tick theo cửa sổ 64 nến quanh vùng nhìn (có đệm), cùng cửa sổ chỉ một lần, row size đúng", () => {
    const fp = vi.fn<Fp>(() => []);
    const out = run(fp, { from: 70, to: 80 }); // đệm 40: nến 30..120 -> cửa sổ 0 (nến 0-63) và 1 (nến 64-127)
    expect(fp).toHaveBeenCalledTimes(2);
    const [starts0, end0, size0] = fp.mock.calls[0];
    expect(starts0).toHaveLength(64);
    expect(starts0[0]).toBe(T0);
    expect(end0).toBe(bars[63].t + M5);
    expect(size0).toBe(1);
    expect(fp.mock.calls[1][0][0]).toBe(bars[64].t);
    expect(out.bars.map((b) => b.x)).toEqual(Array.from({ length: 91 }, (_, i) => 30 + i));
  });

  it("ô của nến k (chỉ số trong danh sách gửi đi) về đúng nến; nến không có ô: chỉ nến, không row", () => {
    const cells: FpCell[] = [[5, 100, 2, 1], [5, 101, 0, 4], [6, 100, 3, 0]];
    const out = run(() => cells, { from: 5, to: 7 });
    const at = (x: number) => out.bars.find((b) => b.x === x)!;
    expect(at(5).rows).toEqual([{ p: 100, up: 2, dn: 1 }, { p: 101, up: 0, dn: 4 }]);
    expect(at(6).rows).toEqual([{ p: 100, up: 3, dn: 0 }]);
    expect(at(7)).toMatchObject({ rows: [], o: 100, h: 110, l: 90, c: 105 });
  });

  it("mặc định đối diện = 0 không tính imbalance (tick chỉ vào một bên); bật Include zero thì tính", () => {
    const cells: FpCell[] = [[5, 100, 2, 0], [5, 101, 5, 0]]; // r101: mua 5 so với bán 0 ở r100
    const at = (inputs = {}) => run(() => cells, { from: 5, to: 5 }, inputs).bars.find((b) => b.x === 5)!;
    expect(at().buyImb).toEqual([false, false]);
    expect(at({ imbZero: true }).buyImb).toEqual([false, true]);
  });

  it("chưa nạp xong (fp trả null) / tick chưa phủ tới / không có nguồn tick: chỉ vẽ nến", () => {
    expect(run(() => null, { from: 5, to: 7 }).bars.every((b) => b.rows.length === 0)).toBe(true);
    expect(run(() => [[0, 100, 1, 1]], { from: 5, to: 7 }, {}, false).bars.every((b) => b.rows.length === 0)).toBe(true);
    const noTicks = run(undefined, { from: 5, to: 7 });
    expect(noTicks.bars.length).toBeGreaterThan(0);
    expect(noTicks.bars.every((b) => b.rows.length === 0)).toBe(true);
  });

  it("vùng nhìn quá rộng (> 150 nến): không xin tick; giới hạn theo vùng nhìn, không tính phần đệm (cùng mức zoom ở mép phải hay giữa lịch sử như nhau)", () => {
    const fp = vi.fn<Fp>(() => []);
    run(fp, { from: 0, to: 199 });
    expect(fp).not.toHaveBeenCalled();
    run(fp, { from: 50, to: 179 }); // 130 nến, cả hai bên có đệm 40
    expect(fp).toHaveBeenCalled();
  });

  it("cỡ chữ mặc định 14 (như ATAS), user đặt thì theo user", () => {
    const size = (inputs = {}) => run(() => [], { from: 5, to: 7 }, inputs).style.textSize;
    expect(size()).toBe(14);
    expect(size({ textSize: 9 })).toBe(9);
  });

  it("Mode mặc định là Box (ô tô kín như ATAS), chọn Profile thì thanh theo volume", () => {
    const mode = (inputs = {}) => run(() => [], { from: 5, to: 7 }, inputs).style.mode;
    expect(mode()).toBe("box");
    expect(mode({ mode: "Profile" })).toBe("profile");
  });

  it("Type: Bid x Ask (mặc định) / Delta / Volume / Delta + Volume, không còn kiểu hai cột; giá trị lạ về Bid x Ask", () => {
    const type = (t?: string) => run(() => [], { from: 5, to: 7 }, t === undefined ? {} : { type: t }).style.type;
    expect(type()).toBe("bidask");
    expect(type("Bid x Ask")).toBe("bidask");
    expect(type("Delta")).toBe("delta");
    expect(type("Volume")).toBe("volume");
    expect(type("Delta + Volume")).toBe("deltavol");
    expect(type("Bid x Ask (1 column)")).toBe("bidask"); // tên tạm đã bỏ
    expect((footprint.inputs.find((i) => i.key === "type") as { options: string[] }).options).toEqual(["Bid x Ask", "Delta", "Volume", "Delta + Volume"]);
  });

  it("style từ inputs / items; hook ticks xin từ nến đầu vùng nhìn (có đệm)", () => {
    const out = run(() => [], { from: 5, to: 7 }, { type: "Delta + Volume", mode: "Box", color: "Fixed", textFormat: "K", summary: false });
    expect(out.style).toMatchObject({ type: "deltavol", mode: "box", color: "fixed", textFormat: "k", summary: false, buy: "#26a69a", sell: "#f23645" });
    const need = footprint.ticks!({}, { bars, cut: 0, step: M5, calendar: { offset: 0 }, range: { from: 70, to: 80 } });
    expect(need).toEqual({ from: bars[30].t });
    expect(footprint.ticks!({}, { bars, cut: 0, step: M5, calendar: { offset: 0 } })).toBeNull();
  });
});
