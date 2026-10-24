import type { Bar } from "@/lib/api";
import { describe, expect, it } from "vitest";
import { byId } from "../catalog";
import { computeInstance } from "../engine";
import { newInstance } from "../instance";
import { barDirection, cumulativeDelta, cvd } from "./cvd";

const bar = (t: number, o: number, c: number, v: number): Bar => ({ t, o, h: Math.max(o, c), l: Math.min(o, c), c, v });
const M15 = 900;
const chart = (t0: number, n: number): Bar[] => Array.from({ length: n }, (_, i) => bar(t0 + i * M15, 1, 1, 0));
const DAY = 86400;

describe("barDirection", () => {
  it("đóng > mở lên, đóng < mở xuống", () => {
    expect(barDirection(bar(0, 1, 2, 1), 9, -1)).toBe(1);
    expect(barDirection(bar(0, 2, 1, 1), 0, 1)).toBe(-1);
  });
  it("đóng = mở: so với đóng nến trước; vẫn bằng thì giữ chiều trước", () => {
    expect(barDirection(bar(0, 5, 5, 1), 4, -1)).toBe(1);
    expect(barDirection(bar(0, 5, 5, 1), 6, 1)).toBe(-1);
    expect(barDirection(bar(0, 5, 5, 1), 5, -1)).toBe(-1);
    expect(barDirection(bar(0, 5, 5, 1), 5, 1)).toBe(1);
  });
});

describe("cumulativeDelta", () => {
  // 3 nến chart M15 trong cùng một kỳ; mỗi nến 3 nến M5: (+10, +5, −8) rồi (−4, −6, +20) rồi (+1, +1, +1)
  const bars = chart(0, 3);
  const fine = [
    bar(0, 1, 2, 10), bar(300, 2, 3, 5), bar(600, 3, 2, 8),
    bar(900, 2, 1, 4), bar(1200, 1, 0, 6), bar(1500, 0, 1, 20),
    bar(1800, 1, 2, 1), bar(2100, 2, 3, 1), bar(2400, 3, 4, 1),
  ];
  const keys = [7, 7, 7];

  it("open = tích luỹ trước nến, high/low = cực trị trên đường đi, close = cuối nến", () => {
    const d = cumulativeDelta(bars, keys, fine);
    expect(d.o).toEqual([0, 7, 17]);
    expect(d.c).toEqual([7, 17, 20]);
    expect(d.h).toEqual([15, 17, 20]); // nến 1: 10, 15, 7 -> cao nhất 15; nến 2: 3, −3, 17 -> cao nhất là open 7... và close 17
    expect(d.l).toEqual([0, -3, 17]); // nến 2 đi qua đáy −3 (7 − 4 = 3, 3 − 6 = −3, −3 + 20 = 17): chỉ có đường đi mới thấy
  });

  it("sang kỳ anchor mới thì về 0, nến đầu kỳ mở quanh 0", () => {
    const d = cumulativeDelta(bars, [7, 7, 8], fine);
    expect(d.o[2]).toBe(0);
    expect(d.c[2]).toBe(3);
  });

  it("dữ liệu khung nhỏ bắt đầu giữa kỳ: nến chart trước đó là na, tích luỹ chỉ bắt đầu ở đầu kỳ kế tiếp", () => {
    const d = cumulativeDelta(chart(0, 4), [1, 1, 2, 2], fine.slice(3)); // dữ liệu từ 900: giữa kỳ 1
    expect(d.c[0]).toBeNaN();
    expect(d.c[1]).toBeNaN();
    expect(d.o[2]).toBe(0); // đầu kỳ 2 (nến chart #2, t = 1800)
    expect(d.c[2]).toBe(3);
    expect(d.c[3]).toBeNaN(); // sau chỗ hết dữ liệu khung nhỏ: để trống
  });

  it("nến chart không có nến khung nhỏ nào: na, nhưng tích luỹ giữ nguyên cho nến sau", () => {
    const d = cumulativeDelta(chart(0, 3), [1, 1, 1], [bar(0, 1, 2, 5), bar(1800, 1, 2, 3)]);
    expect([d.o[1], d.h[1], d.l[1], d.c[1]].every(Number.isNaN)).toBe(true);
    expect(d.o[2]).toBe(5);
    expect(d.c[2]).toBe(8);
  });

  it("không có dữ liệu khung nhỏ: toàn na", () => {
    const d = cumulativeDelta(bars, keys, []);
    expect(d.c.every(Number.isNaN)).toBe(true);
  });
});

describe("def CVD", () => {
  // 2 ngày broker (offset 0): 96 nến M15 mỗi ngày
  const t0 = 100 * DAY;
  const bars = chart(t0, 192);
  const fineM1 = (from: number, n: number): Bar[] => Array.from({ length: n }, (_, i) => bar(from + i * 60, 1, i % 3 === 0 ? 0 : 2, 1 + (i % 5)));
  const run = (inputs: Record<string, number | string | boolean>, lower: Bar[], b = bars) =>
    computeInstance(byId("cvd"), { ...newInstance("cvd"), inputs }, b, { offset: 0 }, lower).cvd;

  it("trả O/H/L/C đúng độ dài, high ≥ max(open, close), low ≤ min(open, close)", () => {
    const d = run({}, fineM1(t0, 192 * 15));
    expect(d.values).toHaveLength(192);
    for (let i = 0; i < 192; i++) {
      const o = d.candle!.o[i], h = d.candle!.h[i], l = d.candle!.l[i], c = d.values[i];
      expect(h).toBeGreaterThanOrEqual(Math.max(o, c));
      expect(l).toBeLessThanOrEqual(Math.min(o, c));
    }
  });

  it("về 0 ở 00:00 broker: nến đầu ngày thứ hai mở ở 0", () => {
    const d = run({}, fineM1(t0, 192 * 15));
    expect(d.candle!.o[0]).toBe(0);
    expect(d.candle!.o[96]).toBe(0);
    expect(d.candle!.o[95]).not.toBe(0);
  });

  it("Session start = Custom hour: về 0 lúc 22:00 broker, không về 0 lúc 00:00", () => {
    const d = run({ sessionStart: "Custom hour", sessionHour: 22 }, fineM1(t0, 192 * 15));
    expect(d.candle!.o[88]).toBe(0); // 22:00 ngày đầu
    expect(d.candle!.o[87]).not.toBe(0);
    expect(d.candle!.o[96]).not.toBe(0); // 00:00 ngày thứ hai không còn reset
    expect(d.candle!.o[184]).toBe(0); // 22:00 ngày thứ hai
  });

  it("Session start = After break: về 0 ở nến đầu tiên sau khoảng trống", () => {
    const gap = bars.filter((b) => b.t < t0 + 21 * 3600 || b.t >= t0 + 22 * 3600); // nghỉ 21:00–22:00 ngày đầu
    const d = run({ sessionStart: "After break" }, fineM1(t0, 192 * 15), gap);
    const i = gap.findIndex((b) => b.t === t0 + 22 * 3600);
    expect(d.candle!.o[i]).toBe(0);
    expect(d.candle!.o[i - 1]).not.toBe(0);
    expect(d.candle!.o[gap.findIndex((b) => b.t === t0 + DAY)]).not.toBe(0); // 00:00 không reset
  });

  it("anchor 1W không reset giữa hai ngày cùng tuần", () => {
    // ngày 100 từ 1970-04-11 (thứ Bảy) và 101 (Chủ nhật) cùng tuần ISO với nhau? chọn ngày 102,103 (thứ Hai, thứ Ba)
    const b = chart(102 * DAY, 192);
    const d = run({ anchor: "1W" }, fineM1(102 * DAY, 192 * 15), b);
    expect(d.candle!.o[96]).not.toBe(0);
    const day = run({ anchor: "1D" }, fineM1(102 * DAY, 192 * 15), b);
    expect(day.candle!.o[96]).toBe(0);
  });

  it("chưa nạp nến khung nhỏ: dùng nến chart (không ném lỗi, có giá trị)", () => {
    const d = run({}, []);
    expect(d.values).toHaveLength(192);
    expect(d.values.some((x) => !Number.isNaN(x))).toBe(true);
  });

  it("mặc định theo script: nến teal / red, định dạng volume, đường 0", () => {
    expect(cvd.plots[0]).toMatchObject({ type: "candles", color: "#089981", colorDown: "#f23645" });
    expect(cvd.format).toBe("volume");
    expect(cvd.levels![0].value).toBe(0);
  });
});

describe("def.lower của CVD", () => {
  const t0 = 100 * DAY;
  const all = chart(t0 - 5 * 96 * M15 + 40 * M15, 5 * 96 + 400); // lịch sử + chart, bắt đầu giữa ngày
  const cut = 5 * 96;
  const info = { bars: all, cut, step: M15, calendar: { offset: 0 } };
  const need = (inputs: Record<string, number | string | boolean> = {}) => cvd.lower!({ anchor: "1D", custom: false, tf: "1", ...inputs }, info);

  it("chart M15: M1 rồi lùi M5; phủ từ đầu ngày của nến chart đầu tiên", () => {
    const n = need()!;
    expect(n.tfs).toEqual(["M1", "M5"]);
    expect(n.from).toBe(Math.floor(all[cut].t / DAY) * DAY);
    expect(n.from).toBeLessThanOrEqual(all[cut].t);
  });
  it("khung riêng chỉ dùng đúng khung đó", () => {
    expect(need({ custom: true, tf: "5" })!.tfs).toEqual(["M5"]);
  });
  it("khung riêng không nhỏ hơn khung chart: null (dùng nến chart)", () => {
    expect(need({ custom: true, tf: "15" })).toBeNull();
  });
  it("Custom hour: nạp từ đầu phiên (22:00 hôm trước) chứa nến chart đầu tiên", () => {
    const n = need({ sessionStart: "Custom hour", sessionHour: 22 })!;
    expect(n.from).toBe(Math.floor(all[cut].t / DAY) * DAY - 2 * 3600);
  });
  it("anchor tuần cần nạp từ đầu tuần", () => {
    const w = need({ anchor: "1W" })!;
    const d = need()!;
    expect(w.from).toBeLessThanOrEqual(d.from);
  });
  it("ngân sách: kỳ quá dài thì bỏ M1", () => {
    const H1 = 3600;
    const hourly = Array.from({ length: 3 * 365 * 24 }, (_, i) => bar(i * H1, 1, 1, 0));
    const wide = { bars: hourly, cut: hourly.length - 100, step: H1, calendar: { offset: 0 } };
    const n = cvd.lower!({ anchor: "12M", custom: false, tf: "1" }, wide)!;
    expect(n.tfs).toEqual(["M15", "M30"]); // kỳ 12M ≈ 1 năm tính từ đầu năm của nến đầu chart: M1 (525k) và M5 (105k) vượt 100k nến
    // chart M15 + anchor năm: M1 và M5 đều vượt ngân sách -> dùng nến chart
    expect(cvd.lower!({ anchor: "12M", custom: false, tf: "1" }, { ...info, bars: chart(0, 3 * 365 * 96), cut: 3 * 365 * 96 - 100 })).toBeNull();
  });
});

describe("CVD 1 tick", () => {
  // nến delta từng phút của backend: o = 0, c = delta phút, h / l = đỉnh / đáy delta tích luỹ trong phút
  const td = (t: number, c: number, h: number, l: number, v = 1): Bar => ({ t, o: 0, h, l, c, v });
  const bars = chart(0, 3);

  it("nối các phút: open = tích luỹ trước, high / low = đầu + h / l của từng phút, close = cuối", () => {
    // nến 0 (0..900): phút 0: +3 (đỉnh 5, đáy −1); phút 5: −2 (đỉnh 1, đáy −4); nến 1: phút 15: +10; nến 2: phút 30: −4
    const fine = [td(0, 3, 5, -1), td(300, -2, 1, -4), td(900, 10, 12, 0), td(1800, -4, 0, -6)];
    const d = cumulativeDelta(bars, [1, 1, 1], fine, true);
    expect(d.o).toEqual([0, 1, 11]);
    expect(d.c).toEqual([1, 11, 7]);
    expect(d.h).toEqual([5, 13, 11]); // nến 0: max(0, 0+5, 3+1) = 5; nến 1: 1+12 = 13; nến 2: max(11, 11+0) = 11
    expect(d.l).toEqual([-1, 1, 5]); // nến 0: min(0, −1, 3−4) = −1; nến 1: min(1, 1+0) = 1; nến 2: 11−6 = 5
  });

  it("nến chart không có phút nào: na, tích luỹ giữ nguyên", () => {
    const d = cumulativeDelta(bars, [1, 1, 1], [td(0, 4, 4, 0), td(1800, 1, 1, 0)], true);
    expect(Number.isNaN(d.c[1])).toBe(true);
    expect(d.o[2]).toBe(4);
    expect(d.c[2]).toBe(5);
  });

  it("def: input Data aggregation, chọn 1 tick thì tắt Use custom timeframe và Timeframe", () => {
    const keys = cvd.inputs.map((i) => i.key);
    expect(keys.slice(0, 2)).toEqual(["anchor", "agg"]);
    const agg = cvd.inputs.find((i) => i.key === "agg")!;
    expect(agg).toMatchObject({ type: "select", default: "Time", options: ["Time", "1 tick"] });
    const custom = cvd.inputs.find((i) => i.key === "custom")!;
    const tf = cvd.inputs.find((i) => i.key === "tf")!;
    expect(custom.enabledIf!({ agg: "Time" })).toBe(true);
    expect(custom.enabledIf!({ agg: "1 tick" })).toBe(false);
    expect(tf.enabledIf!({ agg: "Time", custom: true })).toBe(true);
    expect(tf.enabledIf!({ agg: "1 tick", custom: true })).toBe(false);
  });

  it("def.lower: khung TD từ đầu kỳ; chart dài hơn 14 ngày thì chỉ lấy từ kỳ đầu tiên trong ngân sách; kỳ hiện tại dài hơn thì null", () => {
    const all = chart(100 * DAY, 3 * 96);
    const info = { bars: all, cut: 0, step: M15, calendar: { offset: 0 } };
    expect(cvd.lower!({ anchor: "1D", agg: "1 tick" }, info)).toEqual({ tfs: ["TD"], from: 100 * DAY });
    // chart 60 ngày (H1 nạp vài tháng là chuyện thường): kỳ ngày đầu tiên không cũ hơn 14 ngày so với nến cuối
    const wide = chart(100 * DAY, 60 * 96);
    const end = 160 * DAY;
    const day = cvd.lower!({ anchor: "1D", agg: "1 tick" }, { ...info, bars: wide })!;
    expect(day.tfs).toEqual(["TD"]);
    expect(day.from).toBeGreaterThanOrEqual(end - 14 * DAY);
    expect(day.from).toBeLessThan(end - 13 * DAY);
    expect(day.from % DAY).toBe(0);
    const week = cvd.lower!({ anchor: "1W", agg: "1 tick" }, { ...info, bars: wide })!; // tuần đầu tiên bắt đầu trong 14 ngày cuối
    expect(week.from).toBeGreaterThanOrEqual(end - 14 * DAY);
    expect(week.from).toBeLessThan(end - 7 * DAY);
    expect(cvd.lower!({ anchor: "12M", agg: "1 tick" }, { ...info, bars: wide })).toBeNull(); // kỳ năm hiện tại bắt đầu quá xa
  });

  it("compute 1 tick: chỉ dùng nến delta tick; chưa có thì để trống chứ không đoán từ nến chart", () => {
    const b = chart(100 * DAY, 96);
    const inst = { ...newInstance("cvd"), inputs: { agg: "1 tick" } };
    const empty = computeInstance(byId("cvd"), inst, b, { offset: 0 }, []).cvd;
    expect(empty.values.every(Number.isNaN)).toBe(true);
    const pieces = Array.from({ length: 96 * 15 }, (_, i) => td(100 * DAY + i * 60, i % 2 ? -1 : 1, i % 2 ? 0 : 1, i % 2 ? -1 : 0));
    const full = computeInstance(byId("cvd"), inst, b, { offset: 0 }, pieces).cvd;
    expect(full.candle!.o[0]).toBe(0);
    expect(full.values[0]).toBe(1); // 15 phút: +1 −1 ... 8 lần +1, 7 lần −1
  });
});
