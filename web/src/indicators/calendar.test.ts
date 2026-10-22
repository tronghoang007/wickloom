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
