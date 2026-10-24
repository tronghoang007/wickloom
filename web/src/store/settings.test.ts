import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, mergeSettings, parseSettings, useSettingsStore } from "./settings";
import { SETTINGS_KEY, bindSettingsPersistence, loadSettings } from "./settingsStorage";

describe("mergeSettings", () => {
  it("field mới lấy mặc định, setting đã lưu được giữ", () => {
    const s = mergeSettings({ fontSize: 15 });
    expect(s.fontSize).toBe(15);
    expect(s.oneClick).toBe(false);
    expect(mergeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });
  it("confirmClose=false của bản thử trước thành One-click trading bật; có oneClick rồi thì không đè", () => {
    expect(mergeSettings({ confirmClose: false }).oneClick).toBe(true);
    expect(mergeSettings({ confirmClose: true }).oneClick).toBe(false);
    expect(mergeSettings({ confirmClose: false, oneClick: false }).oneClick).toBe(false);
  });
});

describe("parseSettings", () => {
  it("không phải object → undefined (layout cũ chưa lưu setting)", () => {
    for (const v of [undefined, null, "x", 3, []]) expect(parseSettings(v)).toBeUndefined();
  });
  it("đủ field theo thứ tự DEFAULT_SETTINGS; sai kiểu → mặc định, bỏ field lạ, nhận màu/số của field mặc định null", () => {
    const s = parseSettings({ fontSize: "to", bodyUp: "#fff", bg: "#000000", precision: 3, lạ: 1, gridColor: 5 })!;
    expect(Object.keys(s)).toEqual(Object.keys(DEFAULT_SETTINGS));
    expect(s.fontSize).toBe(DEFAULT_SETTINGS.fontSize);
    expect(s).toMatchObject({ bodyUp: "#fff", bg: "#000000", precision: 3, gridColor: 5 });
    expect(s).not.toHaveProperty("lạ");
  });
  it("round-trip qua JSON giữ nguyên chuỗi (docKey so chuỗi)", () => {
    const s = mergeSettings({ bg: "#101010", fontSize: 14 });
    expect(JSON.stringify(parseSettings(JSON.parse(JSON.stringify(s))))).toBe(JSON.stringify(s));
  });
});

const fakeKv = (init: Record<string, string> = {}) => {
  const data = { ...init };
  return { data, getItem: (k: string) => (k in data ? data[k] : null), setItem: (k: string, v: string) => { data[k] = v; } };
};
const saved = (s: object, version: number) => JSON.stringify({ state: { s }, version });

describe("loadSettings (key của khách)", () => {
  it("không có / hỏng → mặc định", () => {
    expect(loadSettings(fakeKv())).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(fakeKv({ [SETTINGS_KEY]: "{hỏng" }))).toEqual(DEFAULT_SETTINGS);
  });
  it("migrate: v0 titleMode, v1 marginBottom 25 → 8 (giá trị khác giữ), v2 bg trùng nền dark → null (màu khác giữ)", () => {
    const load = (s: object, v: number) => loadSettings(fakeKv({ [SETTINGS_KEY]: saved(s, v) }));
    expect(load({ titleMode: "name" }, 0).titleMode).toBe("description");
    expect(load({ marginBottom: 25 }, 1).marginBottom).toBe(8);
    expect(load({ marginBottom: 30 }, 1).marginBottom).toBe(30);
    expect(load({ bg: "#000000" }, 2).bg).toBeNull();
    expect(load({ bg: "#0F0F0F" }, 2).bg).toBeNull();
    expect(load({ bg: "#112233" }, 2).bg).toBe("#112233");
    expect(load({ bg: "#000000" }, 3).bg).toBe("#000000"); // v3: chọn tay sau migrate thì giữ
  });
});

describe("bindSettingsPersistence", () => {
  beforeEach(() => useSettingsStore.setState({ s: DEFAULT_SETTINGS }));
  afterEach(() => useSettingsStore.setState({ s: DEFAULT_SETTINGS }));

  it("nạp setting đã lưu vào store, ghi lại mỗi khi đổi, gỡ rồi thì ngừng ghi", () => {
    const kv = fakeKv({ [SETTINGS_KEY]: saved({ fontSize: 15 }, 3) });
    const off = bindSettingsPersistence(kv);
    expect(useSettingsStore.getState().s.fontSize).toBe(15);
    useSettingsStore.getState().set({ bg: "#202020" });
    expect(JSON.parse(kv.data[SETTINGS_KEY])).toMatchObject({ version: 3, state: { s: { fontSize: 15, bg: "#202020" } } });
    off();
    useSettingsStore.getState().set({ bg: "#303030" });
    expect(JSON.parse(kv.data[SETTINGS_KEY]).state.s.bg).toBe("#202020");
  });
});
