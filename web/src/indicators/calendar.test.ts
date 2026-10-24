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

  it("break: tuần theo ngày giao dịch của phiên", () => {
    const wk = [utc("2026-10-16T20:00:00"), utc("2026-10-18T22:00:00"), utc("2026-10-19T10:00:00"), utc("2026-10-19T22:00:00")];
    const w = periodKeys(wk, "week", { offset: 0, session: { mode: "break", minutes: 30 } });
    expect(w[1]).toBe(w[0] + 1);
    expect(w[2]).toBe(w[1]);
    expect(w[3]).toBe(w[1]);
  });
});
