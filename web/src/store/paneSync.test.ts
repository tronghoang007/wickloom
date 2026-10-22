import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRIMARY_PANE_ID, getPane, useLayoutStore } from "./layout";
import { NO_SYNC, buildDoc } from "./layoutDoc";
import { buildTemplate } from "./layoutTree";
import { DEFAULT_CHART, createPane } from "./paneStores";
import {
  barIndexAt, indexAt, isSyncedRange, registerPaneView, startPaneSync, syncCrosshair, syncRange, syncTime, timeAt,
  type LogicalRange, type PaneRange, type PaneView,
} from "./paneSync";

const L = () => useLayoutStore.getState();

// M5 có lỗ (cuối tuần): 0,300,600 | nhảy tới 10000, 10300
const BARS = [0, 300, 600, 10000, 10300].map((t) => ({ t }));
const TF = 300;

describe("timeAt / indexAt", () => {
  it("nội suy tuyến tính giữa hai nến, kể cả qua lỗ dữ liệu", () => {
    expect(timeAt(BARS, TF, 0)).toBe(0);
    expect(timeAt(BARS, TF, 1.5)).toBe(450);
    expect(timeAt(BARS, TF, 2.5)).toBe(5300); // giữa 600 và 10000
    expect(indexAt(BARS, TF, 450)).toBe(1.5);
    expect(indexAt(BARS, TF, 10000)).toBe(3);
  });

  it("ngoài hai đầu: ngoại suy theo độ dài một nến", () => {
    expect(timeAt(BARS, TF, -2)).toBe(-600);
    expect(timeAt(BARS, TF, 4 + 8)).toBe(10300 + 8 * TF);
    expect(indexAt(BARS, TF, -600)).toBe(-2);
    expect(indexAt(BARS, TF, 10300 + 8 * TF)).toBe(12);
  });

  it("indexAt là ngược của timeAt", () => {
    for (const i of [-3, 0, 0.25, 1, 2.9, 3, 3.5, 4, 9.75]) expect(indexAt(BARS, TF, timeAt(BARS, TF, i)!)).toBeCloseTo(i, 9);
  });

  it("không có nến / giá trị hỏng → null", () => {
    expect(timeAt([], TF, 1)).toBeNull();
    expect(indexAt([], TF, 1)).toBeNull();
    expect(timeAt(BARS, TF, NaN)).toBeNull();
    expect(indexAt(BARS, TF, Infinity)).toBeNull();
  });

  it("barIndexAt: nến chứa thời gian (mở ≤ t < mở + khung), ngoài dữ liệu → -1", () => {
    expect(barIndexAt(BARS, TF, 0)).toBe(0);
    expect(barIndexAt(BARS, TF, 599)).toBe(1);
    expect(barIndexAt(BARS, TF, 600)).toBe(2);
    expect(barIndexAt(BARS, TF, 5000)).toBe(2); // giữa lỗ: nến trước đó
    expect(barIndexAt(BARS, TF, 10599)).toBe(4);
    expect(barIndexAt(BARS, TF, 10600)).toBe(-1);
    expect(barIndexAt(BARS, TF, -1)).toBe(-1);
    expect(barIndexAt([], TF, 0)).toBe(-1);
  });
});

describe("symbol / interval sync", () => {
  let stop: () => void;
  const chart = (id: string) => getPane(id).chart;
  beforeEach(() => {
    L().setTemplate("3h");
    L().setSync(NO_SYNC);
    for (const id of L().order) chart(id).setState({ ...DEFAULT_CHART, symbol: id === "p1" ? "XAUUSDm" : "EURUSD", tf: id === "p3" ? "H1" : "M5" });
    stop = startPaneSync();
  });
  afterEach(() => {
    stop();
    L().setSync(NO_SYNC);
    L().setActive(PRIMARY_PANE_ID);
    L().setTemplate("s");
    chart(PRIMARY_PANE_ID).setState(DEFAULT_CHART);
  });

  it("tắt thì mỗi chart đổi riêng", () => {
    chart("p1").setState({ symbol: "BTCUSDm", tf: "M1" });
    expect(chart("p2").getState()).toMatchObject({ symbol: "EURUSD", tf: "M5" });
  });

  it("Symbol: đổi ở chart nào thì các chart khác đổi theo (khung giữ nguyên)", () => {
    L().setSync({ symbol: true });
    chart("p2").setState({ symbol: "GBPUSD" });
    expect(L().order.map((id) => chart(id).getState().symbol)).toEqual(["GBPUSD", "GBPUSD", "GBPUSD"]);
    expect(chart("p3").getState().tf).toBe("H1");
  });

  it("Interval: đổi khung thì symbol giữ nguyên", () => {
    L().setSync({ interval: true });
    chart("p1").setState({ tf: "M15" });
    expect(L().order.map((id) => chart(id).getState().tf)).toEqual(["M15", "M15", "M15"]);
    expect(chart("p2").getState().symbol).toBe("EURUSD");
  });

  it("đổi cả symbol và khung trong một lần (watchlist/favorites) khi cả hai bật", () => {
    L().setSync({ symbol: true, interval: true });
    chart("p3").setState({ symbol: "USDJPY", tf: "D1" });
    for (const id of L().order) expect(chart(id).getState()).toMatchObject({ symbol: "USDJPY", tf: "D1" });
  });

  it("chartType / scaleMode không đồng bộ", () => {
    L().setSync({ symbol: true, interval: true });
    chart("p1").setState({ chartType: "line", scaleMode: "log" });
    expect(chart("p2").getState()).toMatchObject({ chartType: "candles", scaleMode: "normal" });
  });

  it("vừa bật Symbol: các chart khác lấy ngay symbol của chart ACTIVE (không đụng khung)", () => {
    L().setActive("p2");
    L().setSync({ symbol: true });
    expect(L().order.map((id) => chart(id).getState().symbol)).toEqual(["EURUSD", "EURUSD", "EURUSD"]);
    expect(chart("p3").getState().tf).toBe("H1");
  });

  it("bật Interval: các chart khác lấy khung của chart active", () => {
    L().setActive("p3");
    L().setSync({ interval: true });
    expect(L().order.map((id) => chart(id).getState().tf)).toEqual(["H1", "H1", "H1"]);
  });

  it("pane thêm bằng đổi mẫu cũng được theo dõi", () => {
    L().setTemplate("4");
    L().setSync({ symbol: true });
    chart("p4").setState({ symbol: "AUDUSD" });
    expect(chart("p1").getState().symbol).toBe("AUDUSD");
  });

  it("mở layout khác: công tắc lấy từ layout, symbol các chart giữ như đã lưu (không bị ép về chart active)", () => {
    const panes = { p1: createPane("p1", { chart: { symbol: "AAA" } }), p2: createPane("p2", { chart: { symbol: "BBB" } }) };
    const doc = buildDoc({
      name: "x", templateId: "2h", tree: buildTemplate("2h", ["p1", "p2"]), order: ["p1", "p2"], panes, activeId: "p1",
      sync: { ...NO_SYNC, symbol: true },
    });
    L().applyLayout(doc, "other");
    expect(L().sync.symbol).toBe(true);
    expect(chart("p1").getState().symbol).toBe("AAA");
    expect(chart("p2").getState().symbol).toBe("BBB");
    chart("p2").setState({ symbol: "CCC" }); // nhưng đổi sau đó thì đi theo
    expect(chart("p1").getState().symbol).toBe("CCC");
    L().applyLayout(buildDoc({ name: "d", templateId: "s", tree: buildTemplate("s", ["p1"]), order: ["p1"], panes: { p1: createPane("p1") }, activeId: "p1" }), "default");
  });
});

describe("range / crosshair sync", () => {
  type Fake = PaneView & {
    range: PaneRange | null; sets: [number, number][]; shows: [number, number][]; cross: (number | null)[]; hover: boolean;
  };
  const fake = (init: { from: number; to: number; clamp?: (r: LogicalRange) => LogicalRange }): Fake => {
    const f: Fake = {
      range: { from: init.from, to: init.to, lf: init.from / 100, lt: init.to / 100 },
      sets: [], shows: [], cross: [], hover: false,
      getRange: () => f.range,
      setRange: (to, from) => {
        f.sets.push([to, from]);
        const r = { lf: from / 100, lt: to / 100 };
        const res = init.clamp?.(r) ?? r;
        f.range = { from: res.lf * 100, to: res.lt * 100, ...res };
        return res;
      },
      showTime: (t, frac) => {
        f.shows.push([t, frac]);
        const span = f.range!.lt - f.range!.lf;
        const lf = t / 100 - frac * span;
        const res = { lf, lt: lf + span };
        f.range = { from: res.lf * 100, to: res.lt * 100, ...res };
        return res;
      },
      setCrosshair: (t) => void f.cross.push(t),
      hovered: () => f.hover,
    };
    return f;
  };
  let offs: (() => void)[];
  const reg = (id: string, f: Fake) => offs.push(registerPaneView(id, f));
  beforeEach(() => {
    offs = [];
    L().setTemplate("3h");
    L().setSync(NO_SYNC);
  });
  afterEach(() => {
    offs.forEach((o) => o());
    L().setSync(NO_SYNC);
    L().setTemplate("s");
  });

  it("tắt hết thì không làm gì", () => {
    const a = fake({ from: 0, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    reg("p1", a);
    reg("p2", b);
    syncRange("p1");
    syncTime("p1", 100, 0.5);
    syncCrosshair("p1", 100);
    expect(b.sets).toEqual([]);
    expect(b.shows).toEqual([]);
    expect(b.cross).toEqual([]);
  });

  it("Date range: các chart khác hiện cùng khoảng [from, to]; nguồn không bị đặt lại", () => {
    L().setSync({ dateRange: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    const c = fake({ from: 0, to: 500 });
    reg("p1", a);
    reg("p2", b);
    reg("p3", c);
    syncRange("p1");
    expect(a.sets).toEqual([]);
    expect(b.sets).toEqual([[1000, 400]]);
    expect(c.sets).toEqual([[1000, 400]]);
  });

  it("Time: cuộn/zoom KHÔNG lan (chỉ lan khi bấm)", () => {
    L().setSync({ time: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    reg("p1", a);
    reg("p2", b);
    syncRange("p1");
    expect(b.sets).toEqual([]);
    expect(b.shows).toEqual([]);
  });

  it("Time: bấm vào chart → các chart khác cuộn tới cùng thời điểm, cùng vị trí ngang, giữ số nến đang hiện", () => {
    L().setSync({ time: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    const c = fake({ from: 0, to: 500 });
    reg("p1", a);
    reg("p2", b);
    reg("p3", c);
    syncTime("p1", 700, 0.25);
    expect(a.shows).toEqual([]);
    expect(b.shows).toEqual([[700, 0.25]]);
    expect(c.shows).toEqual([[700, 0.25]]);
    expect(b.range!.lt - b.range!.lf).toBeCloseTo(5); // span 500/100 giữ nguyên
    expect(b.range!.lf).toBeCloseTo(7 - 0.25 * 5);
  });

  it("Time: tắt thì bấm không làm gì; vị trí ngang ngoài 0..1 được kẹp; chart chưa có dữ liệu bị bỏ qua", () => {
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    const c = fake({ from: 0, to: 500 });
    c.showTime = () => null;
    reg("p1", a);
    reg("p2", b);
    reg("p3", c);
    syncTime("p1", 700, 0.5);
    expect(b.shows).toEqual([]);
    L().setSync({ time: true });
    syncTime("p1", 700, 1.7);
    syncTime("p1", 700, -3);
    expect(b.shows).toEqual([[700, 1], [700, 0]]);
  });

  it("Time + Date range cùng bật: bấm đặt echo, nên chart vừa được cuộn không kéo ngược nguồn", () => {
    L().setSync({ time: true, dateRange: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    reg("p1", a);
    reg("p2", b);
    syncTime("p1", 700, 0.5);
    syncRange("p2"); // sự kiện dội lại của b (b vẫn đúng góc nhìn do đồng bộ đặt)
    expect(a.sets).toEqual([]);
  });

  it("sự kiện dội lại từ chart vừa được đặt bị bỏ qua (không kéo nguồn quay lại)", () => {
    L().setSync({ dateRange: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    reg("p1", a);
    reg("p2", b);
    syncRange("p1");
    a.range = { from: 700, to: 1300, lf: 7, lt: 13 }; // người dùng kéo tiếp nguồn trước khi sự kiện của b tới
    syncRange("p2"); // sự kiện dội của b (b vẫn đúng giá trị đã đặt)
    expect(a.sets).toEqual([]);
    expect(a.range!.to).toBe(1300);
  });

  it("chart bị giới hạn (clamp) không kéo ngược nguồn: kết quả thực tế được ghi nhận là 'do đồng bộ đặt'", () => {
    L().setSync({ dateRange: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500, clamp: (r) => ({ lf: r.lf, lt: Math.min(r.lt, 8) }) });
    reg("p1", a);
    reg("p2", b);
    syncRange("p1");
    expect(b.range!.to).toBe(800);
    expect(isSyncedRange("p2", { lf: b.range!.lf, lt: b.range!.lt })).toBe(true);
    syncRange("p2");
    expect(a.sets).toEqual([]);
    // người dùng kéo b sang chỗ khác → không còn là echo, lan sang a
    b.range = { from: 100, to: 600, lf: 1, lt: 6 };
    expect(isSyncedRange("p2", { lf: 1, lt: 6 })).toBe(false);
    syncRange("p2");
    expect(a.sets).toEqual([[600, 100]]);
  });

  it("chart chưa có dữ liệu (setRange → null) bị bỏ qua, chart khác vẫn được đặt", () => {
    L().setSync({ dateRange: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    const c = fake({ from: 0, to: 500 });
    b.setRange = () => null;
    reg("p1", a);
    reg("p2", b);
    reg("p3", c);
    syncRange("p1");
    expect(c.sets).toEqual([[1000, 400]]);
    expect(isSyncedRange("p2", { lf: 0, lt: 5 })).toBe(false);
  });

  it("nguồn chưa có góc nhìn (đang tải) → không đồng bộ", () => {
    L().setSync({ dateRange: true });
    const a = fake({ from: 0, to: 10 });
    const b = fake({ from: 0, to: 500 });
    a.range = null;
    reg("p1", a);
    reg("p2", b);
    syncRange("p1");
    expect(b.sets).toEqual([]);
  });

  it("đang đặt hộ thì sự kiện lồng nhau (đồng bộ) bị bỏ qua", () => {
    L().setSync({ dateRange: true });
    const a = fake({ from: 400, to: 1000 });
    const b = fake({ from: 0, to: 500 });
    const orig = b.setRange;
    b.setRange = (to, from) => {
      const r = orig(to, from);
      syncRange("p2"); // LWC bắn sự kiện ngay trong lúc đặt
      return r;
    };
    reg("p1", a);
    reg("p2", b);
    syncRange("p1");
    expect(a.sets).toEqual([]);
  });

  it("Crosshair: gửi cho chart khác, trừ chart đang có chuột; null thì xoá", () => {
    L().setSync({ crosshair: true });
    const a = fake({ from: 0, to: 10 });
    const b = fake({ from: 0, to: 10 });
    const c = fake({ from: 0, to: 10 });
    c.hover = true;
    reg("p1", a);
    reg("p2", b);
    reg("p3", c);
    syncCrosshair("p1", 300);
    syncCrosshair("p1", null);
    expect(a.cross).toEqual([]);
    expect(b.cross).toEqual([300, null]);
    expect(c.cross).toEqual([]);
  });

  it("hủy đăng ký: chart không còn nhận", () => {
    L().setSync({ crosshair: true });
    const a = fake({ from: 0, to: 10 });
    const b = fake({ from: 0, to: 10 });
    reg("p1", a);
    const off = registerPaneView("p2", b);
    off();
    syncCrosshair("p1", 5);
    expect(b.cross).toEqual([]);
  });
});
