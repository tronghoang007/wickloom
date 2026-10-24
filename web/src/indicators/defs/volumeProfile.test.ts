import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { byId } from "../catalog";
import { computeExtras } from "../engine";
import { newInstance } from "../instance";
import type { TickSource } from "../schema";
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

describe("Data aggregation = 1 tick", () => {
  // một ngày M15 (96 nến, giá 94..106): hai ngày liền nhau để thử phiên có / chưa có tick
  const bars = [...chart(20, 96), ...chart(21, 96)];
  const lower = m1(20 * DAY, 22 * DAY);
  const run = (id: "svp" | "vrvp", inputs: Record<string, number | string | boolean>, ticks?: TickSource, range?: { from: number; to: number }) =>
    computeExtras(byId(id), { ...newInstance(id), inputs }, bars, { offset: 0 }, lower, { tick: 0.01, cut: 0, ...(ticks ? { ticks } : {}), ...(range ? { range } : {}) }).profiles!;
  // tick giả: mỗi row nhận up = 3, dn = 1; ghi lại các yêu cầu
  const fake = (covered: (t0: number) => boolean, ready = true) => {
    const asked: { t0: number; t1: number; N: number }[] = [];
    const src: TickSource = {
      covered,
      hist: (t0, t1, lay) => {
        asked.push({ t0, t1, N: lay.N });
        return ready ? { up: new Array(lay.N).fill(3), dn: new Array(lay.N).fill(1) } : null;
      },
    };
    return { src, asked };
  };

  it("input agg: Time hoặc 1 tick, mặc định Time, ở cả hai indicator", () => {
    for (const id of ["svp", "vrvp"] as const) {
      expect(byId(id).inputs.find((i) => i.key === "agg")).toMatchObject({ type: "select", default: "Time", options: ["Time", "1 tick"] });
    }
  });

  it("1 tick: volume mỗi row lấy từ histogram tick, row theo vùng giá của nến chart, tổng = số row x 4", () => {
    const { src, asked } = fake(() => true);
    const p = run("svp", { agg: "1 tick", rows: 24 }, src);
    expect(p.profiles).toHaveLength(2);
    expect(asked.map((a) => [a.t0, a.t1])).toEqual([[20 * DAY, 21 * DAY], [21 * DAY, 22 * DAY]]); // cả phiên, gồm nến cuối
    for (const vp of p.profiles) {
      expect(vp.N).toBe(asked[0].N);
      expect(vp.total.every((v) => v === 4)).toBe(true);
      expect(vp.up.every((v) => v === 3) && vp.dn.every((v) => v === 1)).toBe(true);
    }
  });

  it("Time (mặc định) không đụng tới tick dù manager cấp", () => {
    const { src, asked } = fake(() => true);
    run("svp", { agg: "Time" }, src);
    expect(asked).toHaveLength(0);
  });

  it("phiên chưa có tick (chưa nạp tới đầu) hoặc histogram chưa về: dùng nến như Time", () => {
    const time = run("svp", { agg: "Time" });
    const part = fake((t0) => t0 >= 21 * DAY); // chỉ phiên 2 có tick
    const p = run("svp", { agg: "1 tick" }, part.src);
    expect(part.asked.map((a) => a.t0)).toEqual([21 * DAY]); // phiên 1 không xin histogram
    expect(p.profiles[0].total).toEqual(time.profiles[0].total); // phiên 1 giống hệt Time
    expect(p.profiles[1].total.every((v) => v === 4)).toBe(true);
    const pending = run("svp", { agg: "1 tick" }, fake(() => true, false).src);
    expect(pending.profiles.map((x) => x.total)).toEqual(time.profiles.map((x) => x.total));
    expect(run("svp", { agg: "1 tick" }).profiles.map((x) => x.total)).toEqual(time.profiles.map((x) => x.total)); // manager không cấp tick
  });

  it("vrvp: một profile cho vùng nhìn, histogram của đúng [nến đầu, nến cuối + 1)", () => {
    const { src, asked } = fake(() => true);
    const p = run("vrvp", { agg: "1 tick" }, src, { from: 10, to: 50 });
    expect(asked).toEqual([{ t0: bars[10].t, t1: bars[50].t + M15, N: p.profiles[0].N }]);
    expect(p.profiles[0].total.every((v) => v === 4)).toBe(true);
  });

  it("ticks (svp): không 1 tick thì null; 1 tick thì phủ từ đầu phiên đầu tiên trong độ sâu 14 ngày", () => {
    const need = (inputs: Record<string, number | string | boolean>, b = bars) => svp.ticks!(inputs, { bars: b, cut: 0, step: M15, calendar: { offset: 0 } });
    expect(need({ agg: "Time" })).toBeNull();
    expect(need({ agg: "1 tick", session: "Day" })).toEqual({ from: 20 * DAY });
    const wide = Array.from({ length: 30 }, (_, d) => chart(100 + d, 96)).flat(); // 30 ngày: chỉ 14 ngày cuối
    expect(need({ agg: "1 tick", session: "Day" }, wide)).toEqual({ from: 116 * DAY });
    expect(svp.ticks!({ agg: "1 tick", session: "Day" }, { bars: chart(0, 96), cut: 0, step: 86400, calendar: { offset: 0 } })).toBeNull(); // D1 trở lên: không phiên
  });

  it("ticks (vrvp): cần vùng nhìn và nằm trong 14 ngày từ nến cuối", () => {
    const need = (inputs: Record<string, number | string | boolean>, range?: { from: number; to: number }, b = bars) => vrvp.ticks!(inputs, { bars: b, cut: 0, step: M15, calendar: { offset: 0 }, ...(range ? { range } : {}) });
    expect(need({ agg: "Time" }, { from: 0, to: 10 })).toBeNull();
    expect(need({ agg: "1 tick" })).toBeNull();
    expect(need({ agg: "1 tick" }, { from: 10, to: 10 })).toBeNull();
    expect(need({ agg: "1 tick" }, { from: 10, to: 50 })).toEqual({ from: bars[10].t });
    const wide = Array.from({ length: 30 }, (_, d) => chart(100 + d, 96)).flat();
    expect(need({ agg: "1 tick" }, { from: 0, to: 100 }, wide)).toBeNull(); // vùng bắt đầu từ 30 ngày trước
    expect(need({ agg: "1 tick" }, { from: 20 * 96, to: 29 * 96 }, wide)).toEqual({ from: wide[20 * 96].t });
  });
});
