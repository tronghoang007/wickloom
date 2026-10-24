import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, useSettingsStore } from "@/store/settings";
import { eventClock, filterEvents, fmtEventValue, groupByDay, impactClass, isSoon, mergeWindow, shortEventName, type CalEvent } from "./calendarFormat";

const ev = (id: number, time: number, o: Partial<CalEvent> = {}): CalEvent => ({
  id, time, event_id: id, country: "US", currency: "USD", name: `E${id}`, importance: 2, unit: 0, multiplier: 0, digits: 1, time_mode: 0, impact: 0, actual: null, forecast: null, previous: null, revised: null, ...o,
});
const T0 = Date.UTC(2026, 9, 22, 12, 0) / 1000; // Thu 22 Oct 2026 12:00 UTC

beforeEach(() => useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, timezone: "UTC", hours: "24" } }));

describe("fmtEventValue", () => {
  it("chữ số thập phân, hệ số K/M/B/T và đơn vị %", () => {
    expect(fmtEventValue(3.8, { digits: 1, multiplier: 0, unit: 1 })).toBe("3.8%");
    expect(fmtEventValue(200, { digits: 0, multiplier: 1, unit: 0 })).toBe("200K");
    expect(fmtEventValue(-0.5, { digits: 2, multiplier: 0, unit: 1 })).toBe("-0.50%");
    expect(fmtEventValue(1.25, { digits: 2, multiplier: 3, unit: 0 })).toBe("1.25B");
  });
  it("chưa có số → —; digits lạ được kẹp", () => {
    expect(fmtEventValue(null, { digits: 1, multiplier: 0, unit: 0 })).toBe("—");
    expect(fmtEventValue(NaN, { digits: 1, multiplier: 0, unit: 0 })).toBe("—");
    expect(fmtEventValue(1.5, { digits: 99, multiplier: 9, unit: 77 })).toBe("1.50000000");
  });
});

describe("hiển thị", () => {
  it("màu theo impact của MT5", () => {
    expect(impactClass(1)).toContain("089981");
    expect(impactClass(2)).toContain("f23645");
    expect(impactClass(0)).toBe("");
  });
  it("giờ sự kiện theo múi giờ Settings; cả ngày / dự kiến / không giờ", () => {
    expect(eventClock(ev(1, T0))).toBe("12:00");
    useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, timezone: "Asia/Bangkok", hours: "24" } });
    expect(eventClock(ev(1, T0))).toBe("19:00");
    expect(eventClock(ev(1, T0, { time_mode: 1 }))).toBe("All day");
    expect(eventClock(ev(1, T0, { time_mode: 3 }))).toBe("Tentative");
    expect(eventClock(ev(1, T0, { time_mode: 2 }))).toBe("—");
  });
  it("isSoon: sắp tới trong 30 phút và chưa có số thực", () => {
    expect(isSoon(ev(1, T0 + 600), T0)).toBe(true);
    expect(isSoon(ev(1, T0 + 3600), T0)).toBe(false);
    expect(isSoon(ev(1, T0 - 60), T0)).toBe(false);
    expect(isSoon(ev(1, T0 + 600, { actual: 1 }), T0)).toBe(false);
  });
});

describe("groupByDay", () => {
  it("nhóm theo ngày của múi giờ Settings, nhãn Today / Tomorrow / Yesterday", () => {
    const g = groupByDay([ev(1, T0 - 86400), ev(2, T0), ev(3, T0 + 3600), ev(4, T0 + 86400), ev(5, T0 + 3 * 86400)], T0);
    expect(g.map((x) => x.label)).toEqual(["Yesterday · Wed 21 Oct", "Today · Thu 22 Oct", "Tomorrow · Fri 23 Oct", "Sun 25 Oct"]);
    expect(g[1].events.map((e) => e.id)).toEqual([2, 3]);
  });
  it("ranh giới ngày đổi theo múi giờ (23:30 UTC = 06:30 hôm sau ở Bangkok)", () => {
    useSettingsStore.setState({ s: { ...DEFAULT_SETTINGS, timezone: "Asia/Bangkok", hours: "24" } });
    const late = Date.UTC(2026, 9, 22, 23, 30) / 1000;
    const g = groupByDay([ev(1, T0), ev(2, late)], T0);
    expect(g).toHaveLength(2);
    expect(g[1].label).toContain("Fri 23 Oct");
  });
  it("rỗng → rỗng", () => expect(groupByDay([], T0)).toEqual([]));
});

describe("filterEvents / mergeWindow", () => {
  const list = [ev(1, T0, { importance: 1 }), ev(2, T0 + 1, { importance: 3, currency: "EUR" }), ev(3, T0 + 2, { importance: 2 })];
  it("lọc theo mức quan trọng tối thiểu và tiền tệ", () => {
    expect(filterEvents(list, { minImportance: 2, currencies: null }).map((e) => e.id)).toEqual([2, 3]);
    expect(filterEvents(list, { minImportance: 1, currencies: ["EUR"] }).map((e) => e.id)).toEqual([2]);
    expect(filterEvents(list, { minImportance: 1, currencies: [] }).map((e) => e.id)).toEqual([1, 2, 3]);
  });
  it("mergeWindow: thay sự kiện trong cửa sổ bằng bản mới (huỷ thì biến mất), giữ phần ngoài, sắp theo giờ", () => {
    const old = [ev(1, T0), ev(2, T0 + 100), ev(3, T0 + 1000)];
    const out = mergeWindow(old, [ev(2, T0 + 100, { actual: 2 }), ev(9, T0 + 50)], T0 + 10, T0 + 500);
    expect(out.map((e) => e.id)).toEqual([1, 9, 2, 3]);
    expect(out.find((e) => e.id === 2)?.actual).toBe(2);
  });
});

describe("shortEventName (kiểu Forex Factory)", () => {
  it("viết tắt chỉ số lớn và đổi MoM / YoY / QoQ", () => {
    expect(shortEventName("Consumer Price Index (CPI) MoM")).toBe("CPI m/m");
    expect(shortEventName("Core Consumer Price Index YoY")).toBe("Core CPI y/y");
    expect(shortEventName("Producer Price Index (PPI) MoM")).toBe("PPI m/m");
    expect(shortEventName("Gross Domestic Product (GDP) QoQ")).toBe("GDP q/q");
    expect(shortEventName("Core Personal Consumption Expenditures (PCE) Price Index MoM")).toBe("Core PCE Price Index m/m");
    expect(shortEventName("Retail Sales MoM")).toBe("Retail Sales m/m");
    expect(shortEventName("CPI Median YoY")).toBe("Median CPI y/y");
    expect(shortEventName("Consumer Price Index Common YoY")).toBe("Common CPI y/y");
    expect(shortEventName("CPI Trimmed-Mean YoY")).toBe("Trimmed CPI y/y");
    expect(shortEventName("Core CPI MoM")).toBe("Core CPI m/m");
    expect(shortEventName("Tertiary Industry Activity MoM")).toBe("Tertiary Industry Activity m/m");
    expect(shortEventName("ECB Executive Board Member Elderson Speech")).toBe("ECB Executive Board Member Elderson Speaks");
    expect(shortEventName("Ifo Business Climate", "DE")).toBe("German Ifo Business Climate");
    expect(shortEventName("German Ifo Business Climate", "DE")).toBe("German Ifo Business Climate");
    expect(shortEventName("Industrial Production m/m", "FR")).toBe("French Industrial Production m/m");
    expect(shortEventName("PPI y/y", "EU")).toBe("PPI y/y");
    expect(shortEventName("Purchasing Managers' Index (PMI)")).toBe("PMI");
    expect(shortEventName("ISM Manufacturing PMI")).toBe("ISM Manufacturing PMI");
  });
  it("tên chuẩn của Forex Factory cho sự kiện quen thuộc", () => {
    expect(shortEventName("Nonfarm Payrolls")).toBe("Non-Farm Employment Change");
    expect(shortEventName("Initial Jobless Claims")).toBe("Unemployment Claims");
    expect(shortEventName("Balance of Trade")).toBe("Trade Balance");
    expect(shortEventName("Fed Interest Rate Decision")).toBe("Federal Funds Rate");
    expect(shortEventName("ECB Interest Rate Decision")).toBe("Main Refinancing Rate");
    expect(shortEventName("BoE Interest Rate Decision")).toBe("Official Bank Rate");
    expect(shortEventName("BoJ Interest Rate Decision")).toBe("BOJ Policy Rate");
    expect(shortEventName("RBA Interest Rate Decision")).toBe("Cash Rate");
    expect(shortEventName("RBNZ Interest Rate Decision")).toBe("Official Cash Rate");
    expect(shortEventName("BoC Interest Rate Decision")).toBe("BOC Rate Statement");
  });
  it("tên không có luật thì giữ nguyên (chỉ gọn khoảng trắng)", () => {
    expect(shortEventName("  Unemployment   Rate ")).toBe("Unemployment Rate");
    expect(shortEventName("Fed Chair Powell Speaks")).toBe("Fed Chair Powell Speaks");
    expect(shortEventName("FOMC Meeting Minutes")).toBe("FOMC Meeting Minutes");
    expect(shortEventName("")).toBe("");
  });
});
