import { describe, expect, it } from "vitest";
import { TIMEZONES, sortedTimezones, tzMenuLabel, tzOffsetLabel, tzOffsetMinutes } from "./timefmt";

const JAN = Date.UTC(2026, 0, 15, 12) / 1000; // mùa đông bắc bán cầu
const JUL = Date.UTC(2026, 6, 15, 12) / 1000; // mùa hè bắc bán cầu

describe("múi giờ", () => {
  it("nhãn lệch giờ: số giờ nguyên, lẻ phút, âm, và UTC trần", () => {
    expect(tzOffsetLabel("Asia/Bangkok", JAN)).toBe("UTC+7");
    expect(tzOffsetLabel("Asia/Kolkata", JAN)).toBe("UTC+5:30");
    expect(tzOffsetLabel("Asia/Kathmandu", JAN)).toBe("UTC+5:45");
    expect(tzOffsetLabel("America/New_York", JAN)).toBe("UTC-5");
    expect(tzOffsetLabel("UTC", JAN)).toBe("UTC");
  });

  it("theo giờ mùa hè tại thời điểm đó", () => {
    expect(tzOffsetLabel("America/New_York", JUL)).toBe("UTC-4");
    expect(tzOffsetLabel("Europe/London", JAN)).toBe("UTC");
    expect(tzOffsetLabel("Europe/London", JUL)).toBe("UTC+1");
    expect(tzOffsetMinutes("Asia/Kathmandu", JUL)).toBe(345);
    expect(tzOffsetMinutes("America/St_Johns", JAN)).toBe(-210);
  });

  it("dòng dropdown: UTC trơn, còn lại '(UTC+7) Bangkok'", () => {
    expect(tzMenuLabel({ id: "UTC", label: "UTC" }, JAN)).toBe("UTC");
    expect(tzMenuLabel({ id: "Asia/Bangkok", label: "Bangkok" }, JAN)).toBe("(UTC+7) Bangkok");
  });

  it("mọi id trong danh sách là IANA hợp lệ (không ném lỗi), id không trùng", () => {
    for (const z of TIMEZONES) expect(() => tzOffsetMinutes(z.id, JAN)).not.toThrow();
    expect(new Set(TIMEZONES.map((z) => z.id)).size).toBe(TIMEZONES.length);
  });

  it("giữ các id đã lưu từ bản trước", () => {
    for (const id of ["local", "UTC", "America/New_York", "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Australia/Sydney"]) expect(TIMEZONES.some((z) => z.id === id)).toBe(true);
  });

  it("sắp xếp: Giờ máy + UTC đứng đầu, phần còn lại tăng dần theo mức lệch", () => {
    const list = sortedTimezones(JAN);
    expect(list.slice(0, 2).map((z) => z.id)).toEqual(["local", "UTC"]);
    const offs = list.slice(2).map((z) => tzOffsetMinutes(z.id, JAN));
    expect(offs).toEqual([...offs].sort((a, b) => a - b));
    expect(list).toHaveLength(TIMEZONES.length);
  });
});
