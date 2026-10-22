import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PRIMARY_PANE_ID, allPanes, getPane, useLayoutStore } from "./layout";
import { paneIds, paneRects } from "./layoutTree";
import { DEFAULT_CHART } from "./paneStores";

const L = () => useLayoutStore.getState();
const p1 = () => getPane(PRIMARY_PANE_ID);

beforeEach(() => {
  L().setTemplate("s");
  p1().chart.setState({ symbol: "XAUUSDm", tf: "M15", chartType: "heikin", scaleMode: "log" });
  p1().indicators.getState().add("sma");
});
afterEach(() => {
  L().setActive(PRIMARY_PANE_ID);
  L().setTemplate("s");
  p1().chart.setState(DEFAULT_CHART);
  p1().indicators.setState({ list: [] });
});

describe("setTemplate", () => {
  it("1 → 2×2: thêm 3 pane, nhân bản symbol/khung/loại nến của pane active (không kèm indicator, scaleMode)", () => {
    L().setTemplate("4");
    expect(L().order).toEqual(["p1", "p2", "p3", "p4"]);
    expect(paneIds(L().tree)).toEqual(L().order);
    expect(L().templateId).toBe("4");
    for (const id of ["p2", "p3", "p4"]) {
      expect(getPane(id).chart.getState()).toEqual({ symbol: "XAUUSDm", tf: "M15", chartType: "heikin", scaleMode: "normal" });
      expect(getPane(id).indicators.getState().list).toEqual([]);
    }
    expect(p1().indicators.getState().list).toHaveLength(1); // pane cũ không bị đụng
    expect(allPanes().map((p) => p.id)).toEqual(L().order);
  });

  it("pane mới lấy từ pane ACTIVE, không phải pane đầu", () => {
    L().setTemplate("2h");
    getPane("p2").chart.setState({ symbol: "EURUSD", tf: "H1" });
    L().setActive("p2");
    L().setTemplate("3h");
    expect(getPane("p3").chart.getState()).toMatchObject({ symbol: "EURUSD", tf: "H1" });
  });

  it("giảm số ô: bỏ các ô cuối; active bị bỏ thì về ô đầu; maximized bị xoá", () => {
    L().setTemplate("4");
    L().setActive("p4");
    L().setMaximized("p3");
    L().setTemplate("2h");
    expect(L().order).toEqual(["p1", "p2"]);
    expect(Object.keys(L().panes).sort()).toEqual(["p1", "p2"]);
    expect(L().activeId).toBe("p1");
    expect(L().maximized).toBeNull();
  });

  it("cùng số ô: giữ pane và state, chỉ đổi cây", () => {
    L().setTemplate("3h");
    const before = { ...L().panes };
    getPane("p2").chart.setState({ symbol: "GBPUSD" });
    L().setTemplate("3s");
    expect(L().panes.p1).toBe(before.p1);
    expect(L().panes.p2).toBe(before.p2);
    expect(getPane("p2").chart.getState().symbol).toBe("GBPUSD");
    expect(paneRects(L().tree).p1).toEqual({ x: 0, y: 0, w: 0.5, h: 1 });
  });

  it("cùng mẫu hoặc mẫu lạ thì không làm gì (giữ nguyên tham chiếu, kể cả kích thước đã kéo)", () => {
    L().setTemplate("2h");
    L().resizeAt([], [0.3, 0.7]);
    const tree = L().tree;
    L().setTemplate("2h");
    L().setTemplate("khong-co");
    expect(L().tree).toBe(tree);
    expect(L().templateId).toBe("2h");
  });

  it("pane bị bỏ thoát Replay của nó", () => {
    L().setTemplate("2h");
    const gone = getPane("p2");
    gone.replay.setState({ active: true, playing: true });
    L().setTemplate("s");
    expect(gone.replay.getState()).toMatchObject({ active: false, playing: false });
  });
});

describe("setActive", () => {
  it("rời chart đang Replay thì thoát Replay của chart đó; chart đích không bị đụng", () => {
    L().setTemplate("2h");
    p1().replay.setState({ active: true, playing: true });
    getPane("p2").replay.setState({ selecting: true });
    L().setActive("p2");
    expect(p1().replay.getState()).toMatchObject({ active: false, playing: false, selecting: false });
    expect(getPane("p2").replay.getState().selecting).toBe(true);
  });

  it("chọn lại pane đang active không làm gì (không thoát Replay)", () => {
    p1().replay.setState({ active: true });
    L().setActive(PRIMARY_PANE_ID);
    expect(p1().replay.getState().active).toBe(true);
    p1().replay.setState({ active: false });
  });
});

describe("resize + maximize", () => {
  it("resizeAt đổi tỉ lệ nhóm đúng đường dẫn, pane khác giữ nguyên tham chiếu", () => {
    L().setTemplate("3s");
    const left = L().panes.p1;
    L().resizeAt([1], [0.25, 0.75]);
    const r = paneRects(L().tree);
    expect(r.p2).toEqual({ x: 0.5, y: 0, w: 0.5, h: 0.25 });
    expect(r.p3).toEqual({ x: 0.5, y: 0.25, w: 0.5, h: 0.75 });
    expect(r.p1.w).toBe(0.5);
    expect(L().panes.p1).toBe(left);
  });

  it("maximize chỉ nhận pane tồn tại; null để về lưới", () => {
    L().setTemplate("2h");
    L().setMaximized("p2");
    expect(L().maximized).toBe("p2");
    L().setMaximized("p9");
    expect(L().maximized).toBeNull();
    L().setMaximized("p1");
    L().setMaximized(null);
    expect(L().maximized).toBeNull();
  });

  it("đổi mẫu thì thoát maximize", () => {
    L().setTemplate("2h");
    L().setMaximized("p1");
    L().setTemplate("2v");
    expect(L().maximized).toBeNull();
  });
});
