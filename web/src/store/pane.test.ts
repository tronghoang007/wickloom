import { drawingGlobal, useDrawingStore } from "@/drawings/store";
import { indicatorGlobal, useIndicatorStore } from "@/indicators/store";
import { exitReplay, useReplayStore } from "@/replay/store";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chartGlobal, useChartStore } from "./chart";
import { PRIMARY_PANE_ID, allPanes, flushAllDrawings, getPane, isActivePane, useLayoutStore } from "./layout";
import { DEFAULT_CHART, DEFAULT_VOLUME, applyPaneInit, createPane, snapshotPane } from "./paneStores";
import { PANE_KEY, bindPanePersistence, loadPaneInit, parsePaneInit } from "./paneStorage";
import { useVolumeStore } from "./volume";

const p1 = () => getPane(PRIMARY_PANE_ID);

beforeEach(() => {
  useLayoutStore.getState().add("p2", { chart: { symbol: "EURUSD", tf: "H1" } });
});
afterEach(() => {
  useLayoutStore.getState().setActive(PRIMARY_PANE_ID);
  useLayoutStore.getState().remove("p2");
  p1().chart.setState(DEFAULT_CHART);
  p1().indicators.setState({ list: [], collapsed: false });
  p1().volume.setState({ s: DEFAULT_VOLUME });
  p1().draw.setState({ drawings: [], selectedId: null, api: null });
  chartGlobal.setState({ theme: "dark", symbols: [] });
  drawingGlobal.setState({ tool: null });
});

describe("pane active + facade", () => {
  it("UI ngoài chart đọc pane đang active, đổi active thì đọc pane mới", () => {
    expect(useChartStore.getState().symbol).toBe("XAUUSDm");
    useLayoutStore.getState().setActive("p2");
    expect(useChartStore.getState()).toMatchObject({ symbol: "EURUSD", tf: "H1" });
    expect(isActivePane("p2")).toBe(true);
    expect(isActivePane(PRIMARY_PANE_ID)).toBe(false);
  });

  it("setState chia patch: khoá của pane ghi vào pane active, khoá chung ghi vào store chung", () => {
    useLayoutStore.getState().setActive("p2");
    useChartStore.setState({ symbol: "GBPUSD", theme: "light" });
    expect(getPane("p2").chart.getState().symbol).toBe("GBPUSD");
    expect(p1().chart.getState().symbol).toBe("XAUUSDm"); // pane khác không bị đụng
    expect(chartGlobal.getState().theme).toBe("light");
    expect(getPane("p2").chart.getState()).not.toHaveProperty("theme");
  });

  it("action `set` của useChartStore cũng định tuyến theo khoá", () => {
    useChartStore.getState().set({ tf: "D1", favTfs: ["M5"] });
    expect(p1().chart.getState().tf).toBe("D1");
    expect(chartGlobal.getState().favTfs).toEqual(["M5"]);
    chartGlobal.setState({ favTfs: ["M1", "M5", "H1"] });
  });

  it("state ghép được cache: không đổi gì thì cùng tham chiếu (selector không gây render thừa)", () => {
    const a = useChartStore.getState();
    expect(useChartStore.getState()).toBe(a);
    p1().chart.setState({ tf: "M15" });
    expect(useChartStore.getState()).not.toBe(a);
  });

  it("store không có phần chung (replay, volume) cũng cache được state ghép - hook không lặp vô hạn", () => {
    expect(useReplayStore.getState()).toBe(useReplayStore.getState());
    expect(useVolumeStore.getState()).toBe(useVolumeStore.getState());
    const before = useReplayStore.getState();
    p1().replay.setState({ speed: "5x" });
    expect(useReplayStore.getState()).not.toBe(before);
    expect(useReplayStore.getState().speed).toBe("5x");
    p1().replay.setState({ speed: "1x" });
  });

  it("subscribe: báo khi pane active hoặc store chung đổi, và theo sang pane mới khi đổi active", () => {
    const seen = vi.fn();
    const off = useChartStore.subscribe(seen);
    p1().chart.setState({ tf: "M30" });
    expect(seen).toHaveBeenCalledTimes(1);
    getPane("p2").chart.setState({ tf: "H4" }); // pane không active: im lặng
    expect(seen).toHaveBeenCalledTimes(1);
    useLayoutStore.getState().setActive("p2"); // đổi active: báo 1 lần
    expect(seen).toHaveBeenCalledTimes(2);
    getPane("p2").chart.setState({ tf: "D1" });
    expect(seen).toHaveBeenCalledTimes(3);
    p1().chart.setState({ tf: "H1" }); // pane cũ không còn được nghe
    expect(seen).toHaveBeenCalledTimes(3);
    chartGlobal.setState({ theme: "light" });
    expect(seen).toHaveBeenCalledTimes(4);
    off();
    chartGlobal.setState({ theme: "dark" });
    expect(seen).toHaveBeenCalledTimes(4);
  });

  it("setActive bỏ qua id không tồn tại", () => {
    useLayoutStore.getState().setActive("nope");
    expect(useLayoutStore.getState().activeId).toBe(PRIMARY_PANE_ID);
  });

  it("xoá pane đang active thì active về pane đầu; không xoá được pane chính", () => {
    useLayoutStore.getState().setActive("p2");
    useLayoutStore.getState().remove("p2");
    expect(useLayoutStore.getState().activeId).toBe(PRIMARY_PANE_ID);
    useLayoutStore.getState().remove(PRIMARY_PANE_ID);
    expect(allPanes().map((p) => p.id)).toEqual([PRIMARY_PANE_ID]);
    useLayoutStore.getState().add("p2");
  });
});

describe("state tách theo pane", () => {
  it("indicator của từng pane độc lập, yêu thích dùng chung", () => {
    p1().indicators.getState().add("sma");
    expect(p1().indicators.getState().list).toHaveLength(1);
    expect(getPane("p2").indicators.getState().list).toHaveLength(0);
    useLayoutStore.getState().setActive("p2");
    expect(useIndicatorStore.getState().list).toHaveLength(0);
    useIndicatorStore.getState().add("ema");
    expect(getPane("p2").indicators.getState().list.map((i) => i.id)).toEqual(["ema"]);
    expect(p1().indicators.getState().list.map((i) => i.id)).toEqual(["sma"]);
    useIndicatorStore.setState({ list: [] }); // menu "Remove indicators" của pane active
    expect(getPane("p2").indicators.getState().list).toEqual([]);
    expect(p1().indicators.getState().list).toHaveLength(1);
    expect(useIndicatorStore.getState().favorites).toBe(indicatorGlobal.getState().favorites);
  });

  it("volume + replay theo pane active", () => {
    useLayoutStore.getState().setActive("p2");
    useVolumeStore.getState().set({ maOn: true });
    expect(getPane("p2").volume.getState().s.maOn).toBe(true);
    expect(p1().volume.getState().s.maOn).toBe(false);
    useReplayStore.setState({ selecting: true });
    expect(getPane("p2").replay.getState().selecting).toBe(true);
    expect(p1().replay.getState().selecting).toBe(false);
    exitReplay(); // không tham số = pane active
    expect(getPane("p2").replay.getState().selecting).toBe(false);
    p1().replay.setState({ active: true });
    exitReplay(p1().replay); // Chart thoát replay của đúng pane mình, không phụ thuộc active
    expect(p1().replay.getState().active).toBe(false);
  });

  it("drawing: công cụ chung, hình đang chọn / danh sách theo pane", () => {
    useLayoutStore.getState().setActive("p2");
    useDrawingStore.setState({ tool: "trendline", selectedId: "d1" });
    expect(drawingGlobal.getState().tool).toBe("trendline");
    expect(getPane("p2").draw.getState().selectedId).toBe("d1");
    expect(p1().draw.getState().selectedId).toBeNull();
    useLayoutStore.getState().setActive(PRIMARY_PANE_ID);
    expect(useDrawingStore.getState()).toMatchObject({ tool: "trendline", selectedId: null }); // tool theo bạn sang pane khác
  });

  it("flushAllDrawings gọi flushSave của mọi pane và đợi tất cả", async () => {
    const done: string[] = [];
    const api = (id: string, ms: number) =>
      ({ flushSave: () => new Promise<void>((r) => setTimeout(() => { done.push(id); r(); }, ms)) }) as never;
    p1().draw.setState({ api: api("p1", 20) });
    getPane("p2").draw.setState({ api: api("p2", 5) });
    await flushAllDrawings();
    expect(done.sort()).toEqual(["p1", "p2"]);
  });

  it("snapshotPane / applyPaneInit round-trip, bỏ phần chạy (replay, drawings)", () => {
    const a = createPane("a", { chart: { symbol: "BTCUSDm", tf: "H4", chartType: "line", scaleMode: "log" }, legendCollapsed: true });
    a.indicators.getState().add("rsi");
    a.volume.getState().set({ maOn: true });
    a.replay.setState({ active: true });
    const snap = snapshotPane(a);
    expect(Object.keys(snap).sort()).toEqual(["chart", "indicators", "legendCollapsed", "volume"]);
    const b = createPane("b");
    applyPaneInit(b, snap);
    expect(snapshotPane(b)).toEqual(snap);
    expect(b.replay.getState().active).toBe(false);
  });
});

// --- lưu pane chính ----------------------------------------------------------------------------
function fakeStorage(init: Record<string, string> = {}) {
  const data = { ...init };
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: vi.fn((k: string, v: string) => { data[k] = v; }),
  };
}
const legacy = () => ({
  "invest-chart-prefs": JSON.stringify({ state: { symbol: "BTCUSDm", tf: "H1", chartType: "heikin", scaleMode: "log", theme: "light", favTfs: ["M1"] }, version: 0 }),
  "tv-indicators": JSON.stringify({ state: { list: [{ uid: "u1", id: "sma", inputs: { length: 9 }, colors: ["#fff"] }], favorites: ["sma"], collapsed: true }, version: 0 }),
  "tv-volume": JSON.stringify({ state: { s: { maOn: true, maLength: 50 } }, version: 0 }),
});

describe("loadPaneInit", () => {
  it("chưa có gì → {}", () => {
    expect(loadPaneInit(fakeStorage())).toEqual({});
  });

  it("migrate từ 3 key cũ (symbol/tf/loại nến, indicator + legend, volume)", () => {
    const init = loadPaneInit(fakeStorage(legacy()));
    expect(init.chart).toEqual({ symbol: "BTCUSDm", tf: "H1", chartType: "heikin", scaleMode: "log" });
    expect(init.indicators?.[0]).toMatchObject({ id: "sma", inputs: { length: 9 } });
    expect(init.legendCollapsed).toBe(true);
    expect(init.volume).toEqual({ maOn: true, maLength: 50 });
  });

  it("key mới thắng key cũ", () => {
    const kv = fakeStorage({ ...legacy(), [PANE_KEY]: JSON.stringify({ chart: { symbol: "EURUSD", tf: "M5" } }) });
    expect(loadPaneInit(kv).chart).toEqual({ symbol: "EURUSD", tf: "M5" });
  });

  it("dữ liệu hỏng / sai kiểu không làm vỡ: bỏ field xấu, JSON hỏng → mặc định", () => {
    expect(loadPaneInit(fakeStorage({ [PANE_KEY]: "{not json" }))).toEqual({});
    const init = parsePaneInit({ chart: { symbol: 42, tf: "H1", chartType: "pie", scaleMode: "percent" }, indicators: "x", volume: 3 });
    expect(init).toEqual({ chart: { tf: "H1", scaleMode: "percent" } });
  });
});

describe("bindPanePersistence", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("nạp state đã lưu, ghi key mới ngay (đã migrate), không đụng key cũ", () => {
    const kv = fakeStorage(legacy());
    const before = { ...kv.data };
    const pane = createPane("x");
    const off = bindPanePersistence(pane, kv);
    expect(pane.chart.getState()).toMatchObject({ symbol: "BTCUSDm", tf: "H1" });
    expect(pane.indicators.getState().list).toHaveLength(1);
    expect(pane.volume.getState().s.maLength).toBe(50);
    expect(JSON.parse(kv.data[PANE_KEY]).chart.symbol).toBe("BTCUSDm");
    for (const k of Object.keys(before)) expect(kv.data[k]).toBe(before[k]);
    off();
  });

  it("dùng `init` đã đọc sớm thay vì đọc lại key (store chung có thể đã ghi đè key cũ)", () => {
    const kv = fakeStorage(legacy());
    const init = loadPaneInit(kv);
    kv.data["invest-chart-prefs"] = JSON.stringify({ state: { theme: "dark" }, version: 0 }); // bị ghi lại sau khi đọc sớm
    const pane = createPane("x");
    bindPanePersistence(pane, kv, { init })();
    expect(pane.chart.getState()).toMatchObject({ symbol: "BTCUSDm", tf: "H1" });
  });

  it("đổi state → lưu sau 300ms (gộp nhiều thay đổi liên tiếp thành 1 lần ghi), không ghi khi không đổi", () => {
    const kv = fakeStorage();
    const pane = createPane("x");
    const off = bindPanePersistence(pane, kv);
    expect(kv.setItem).toHaveBeenCalledTimes(1);
    pane.chart.setState({ tf: "H4" });
    pane.chart.setState({ symbol: "EURUSD" });
    vi.advanceTimersByTime(299);
    expect(kv.setItem).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(2);
    expect(kv.setItem).toHaveBeenCalledTimes(2);
    expect(JSON.parse(kv.data[PANE_KEY]).chart).toMatchObject({ symbol: "EURUSD", tf: "H4" });
    pane.replay.setState({ active: true }); // trạng thái chạy không được lưu và không kích ghi
    pane.draw.setState({ selectedId: "d" });
    vi.advanceTimersByTime(1000);
    expect(kv.setItem).toHaveBeenCalledTimes(2);
    off();
  });

  it("đóng tab (flush) lưu nốt thay đổi đang chờ; gỡ ra cũng lưu nốt", () => {
    const kv = fakeStorage();
    const pane = createPane("x");
    let flush = () => {};
    const off = bindPanePersistence(pane, kv, { onUnload: (f) => { flush = f; return () => {}; } });
    pane.indicators.getState().add("macd");
    flush();
    expect(JSON.parse(kv.data[PANE_KEY]).indicators).toHaveLength(1);
    pane.volume.getState().set({ maOn: true });
    off();
    expect(JSON.parse(kv.data[PANE_KEY]).volume.maOn).toBe(true);
  });

  it("round-trip qua lần mở sau", () => {
    const kv = fakeStorage();
    const a = createPane("a");
    const offA = bindPanePersistence(a, kv);
    a.chart.setState({ symbol: "XAGUSD", chartType: "area" });
    a.indicators.getState().add("rsi");
    offA();
    const b = createPane("b");
    bindPanePersistence(b, kv)();
    expect(b.chart.getState()).toMatchObject({ symbol: "XAGUSD", chartType: "area" });
    expect(b.indicators.getState().list.map((i) => i.id)).toEqual(["rsi"]);
  });

  it("localStorage đầy/bị chặn không làm chart vỡ", () => {
    const kv = fakeStorage();
    kv.setItem.mockImplementation(() => { throw new Error("QuotaExceededError"); });
    const pane = createPane("x");
    const off = bindPanePersistence(pane, kv);
    pane.chart.setState({ tf: "D1" });
    expect(() => vi.advanceTimersByTime(500)).not.toThrow();
    off();
  });
});
