import { describe, expect, it } from "vitest";
import { periodKeys, periodStarts } from "./calendar";

const utc = (iso: string) => Date.parse(iso + "Z") / 1000;
const H = 3600;

describe("periodKeys theo giờ broker", () => {
  it("ngày đổi lúc 00:00 giờ broker, không phải 00:00 UTC", () => {
    const off = 2 * H; // broker = UTC+2
    const t = [utc("2026-03-10T21:00:00"), utc("2026-03-10T21:59:00"), utc("2026-03-10T22:00:00"), utc("2026-03-10T23:00:00")];
    const k = periodKeys(t, "day", { offset: off });
    expect(k[0]).toBe(k[1]);
    expect(k[2]).toBe(k[1] + 1); // 22:00 UTC = 00:00 broker
    expect(k[3]).toBe(k[2]);
  });

  it("offset âm", () => {
    const k = periodKeys([utc("2026-03-10T04:59:00"), utc("2026-03-10T05:00:00")], "day", { offset: -5 * H });
    expect(k[1]).toBe(k[0] + 1);
  });

  it("tuần bắt đầu thứ Hai: Chủ nhật thuộc tuần trước", () => {
    const t = [utc("2026-03-08T12:00:00"), utc("2026-03-09T00:00:00"), utc("2026-03-15T23:00:00"), utc("2026-03-16T00:00:00")]; // CN, T2, CN, T2
    const k = periodKeys(t, "week", { offset: 0 });
    expect(k[1]).toBe(k[0] + 1);
    expect(k[2]).toBe(k[1]);
    expect(k[3]).toBe(k[2] + 1);
  });

  it("tháng và năm, kể cả qua năm", () => {
    const t = [utc("2025-12-31T23:00:00"), utc("2026-01-01T00:00:00"), utc("2026-01-31T23:00:00"), utc("2026-02-01T00:00:00")];
    const m = periodKeys(t, "month", { offset: 0 });
    expect(m[1]).toBe(m[0] + 1);
    expect(m[2]).toBe(m[1]);
    expect(m[3]).toBe(m[2] + 1);
    const y = periodKeys(t, "year", { offset: 0 });
    expect(y[1]).toBe(y[0] + 1);
    expect(y[3]).toBe(y[1]);
  });

  it("năm nhuận: 29/02 và 01/03 khác tháng, cùng năm", () => {
    const t = [utc("2028-02-29T10:00:00"), utc("2028-03-01T10:00:00")];
    const m = periodKeys(t, "month", { offset: 0 });
    expect(m[1]).toBe(m[0] + 1);
    expect(periodKeys(t, "year", { offset: 0 })).toEqual([2028, 2028]);
  });
});

describe("kỳ nhiều năm của Pivot Points (TV: Biyearly / Triyearly / Quinquennially)", () => {
  it("năm chia theo bội số của 2 / 3 / 5", () => {
    const t = ["2024", "2025", "2026", "2027"].map((y) => utc(`${y}-06-01T00:00:00`));
    const two = periodKeys(t, "year2", { offset: 0 });
    expect([two[0] === two[1], two[2] === two[3], two[2] === two[1] + 1]).toEqual([true, true, true]); // {2024,2025} {2026,2027}
    const three = periodKeys(t, "year3", { offset: 0 });
    expect([three[0] + 1 === three[1], three[1] === three[2], three[2] === three[3]]).toEqual([true, true, true]); // {2024} {2025,2026,2027}
    const five = periodKeys(t, "year5", { offset: 0 });
    expect([five[0] + 1 === five[1], five[1] === five[3]]).toEqual([true, true]);
  });
});

describe("dayOpens (mốc D1 thật) sửa lệch DST", () => {
  // Offset hiện tại = UTC+3 (mùa hè). Ngày mùa đông của broker mở 00:00 UTC+2 = 22:00 UTC.
  const opts = (dayOpens?: number[]) => ({ offset: 3 * H, dayOpens });
  const winterOpen = utc("2026-01-14T22:00:00"); // D1 thật của 15/01
  const bars = [utc("2026-01-14T21:00:00"), utc("2026-01-14T22:00:00"), utc("2026-01-14T22:30:00")];

  it("chỉ dùng offset hiện tại: nến 21:00–22:00 UTC bị gộp nhầm sang ngày sau", () => {
    const k = periodKeys(bars, "day", opts());
    expect(k[0]).toBe(k[1]); // sai: 21:00 UTC đã bị tính là 00:00 broker
  });

  it("có dayOpens: ranh giới đúng 22:00 UTC", () => {
    const opens = [utc("2026-01-13T22:00:00"), winterOpen, utc("2026-01-15T22:00:00")];
    const k = periodKeys(bars, "day", opts(opens));
    expect(k[1]).toBe(k[0] + 1);
    expect(k[2]).toBe(k[1]);
  });

  it("nến trước mốc D1 đầu tiên vẫn có khoá (dùng offset)", () => {
    const k = periodKeys([utc("2026-01-01T00:00:00")], "day", opts([winterOpen]));
    expect(Number.isFinite(k[0])).toBe(true);
  });

  it("nến mới hơn mốc D1 cuối cùng một ngày trở lên (mốc chưa nạp lại): tính theo offset, vẫn sang ngày mới", () => {
    const opens = [utc("2026-10-19T00:00:00"), utc("2026-10-20T00:00:00")]; // trang mở từ 20/10, giờ đã là 22/10
    const t = [utc("2026-10-20T23:00:00"), utc("2026-10-21T01:00:00"), utc("2026-10-22T01:00:00")];
    const k = periodKeys(t, "day", { offset: 0, dayOpens: opens });
    expect(k).toEqual(periodKeys(t, "day", { offset: 0 }));
    expect([k[1] - k[0], k[2] - k[1]]).toEqual([1, 1]);
    const custom = periodKeys(t, "day", { offset: 0, dayOpens: opens, session: { mode: "hour", hour: 7 } });
    expect([custom[1], custom[2]]).toEqual([custom[0], custom[1] + 1]); // 21/10 01:00 còn phiên 20/10, 22/10 01:00 là phiên 21/10
  });

  it("tuần/tháng theo ngày của mốc D1", () => {
    const opens = [utc("2026-02-28T22:00:00"), utc("2026-03-01T22:00:00")]; // ngày broker 01/03 và 02/03 (UTC+2)
    const t = [utc("2026-02-28T22:00:00"), utc("2026-03-01T21:00:00"), utc("2026-03-01T22:00:00")];
    const k = periodKeys(t, "month", { offset: 2 * H, dayOpens: opens });
    expect(k[0]).toBe(k[1]); // 28/02 22:00 UTC = 01/03 00:00 broker; 01/03 21:00 UTC vẫn là 01/03
    expect(k[2]).toBe(k[1]); // cùng tháng 3
  });
});

describe("periodStarts", () => {
  it("nến đầu luôn là mở đầu; mỗi lần đổi khoá thêm một mốc", () => {
    const t = [utc("2026-03-10T10:00:00"), utc("2026-03-10T11:00:00"), utc("2026-03-11T10:00:00"), utc("2026-03-11T11:00:00"), utc("2026-03-12T10:00:00")];
    expect(periodStarts(t, "day", { offset: 0 })).toEqual([0, 2, 4]);
    expect(periodStarts([], "day", { offset: 0 })).toEqual([]);
  });
});

describe("session start (mốc đổi phiên)", () => {
  // Vàng trên broker UTC+0: nghỉ 21:00–22:00, phiên mở 22:00
  const hours = (day: string, from: number, to: number) => Array.from({ length: to - from }, (_, i) => utc(`${day}T${String(from + i).padStart(2, "0")}:00:00`));
  const gold = [...hours("2026-10-19", 18, 21), ...hours("2026-10-19", 22, 24), ...hours("2026-10-20", 0, 21), ...hours("2026-10-20", 22, 24), ...hours("2026-10-21", 0, 3)];
  const at = (iso: string) => gold.indexOf(utc(iso));

  it("mặc định cắt 00:00 broker, giữa phiên vàng", () => {
    const k = periodKeys(gold, "day", { offset: 0 });
    expect(k[at("2026-10-20T00:00:00")]).toBe(k[at("2026-10-19T23:00:00")] + 1);
    expect(k[at("2026-10-20T22:00:00")]).toBe(k[at("2026-10-20T20:00:00")]);
  });

  it("hour = 22: phiên 22:00 hôm trước đến 21:00, không cắt lúc 00:00", () => {
    const k = periodKeys(gold, "day", { offset: 0, session: { mode: "hour", hour: 22 } });
    expect(k[at("2026-10-20T00:00:00")]).toBe(k[at("2026-10-19T23:00:00")]);
    expect(k[at("2026-10-20T20:00:00")]).toBe(k[at("2026-10-19T22:00:00")]);
    expect(k[at("2026-10-20T22:00:00")]).toBe(k[at("2026-10-20T20:00:00")] + 1);
    expect(k[at("2026-10-19T20:00:00")]).toBe(k[at("2026-10-19T18:00:00")]); // trước giờ nghỉ cùng phiên
  });

  it("hour = 7: nến trước 07:00 thuộc phiên hôm trước; hour 0 như mặc định", () => {
    const t = [utc("2026-03-10T06:00:00"), utc("2026-03-10T07:00:00"), utc("2026-03-11T06:59:00"), utc("2026-03-11T07:00:00")];
    const k = periodKeys(t, "day", { offset: 0, session: { mode: "hour", hour: 7 } });
    expect(k[1]).toBe(k[0] + 1);
    expect(k[2]).toBe(k[1]);
    expect(k[3]).toBe(k[2] + 1);
    expect(periodKeys(t, "day", { offset: 0, session: { mode: "hour", hour: 0 } })).toEqual(periodKeys(t, "day", { offset: 0 }));
  });

  it("hour tối: phiên Chủ nhật 22:00 thuộc tuần của thứ Hai", () => {
    const t = [utc("2026-10-16T20:00:00"), utc("2026-10-18T22:00:00"), utc("2026-10-19T10:00:00")]; // T6, CN tối, T2
    const s = { mode: "hour", hour: 22 } as const;
    const w = periodKeys(t, "week", { offset: 0, session: s });
    expect(w[1]).toBe(w[0] + 1);
    expect(w[2]).toBe(w[1]);
    const old = periodKeys(t, "week", { offset: 0 });
    expect(old[1]).toBe(old[0]); // mặc định: CN tối còn là tuần trước
  });

  it("hour dùng mốc D1 thật: giờ mở phiên tính từ 00:00 broker của ngày đó (đúng qua DST)", () => {
    // offset hiện tại UTC+3, nhưng ngày mùa đông broker mở 22:00 UTC (UTC+2): phiên 07:00 broker = 05:00 UTC
    const opens = [utc("2026-01-13T22:00:00"), utc("2026-01-14T22:00:00")];
    const t = [utc("2026-01-14T04:59:00"), utc("2026-01-14T05:00:00")];
    const k = periodKeys(t, "day", { offset: 3 * H, dayOpens: opens, session: { mode: "hour", hour: 7 } });
    expect(k[1]).toBe(k[0] + 1);
  });

  it("break: phiên mới ở nến đầu tiên sau giờ nghỉ, kể cả cuối tuần", () => {
    const k = periodKeys(gold, "day", { offset: 0, session: { mode: "break", minutes: 30 } });
    expect(k[at("2026-10-20T00:00:00")]).toBe(k[at("2026-10-19T23:00:00")]); // nửa đêm không cắt
    expect(k[at("2026-10-20T20:00:00")]).toBe(k[at("2026-10-19T22:00:00")]);
    expect(k[at("2026-10-20T22:00:00")]).toBe(k[at("2026-10-20T20:00:00")] + 1);
    expect(k[at("2026-10-19T20:00:00")]).toBe(k[at("2026-10-19T18:00:00")]);
    expect(periodStarts(gold, "day", { offset: 0, session: { mode: "break", minutes: 30 } })).toEqual([0, at("2026-10-19T22:00:00"), at("2026-10-20T22:00:00")]);
  });

  it("break: khoảng trống ngắn hơn ngưỡng không cắt; bước nến không tính là khoảng trống", () => {
    const k = periodKeys(gold, "day", { offset: 0, session: { mode: "break", minutes: 90 } });
    expect(k[at("2026-10-20T22:00:00")]).toBe(k[at("2026-10-20T20:00:00")]); // nghỉ 1 tiếng < 90 phút: chỉ còn cắt lúc 00:00
    expect(k[at("2026-10-20T00:00:00")]).toBe(k[at("2026-10-19T23:00:00")] + 1);
  });

  it("break: không có giờ nghỉ nào (BTC, H4) thì rơi về 00:00 broker", () => {
    const t = Array.from({ length: 72 }, (_, i) => utc("2026-10-19T00:00:00") + i * H);
    expect(periodStarts(t, "day", { offset: 0, session: { mode: "break", minutes: 30 } })).toEqual([0, 24, 48]);
    expect(periodStarts(t, "day", { offset: 0 })).toEqual([0, 24, 48]);
  });

  it("break: mảng bắt đầu ngay sau giờ nghỉ (phiên đầu bị cắt) vẫn không cắt lúc 00:00", () => {
    const part = gold.slice(at("2026-10-19T22:00:00"));
    const k = periodKeys(part, "day", { offset: 0, session: { mode: "break", minutes: 30 } });
    expect(k[part.indexOf(utc("2026-10-20T00:00:00"))]).toBe(k[0]);
    expect(k[part.indexOf(utc("2026-10-20T22:00:00"))]).toBe(k[0] + 1);
  });

  it("break: lỗ dữ liệu (các ngày khác cùng giờ có nến) không phải giờ nghỉ: không cắt, vẫn cắt lúc 00:00", () => {
    const btc = Array.from({ length: 96 }, (_, i) => utc("2026-10-19T00:00:00") + i * H).filter((t) => t !== utc("2026-10-20T15:00:00"));
    const starts = periodStarts(btc, "day", { offset: 0, session: { mode: "break", minutes: 30 } });
    expect(starts.map((i) => btc[i])).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22"].map((d) => utc(`${d}T00:00:00`)));
  });

  it("break: tuần theo ngày giao dịch của phiên", () => {
    const wk = [utc("2026-10-16T20:00:00"), utc("2026-10-18T22:00:00"), utc("2026-10-19T10:00:00"), utc("2026-10-19T22:00:00")];
    const w = periodKeys(wk, "week", { offset: 0, session: { mode: "break", minutes: 30 } });
    expect(w[1]).toBe(w[0] + 1);
    expect(w[2]).toBe(w[1]);
    expect(w[3]).toBe(w[1]);
  });
});

describe("break: giờ nghỉ thật vs lỗ dữ liệu trên M1 nhiều ngày", () => {
  const M = 60;
  // M1 kiểu vàng: nghỉ 21:00–22:00 UTC mỗi ngày, đóng từ thứ Sáu 21:00 tới Chủ nhật 22:00 UTC; `skip` = các khoảng [a, b) mất dữ liệu
  function goldM1(skip: [number, number][] = []): number[] {
    const out: number[] = [];
    for (let t = utc("2026-10-04T22:00:00"); t < utc("2026-10-17T00:00:00"); t += M) {
      const d = new Date(t * 1000);
      const dow = d.getUTCDay(), h = d.getUTCHours();
      if (dow === 6 || (dow === 0 && h < 22) || (dow === 5 && h >= 21) || h === 21) continue;
      if (skip.some(([a, b]) => t >= a && t < b)) continue;
      out.push(t);
    }
    return out;
  }
  const btcM1 = (skip: [number, number][] = []): number[] => {
    const out: number[] = [];
    for (let t = utc("2026-10-05T00:00:00"); t < utc("2026-10-17T00:00:00"); t += M) if (!skip.some(([a, b]) => t >= a && t < b)) out.push(t);
    return out;
  };
  const opts = { offset: 0, session: { mode: "break", minutes: 30 } } as const;
  const startsAt = (t: number[]) => periodStarts(t, "day", opts).slice(1).map((i) => new Date(t[i] * 1000).toISOString().slice(0, 16));

  it("vàng: cắt đúng sau giờ nghỉ 21–22 UTC và sau cuối tuần", () => {
    expect(startsAt(goldM1())).toEqual([
      "2026-10-05T22:00", "2026-10-06T22:00", "2026-10-07T22:00", "2026-10-08T22:00", "2026-10-11T22:00",
      "2026-10-12T22:00", "2026-10-13T22:00", "2026-10-14T22:00", "2026-10-15T22:00",
    ]);
  });

  it("vàng: lỗ dữ liệu 45 phút giữa phiên (thứ Tư 10:00) không cắt phiên dù cuối tuần trống", () => {
    const hole: [number, number] = [utc("2026-10-07T10:00:00"), utc("2026-10-07T10:45:00")];
    expect(startsAt(goldM1([hole]))).toEqual(startsAt(goldM1()));
  });

  it("vàng: lỗ dữ liệu dính liền giờ nghỉ vẫn cắt phiên ở nến đầu sau khoảng trống", () => {
    const hole: [number, number] = [utc("2026-10-07T20:15:00"), utc("2026-10-07T21:00:00")];
    expect(startsAt(goldM1([hole]))).toEqual(startsAt(goldM1()));
  });

  it("BTC 24/7: không giờ nghỉ thì cắt 00:00, lỗ dữ liệu giữa ngày không cắt", () => {
    const days = ["06", "07", "08", "09", "10", "11", "12", "13", "14", "15", "16"].map((d) => `2026-10-${d}T00:00`);
    expect(startsAt(btcM1())).toEqual(days);
    expect(startsAt(btcM1([[utc("2026-10-08T10:00:00"), utc("2026-10-08T11:30:00")]]))).toEqual(days);
  });
});
