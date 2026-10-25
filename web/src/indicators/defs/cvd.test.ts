import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { byId } from "../catalog";
import { computeInstance } from "../engine";
import { migrateInstance, newInstance, resolveInputs } from "../instance";
import { cumulativeDelta, cvd } from "./cvd";

// nến delta từng phút của backend (tf "TD"): o = 0, c = delta phút, h / l = đỉnh / đáy delta tích luỹ trong phút
const td = (t: number, c: number, h: number, l: number, v = 1): Bar => ({ t, o: 0, h, l, c, v });
/** Phút chỉ đi một bước: đỉnh / đáy là 0 và delta cuối phút. */
const step1 = (t: number, c: number): Bar => td(t, c, Math.max(0, c), Math.min(0, c), Math.abs(c));
const M15 = 900;
const chart = (t0: number, n: number): Bar[] => Array.from({ length: n }, (_, i) => ({ t: t0 + i * M15, o: 1, h: 1, l: 1, c: 1, v: 0 }));
const DAY = 86400;

describe("cumulativeDelta", () => {
  const bars = chart(0, 3);

  it("nối các phút: open = tích luỹ trước, high / low = đầu + h / l của từng phút, close = cuối", () => {
    // nến 0 (0..900): phút 0: +3 (đỉnh 5, đáy −1); phút 5: −2 (đỉnh 1, đáy −4); nến 1: phút 15: +10; nến 2: phút 30: −4
    const fine = [td(0, 3, 5, -1), td(300, -2, 1, -4), td(900, 10, 12, 0), td(1800, -4, 0, -6)];
    const d = cumulativeDelta(bars, [1, 1, 1], fine);
    expect(d.o).toEqual([0, 1, 11]);
    expect(d.c).toEqual([1, 11, 7]);
    expect(d.h).toEqual([5, 13, 11]); // nến 0: max(0, 0+5, 3+1) = 5; nến 1: 1+12 = 13; nến 2: max(11, 11+0) = 11
    expect(d.l).toEqual([-1, 1, 5]); // nến 0: min(0, −1, 3−4) = −1; nến 1: min(1, 1+0) = 1; nến 2: 11−6 = 5
  });

  it("sang kỳ anchor mới thì về 0, nến đầu kỳ mở quanh 0", () => {
    const d = cumulativeDelta(bars, [7, 7, 8], [step1(0, 4), step1(900, 6), step1(1800, 2)]);
    expect(d.o).toEqual([0, 4, 0]);
    expect(d.c).toEqual([4, 10, 2]);
  });

  it("dữ liệu tick bắt đầu giữa kỳ: nến chart trước đó là na, tích luỹ chỉ bắt đầu ở đầu kỳ kế tiếp", () => {
    // 4 nến chart, kỳ 1 = nến 0-1, kỳ 2 = nến 2-3; tick từ 900 (giữa kỳ 1) tới 1800 (đầu kỳ 2), rồi hết
    const d = cumulativeDelta(chart(0, 4), [1, 1, 2, 2], [step1(900, 5), step1(1800, 3)]);
    expect(d.c[0]).toBeNaN();
    expect(d.c[1]).toBeNaN();
    expect(d.o[2]).toBe(0); // đầu kỳ 2 (nến chart #2, t = 1800)
    expect(d.c[2]).toBe(3);
    expect(d.c[3]).toBeNaN(); // sau chỗ hết dữ liệu tick: để trống
  });

  it("nến chart không có phút nào: na, nhưng tích luỹ giữ nguyên cho nến sau", () => {
    const d = cumulativeDelta(chart(0, 3), [1, 1, 1], [td(0, 4, 4, 0), td(1800, 1, 1, 0)]);
    expect([d.o[1], d.h[1], d.l[1], d.c[1]].every(Number.isNaN)).toBe(true);
    expect(d.o[2]).toBe(4);
    expect(d.c[2]).toBe(5);
  });

  it("không có dữ liệu tick: toàn na", () => {
    const d = cumulativeDelta(bars, [1, 1, 1], []);
    expect(d.c.every(Number.isNaN)).toBe(true);
  });
});

describe("def CVD", () => {
  // 2 ngày broker (offset 0): 96 nến M15 mỗi ngày
  const t0 = 100 * DAY;
  const bars = chart(t0, 192);
  // delta phút luôn dương theo chu kỳ 3 phút (−2, +3, +3) nên tích luỹ trong kỳ không quay lại 0
  const minutes = (from: number, n: number): Bar[] => Array.from({ length: n }, (_, i) => step1(from + i * 60, i % 3 === 0 ? -2 : 3));
  const run = (inputs: Record<string, number | string | boolean>, lower: Bar[], b = bars) =>
    computeInstance(byId("cvd"), { ...newInstance("cvd"), inputs }, b, { offset: 0 }, lower).cvd;

  it("trả O/H/L/C đúng độ dài, high ≥ max(open, close), low ≤ min(open, close)", () => {
    const d = run({}, minutes(t0, 192 * 15));
    expect(d.values).toHaveLength(192);
    for (let i = 0; i < 192; i++) {
      const o = d.candle!.o[i], h = d.candle!.h[i], l = d.candle!.l[i], c = d.values[i];
      expect(h).toBeGreaterThanOrEqual(Math.max(o, c));
      expect(l).toBeLessThanOrEqual(Math.min(o, c));
    }
  });

  it("về 0 ở 00:00 broker: nến đầu ngày thứ hai mở ở 0", () => {
    const d = run({ sessionStart: "Broker midnight" }, minutes(t0, 192 * 15));
    expect(d.candle!.o[0]).toBe(0);
    expect(d.candle!.o[96]).toBe(0);
    expect(d.candle!.o[95]).not.toBe(0);
  });

  it("Session start = Custom hour: về 0 lúc 22:00 broker, không về 0 lúc 00:00", () => {
    const d = run({ sessionStart: "Custom hour", sessionHour: 22 }, minutes(t0, 192 * 15));
    expect(d.candle!.o[88]).toBe(0); // 22:00 ngày đầu
    expect(d.candle!.o[87]).not.toBe(0);
    expect(d.candle!.o[96]).not.toBe(0); // 00:00 ngày thứ hai không còn reset
    expect(d.candle!.o[184]).toBe(0); // 22:00 ngày thứ hai
  });

  it("Session start = After break (mặc định): về 0 ở nến đầu tiên sau khoảng trống", () => {
    const gap = bars.filter((b) => b.t < t0 + 21 * 3600 || b.t >= t0 + 22 * 3600); // nghỉ 21:00–22:00 ngày đầu
    const d = run({}, minutes(t0, 192 * 15), gap);
    const i = gap.findIndex((b) => b.t === t0 + 22 * 3600);
    expect(d.candle!.o[i]).toBe(0);
    expect(d.candle!.o[i - 1]).not.toBe(0);
    expect(d.candle!.o[gap.findIndex((b) => b.t === t0 + DAY)]).not.toBe(0); // 00:00 không reset
  });

  it("anchor 1W không reset giữa hai ngày cùng tuần", () => {
    // ngày 102, 103 = thứ Hai, thứ Ba (1970-01-05 là thứ Hai)
    const b = chart(102 * DAY, 192);
    const week = run({ anchor: "1W", sessionStart: "Broker midnight" }, minutes(102 * DAY, 192 * 15), b);
    expect(week.candle!.o[96]).not.toBe(0);
    const day = run({ anchor: "1D", sessionStart: "Broker midnight" }, minutes(102 * DAY, 192 * 15), b);
    expect(day.candle!.o[96]).toBe(0);
  });

  it("chưa nạp nến delta tick: để trống, không đoán từ nến chart", () => {
    const d = run({}, []);
    expect(d.values).toHaveLength(192);
    expect(d.values.every(Number.isNaN)).toBe(true);
  });

  it("mặc định theo script: nến teal / red, định dạng volume, đường 0", () => {
    expect(cvd.plots[0]).toMatchObject({ type: "candles", color: "#089981", colorDown: "#f23645" });
    expect(cvd.format).toBe("volume");
    expect(cvd.levels![0].value).toBe(0);
  });

  it("không còn chế độ Time: chỉ Anchor và ba ô Session start", () => {
    expect(cvd.inputs.map((i) => i.key)).toEqual(["anchor", "sessionStart", "sessionHour", "sessionBreak"]);
  });

  it("instance cũ đã lưu Data aggregation / Use custom timeframe / Timeframe: bỏ các ô đó, giữ Anchor, vẫn tính bằng tick", () => {
    const inst = migrateInstance({ v: 2, uid: "u1", id: "cvd", inputs: { anchor: "1W", agg: "Time", custom: true, tf: "5" } })!;
    expect(inst.inputs).toEqual({ anchor: "1W" });
    const d = computeInstance(byId("cvd"), inst, bars, { offset: 0 }, minutes(t0, 192 * 15)).cvd;
    expect(d.candle!.o[0]).toBe(0);
    expect(d.values.some((x) => !Number.isNaN(x))).toBe(true);
  });
});

describe("def.lower của CVD", () => {
  const t0 = 100 * DAY;
  const all = chart(t0 - 5 * 96 * M15 + 40 * M15, 5 * 96 + 400); // lịch sử + chart, bắt đầu giữa ngày
  const cut = 5 * 96;
  const info = { bars: all, cut, step: M15, calendar: { offset: 0 } };
  const need = (inputs: Record<string, number | string | boolean> = {}) => cvd.lower!(resolveInputs(cvd, { sessionStart: "Broker midnight", ...inputs }), info);

  it("luôn xin khung TD (không có nến khung nhỏ), phủ từ đầu ngày của nến chart đầu tiên", () => {
    const n = need()!;
    expect(n.tfs).toEqual(["TD"]);
    expect(n.from).toBe(Math.floor(all[cut].t / DAY) * DAY);
    expect(n.from).toBeLessThanOrEqual(all[cut].t);
  });
  it("Custom hour: nạp từ đầu phiên (22:00 hôm trước) chứa nến chart đầu tiên", () => {
    const n = need({ sessionStart: "Custom hour", sessionHour: 22 })!;
    expect(n.from).toBe(Math.floor(all[cut].t / DAY) * DAY - 2 * 3600);
  });
  it("anchor tuần cần nạp từ đầu tuần", () => {
    expect(need({ anchor: "1W" })!.from).toBeLessThanOrEqual(need()!.from);
  });

  it("chart dài hơn 14 ngày thì chỉ lấy từ kỳ đầu tiên trong ngân sách; kỳ hiện tại dài hơn thì null", () => {
    const first = chart(100 * DAY, 3 * 96);
    const small = { bars: first, cut: 0, step: M15, calendar: { offset: 0 } };
    expect(cvd.lower!(resolveInputs(cvd, { anchor: "1D" }), small)).toEqual({ tfs: ["TD"], from: 100 * DAY });
    // chart 60 ngày (H1 nạp vài tháng là chuyện thường): kỳ ngày đầu tiên không cũ hơn 14 ngày so với nến cuối
    const wide = chart(100 * DAY, 60 * 96);
    const end = 160 * DAY;
    const day = cvd.lower!(resolveInputs(cvd, { anchor: "1D" }), { ...small, bars: wide })!;
    expect(day.tfs).toEqual(["TD"]);
    expect(day.from).toBeGreaterThanOrEqual(end - 14 * DAY);
    expect(day.from).toBeLessThan(end - 13 * DAY);
    expect(day.from % DAY).toBe(0);
    const week = cvd.lower!(resolveInputs(cvd, { anchor: "1W" }), { ...small, bars: wide })!; // tuần đầu tiên bắt đầu trong 14 ngày cuối
    expect(week.from).toBeGreaterThanOrEqual(end - 14 * DAY);
    expect(week.from).toBeLessThan(end - 7 * DAY);
    expect(cvd.lower!(resolveInputs(cvd, { anchor: "12M" }), { ...small, bars: wide })).toBeNull(); // kỳ năm hiện tại bắt đầu quá xa
  });
});
