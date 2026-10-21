import { describe, expect, it } from "vitest";
import { presetVisibility, tfUnit, visibleOn } from "./visibility";

describe("tfUnit", () => {
  it("đọc khung của app", () => {
    expect(tfUnit("M15")).toEqual({ unit: "minutes", n: 15 });
    expect(tfUnit("H4")).toEqual({ unit: "hours", n: 4 });
    expect(tfUnit("D1")).toEqual({ unit: "days", n: 1 });
    expect(tfUnit("W1")).toEqual({ unit: "weeks", n: 1 });
    expect(tfUnit("MN1")).toEqual({ unit: "months", n: 1 });
    expect(tfUnit("??")).toBeNull();
  });
});

describe("visibleOn", () => {
  it("không cấu hình thì hiện ở mọi khung", () => {
    expect(visibleOn(undefined, "M1")).toBe(true);
    expect(visibleOn({}, "D1")).toBe(true);
  });
  it("theo bật/tắt và khoảng của đơn vị", () => {
    const v = { minutes: { on: true, from: 5, to: 30 }, hours: { on: false, from: 1, to: 24 } };
    expect(visibleOn(v, "M1")).toBe(false);
    expect(visibleOn(v, "M15")).toBe(true);
    expect(visibleOn(v, "H1")).toBe(false);
    expect(visibleOn(v, "D1")).toBe(true); // đơn vị không cấu hình
  });
});

describe("presetVisibility (menu Visibility on intervals)", () => {
  const show = (p: "above" | "below" | "only" | "all", at: string) =>
    ["M1", "M5", "M15", "M30", "H1", "H4", "D1", "W1", "MN1"].filter((tf) => visibleOn(presetVisibility(p, at), tf));
  it("khung hiện tại trở lên", () => expect(show("above", "M15")).toEqual(["M15", "M30", "H1", "H4", "D1", "W1", "MN1"]));
  it("khung hiện tại trở xuống", () => expect(show("below", "H1")).toEqual(["M1", "M5", "M15", "M30", "H1"]));
  it("chỉ khung hiện tại", () => expect(show("only", "H4")).toEqual(["H4"]));
  it("mọi khung = bỏ cấu hình", () => expect(presetVisibility("all", "H4")).toBeUndefined());
});
