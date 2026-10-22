import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { byId } from "../catalog";
import { computeExtras } from "../engine";
import { newInstance } from "../instance";
import { profileSource, rangeLowerTf, svp, vrvp } from "./volumeProfile";

const DAY = 86400;
const M15 = 900;
const bar = (t: number, o: number, h: number, l: number, c: number, v: number): Bar => ({ t, o, h, l, c, v });
// n nến chart M15 bắt đầu 00:00 broker (offset 0) của ngày `day`; giá dao động quanh 100, volume 10
const chart = (day: number, n: number): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const mid = 100 + Math.sin(i / 4) * 5;
    return bar(day * DAY + i * M15, mid, mid + 1, mid - 1, mid + (i % 2 ? 0.5 : -0.5), 10);
  });
// nến M1 mô phỏng trong [t0, t1): giá quanh 100, volume 1
const m1 = (t0: number, t1: number): Bar[] =>
  Array.from({ length: (t1 - t0) / 60 }, (_, i) => {
    const p = 100 + Math.sin(i / 17) * 4;
    return bar(t0 + i * 60, p, p + 0.4, p - 0.4, p + (i % 2 ? 0.2 : -0.2), 1);
  });

describe("profileSource", () => {
  const c = chart(10, 8); // 8 nến M15 = 7200s từ 10*DAY
  const t0 = 10 * DAY;
  it("không có nến khung nhỏ: nến chart trong khoảng", () => {
    expect(profileSource(c, [], t0 + M15, t0 + 3 * M15, M15).map((b) => b.t)).toEqual([t0 + M15, t0 + 2 * M15]);
  });
  it("có nến khung nhỏ phủ hết: chỉ dùng chúng", () => {
    const fine = m1(t0, t0 + 8 * M15);
    const s = profileSource(c, fine, t0, t0 + 8 * M15, M15);
    expect(s).toHaveLength(8 * 15);
    expect(s.every((b) => b.v === 1)).toBe(true);
  });
  it("lỗ hổng trong dữ liệu khung nhỏ được lấp bằng nến chart, kết quả tăng dần", () => {
    const fine = [...m1(t0, t0 + 2 * M15), ...m1(t0 + 4 * M15, t0 + 8 * M15)]; // thiếu nến chart #2, #3
    const s = profileSource(c, fine, t0, t0 + 8 * M15, M15);
    expect(s.filter((b) => b.v === 10).map((b) => b.t)).toEqual([t0 + 2 * M15, t0 + 3 * M15]);
    expect(s.every((b, i) => i === 0 || b.t >= s[i - 1].t)).toBe(true);
    expect(s.reduce((a, b) => a + b.v, 0)).toBe(6 * 15 + 2 * 10);
  });
  it("không lấy nến ngoài khoảng", () => {
    const fine = m1(t0 - M15, t0 + 8 * M15);
    expect(profileSource(c, fine, t0, t0 + M15, M15).every((b) => b.t >= t0 && b.t < t0 + M15)).toBe(true);
  });
});

describe("Session Volume Profile", () => {
  // 3 ngày broker, 96 nến M15 mỗi ngày; M1 chỉ phủ ngày 2 và 3
  const bars = [...chart(20, 96), ...chart(21, 96), ...chart(22, 96)];
  const lower = m1(21 * DAY, 23 * DAY);
  const def = byId("svp");
  const run = (inputs: Record<string, number | string | boolean> = {}, cut = 0, b = bars, low = lower, tick = 0.01) =>
    computeExtras(def, { ...newInstance("svp"), inputs }, b, { offset: 0 }, low, { tick, cut }).profiles!;

  it("mỗi phiên một profile với x1/x2 là chỉ số nến đầu/cuối", () => {
    const p = run();
    expect(p.profiles.map((x) => [x.x1, x.x2])).toEqual([[0, 95], [96, 191], [192, 287]]);
    expect(p.style.pinned).toBe(false);
  });

  it("tổng volume các row = tổng volume nguồn: phiên 1 từ nến chart, phiên 2-3 từ M1", () => {
    const p = run();
    const sum = (x: number[]) => x.reduce((a, b) => a + b, 0);
    expect(sum(p.profiles[0].total)).toBeCloseTo(96 * 10, 6);
    expect(sum(p.profiles[1].total)).toBeCloseTo(96 * 15, 6);
    expect(sum(p.profiles[2].total)).toBeCloseTo(96 * 15, 6);
  });

  it("phiên nằm hẳn trong lịch sử ẩn (trước cut) bị bỏ", () => {
    expect(run({}, 100).profiles.map((x) => x.x1)).toEqual([96, 192]);
  });

  it("Session Week gom cả ba ngày ngày đó vào ít phiên hơn", () => {
    expect(run({ session: "Week" }).profiles.length).toBeLessThan(3);
  });

  it("Ticks Per Row cho số row khác Number Of Rows", () => {
    const rows = run({ rows: 10 }).profiles[0].N;
    const ticks = run({ layout: "Ticks Per Row", rows: 100 }, 0, bars, lower, 0.01).profiles[0].N;
    expect(rows).toBeGreaterThanOrEqual(8);
    expect(rows).toBeLessThanOrEqual(12);
    expect(ticks).not.toBe(rows);
  });

  it("khung từ D1 trở lên: không có phiên", () => {
    const daily = Array.from({ length: 10 }, (_, i) => bar((30 + i) * DAY, 1, 2, 0, 1, 5));
    expect(run({}, 0, daily, []).profiles).toEqual([]);
  });

  it("style lấy từ inputs và items (ẩn VAH, đổi màu POC)", () => {
    const inst = { ...newInstance("svp"), inputs: { volume: "Delta", width: 50, place: "Right", values: true, extend: true }, style: { items: { vah: { visible: false as const }, poc: { color: "#123456", width: 3 } } } };
    const s = computeExtras(def, inst, bars, { offset: 0 }, lower, { tick: 0.01, cut: 0 }).profiles!.style;
    expect(s).toMatchObject({ volume: "delta", width: 50, place: "right", values: true, extend: true, pinned: false });
    expect(s.vah.show).toBe(false);
    expect(s.val.show).toBe(true);
    expect(s.poc).toMatchObject({ color: "#123456", width: 3, show: true });
  });

  it("không nến / ít nến: không ném lỗi", () => {
    expect(run({}, 0, [], []).profiles).toEqual([]);
    expect(run({}, 0, bars.slice(0, 1), []).profiles.length).toBeLessThanOrEqual(1);
  });

  it("lower: M1 rồi lùi khung thô, phủ từ đầu phiên của nến chart đầu; D1 thì không cần", () => {
    const info = { bars, cut: 100, step: M15, calendar: { offset: 0 } };
    const n = svp.lower!({ session: "Day" }, info)!;
    expect(n.tfs).toEqual(["M1", "M5"]);
    expect(n.from).toBe(21 * DAY); // nến đầu chart là nến thứ 100 (ngày 21)
    expect(svp.lower!({ session: "Day" }, { ...info, step: DAY })).toBeNull();
  });
});

describe("Visible Range Volume Profile", () => {
  const bars = chart(40, 96);
  const lower = m1(40 * DAY, 41 * DAY);
  const def = byId("vrvp");
  const run = (range: { from: number; to: number } | undefined, low: Bar[] = lower) =>
    computeExtras(def, newInstance("vrvp"), bars, { offset: 0 }, low, { tick: 0.01, cut: 0, ...(range ? { range } : {}) }).profiles!;

  it("một profile ghim cho đúng vùng nhìn", () => {
    const p = run({ from: 10, to: 29 });
    expect(p.style.pinned).toBe(true);
    expect(p.style.place).toBe("right");
    expect(p.profiles).toHaveLength(1);
    expect(p.profiles[0]).toMatchObject({ x1: 10, x2: 29 });
    const total = p.profiles[0].total.reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(20 * 15, 6); // 20 nến chart × 15 nến M1 × volume 1
  });

  it("không biết vùng nhìn: dùng cả chart; vùng khác nhau cho profile khác nhau", () => {
    expect(run(undefined).profiles[0]).toMatchObject({ x1: 0, x2: 95 });
    const a = run({ from: 0, to: 20 }).profiles[0];
    const b = run({ from: 70, to: 95 }).profiles[0];
    expect(a.total.length === b.total.length && a.total.every((x, i) => x === b.total[i])).toBe(false);
  });

  it("chưa có nến khung nhỏ: dùng nến chart", () => {
    const p = run({ from: 0, to: 9 }, []);
    expect(p.profiles[0].total.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 6);
  });

  it("lower: khung nhỏ đầu tiên có dưới 5000 nến trong vùng, cộng các khung thô hơn", () => {
    expect(rangeLowerTf(M15, 20 * M15)).toBe("M1");
    expect(rangeLowerTf(3600, 400 * 3600)).toBe("M5"); // 400h = 24000 phút ≥ 5000 -> M5 (4800 nến)
    expect(rangeLowerTf(60, 1000)).toBeNull(); // chart M1: không có khung nhỏ hơn
    const n = vrvp.lower!({}, { bars, cut: 0, step: M15, calendar: { offset: 0 }, range: { from: 10, to: 29 } })!;
    expect(n.tfs).toEqual(["M1", "M5"]);
    expect(n.from).toBe(bars[10].t);
    expect(vrvp.lower!({}, { bars, cut: 0, step: M15, calendar: { offset: 0 } })).toBeNull();
  });

  it("needsRange để manager tính lại khi kéo / zoom", () => {
    expect(vrvp.needsRange).toBe(true);
    expect(svp.needsRange).toBeUndefined();
  });
});
