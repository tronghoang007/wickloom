import type { Bar } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useLayoutStore } from "@/store/layout";
import { createPane, type Pane } from "@/store/paneStores";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeAllDocs } from "./doc";
import { guestDocs } from "./guest";
import { DrawingManager } from "./manager";
import { drawingGlobal } from "./store";
import type { Drawing } from "./types";

// Chart giả: 1 nến = 10px theo trục thời gian (tính từ mép trái vùng vẽ), giá tuyến tính (y = 400 - price) hoặc log.
const H1 = 3600, T0 = 1_700_000_000;
const BARS: Bar[] = Array.from({ length: 100 }, (_, i) => ({ t: T0 + i * H1, o: 100, h: 101, l: 99, c: 100, v: 1 }) as Bar);
type Handler = (e: never) => void;

function harness() {
  const env = { left: 0, log: false };
  const on: Record<string, Handler> = {};
  const win: Record<string, Handler> = {};
  vi.stubGlobal("window", {
    addEventListener: (t: string, f: Handler) => { win[t] = f; },
    removeEventListener: (t: string) => { delete win[t]; },
  });
  const Y = (p: number) => (env.log ? 400 - 100 * Math.log10(p) : 400 - p);
  const P = (y: number) => (env.log ? 10 ** ((400 - y) / 100) : 400 - y);
  const redraw = vi.fn();
  const series = {
    attachPrimitive: (p: { attached: (x: unknown) => void }) => p.attached({ requestUpdate: redraw }),
    detachPrimitive: () => {},
    priceToCoordinate: Y,
    coordinateToPrice: P,
    priceScale: () => ({ options: () => ({ mode: env.log ? 1 : 0 }) }),
    getPane: () => ({ getHTMLElement: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0 }) }), paneIndex: () => 0 }),
  };
  const chart = {
    timeScale: () => ({
      coordinateToLogical: (x: number) => x / 10,
      logicalToCoordinate: (l: number) => l * 10,
      width: () => 800,
      getVisibleLogicalRange: () => ({ from: 0, to: 80 }),
    }),
    priceScale: (id: string) => ({ width: () => (id === "left" ? env.left : 60) }),
    options: () => ({ handleScroll: true, handleScale: true, layout: { fontSize: 12, fontFamily: "x" } }),
    applyOptions: () => {},
    paneSize: () => ({ height: 400 }),
  };
  const container = {
    addEventListener: (t: string, f: Handler) => { on[t] = f; },
    removeEventListener: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
    style: {} as Record<string, string>,
  };
  const pane: Pane = createPane("p1", { chart: { symbol: "XAU", tf: "H1" } });
  useLayoutStore.setState({ activeId: "p1" });
  const m = new DrawingManager({
    pane,
    chart: chart as never,
    container: container as never,
    getBars: () => BARS,
    getTf: () => "H1",
    getDigits: () => 2,
    getTickSize: () => 0.01,
  });
  m.attachTo(series as never);
  const ev = (x: number, y: number, type = "pointerdown", pointerType = "mouse") =>
    ({ button: 0, clientX: x, clientY: y, type, pointerType, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }) as never;
  const down = (x: number, y: number) => on.pointerdown(ev(x, y));
  const move = (x: number, y: number) => on.pointermove(ev(x, y, "pointermove"));
  const up = (x: number, y: number) => win.pointerup(ev(x, y, "pointerup"));
  // ngón tay (pointerType "touch")
  const tdown = (x: number, y: number) => on.pointerdown(ev(x, y, "pointerdown", "touch"));
  const tmove = (x: number, y: number) => on.pointermove(ev(x, y, "pointermove", "touch"));
  const tup = (x: number, y: number) => win.pointerup(ev(x, y, "pointerup", "touch"));
  const key = (k: string, mod = false) =>
    win.keydown({ key: k, metaKey: mod, ctrlKey: false, shiftKey: false, target: { tagName: "DIV" }, preventDefault() {} } as never);
  const drawings = () => pane.draw.getState().drawings as Drawing[];
  const doc = () => (m as unknown as { doc: { gen: number; committed(): Drawing[]; undoStack: string[]; loaded(items: unknown[]): void } }).doc;
  return { m, env, pane, down, move, up, tdown, tmove, tup, key, drawings, doc, redraw };
}

beforeEach(() => {
  vi.useFakeTimers();
  useAuthStore.setState({ status: "guest", user: null });
  drawingGlobal.setState({ tool: null, magnet: false, stay: false, lockAll: false, hideAll: false, toolDefaults: {} });
});
afterEach(() => {
  closeAllDocs();
  guestDocs.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  useAuthStore.setState({ status: "loading", user: null });
});

async function ready(h: ReturnType<typeof harness>) {
  h.m.setSymbol("XAU");
  await vi.advanceTimersByTimeAsync(0);
}

// Kẻ trendline từ nến i0 giá p0 tới nến i1 giá p1 (toạ độ trong vùng vẽ + lề trái)
function trend(h: ReturnType<typeof harness>, [i0, p0]: [number, number], [i1, p1]: [number, number], left = 0) {
  h.m.setTool("trendline");
  h.down(left + i0 * 10, 400 - p0);
  h.up(left + i0 * 10, 400 - p0);
  h.down(left + i1 * 10, 400 - p1);
  h.up(left + i1 * 10, 400 - p1);
}

describe("toạ độ chuột theo vùng vẽ (lỗi: trục giá trái)", () => {
  it("có trục giá trái 50px: điểm đặt đúng nến dưới con trỏ, hover / chọn trúng hình", async () => {
    const h = harness();
    await ready(h);
    h.env.left = 50;
    trend(h, [10, 100], [20, 150], 50);
    const d = h.drawings()[0];
    expect(d.points.map((p) => (p.time - T0) / H1)).toEqual([10, 20]); // trước đây lệch 5 nến sang trái
    expect(d.points.map((p) => p.price)).toEqual([100, 150]);
    h.m.select(null);
    h.down(50 + 150, 400 - 125); // giữa đoạn thẳng
    expect(h.pane.draw.getState().selectedId).toBe(d.id);
  });
});

describe("chạm bằng ngón tay", () => {
  it("chạm lệch 12px khỏi đường vẫn chọn được hình (chuột thì không)", async () => {
    const h = harness();
    await ready(h);
    trend(h, [10, 100], [20, 100]); // đường ngang y = 300
    const d = h.drawings()[0];
    h.m.select(null);
    h.down(150, 312);
    h.up(150, 312);
    expect(h.pane.draw.getState().selectedId).toBeNull();
    h.tdown(150, 312);
    h.tup(150, 312);
    expect(h.pane.draw.getState().selectedId).toBe(d.id);
  });

  it("tay rung khi chạm chọn hình không xê dịch hình; kéo thật thì dời", async () => {
    const h = harness();
    await ready(h);
    trend(h, [10, 100], [20, 100]);
    const before = h.drawings()[0].points.map((p) => p.price);
    h.tdown(150, 300);
    h.tmove(153, 304);
    h.tup(153, 304);
    expect(h.drawings()[0].points.map((p) => p.price)).toEqual(before);
    h.tdown(150, 300);
    h.tmove(150, 330);
    h.tup(150, 330);
    expect(h.drawings()[0].points.map((p) => p.price)).toEqual([70, 70]);
  });
});

describe("undo khi bản server về giữa lúc kéo", () => {
  it("không đưa ảnh chụp thiếu hình server vào undo", async () => {
    const h = harness();
    await ready(h);
    trend(h, [10, 100], [20, 150]);
    const mine = h.drawings()[0];
    h.down(150, 400 - 125); // nhấn vào hình: chụp `before`
    h.doc().loaded([{ ...mine, id: "server" }]); // bản server về lúc đang kéo
    h.move(200, 400 - 125);
    h.up(200, 400 - 125);
    h.key("z", true); // undo
    expect(h.drawings().map((x) => x.id)).toContain("server");
  });
});

describe("Settings đang mở", () => {
  it("Del / ⌘Z không tác động hình phía sau; Esc chỉ đóng hộp", async () => {
    const h = harness();
    await ready(h);
    trend(h, [10, 100], [20, 150]);
    const id = h.drawings()[0].id;
    h.pane.draw.setState({ settingsOpen: true });
    h.key("Delete");
    h.key("z", true);
    expect(h.drawings().map((x) => x.id)).toEqual([id]);
    h.key("Escape");
    expect(h.pane.draw.getState().settingsOpen).toBe(false);
    expect(h.pane.draw.getState().selectedId).toBe(id);
  });

  it("bản xem trước không vào bản lưu / undo; Ok ghi đúng một bước undo", async () => {
    const h = harness();
    await ready(h);
    trend(h, [10, 100], [20, 150]);
    const orig = h.drawings()[0];
    const undo0 = h.doc().undoStack.length;
    h.m.preview({ ...orig, color: "#ff0000" });
    expect(h.drawings()[0].color).toBe("#ff0000");
    expect(h.doc().committed()[0].color).toBe(orig.color);
    h.m.preview(structuredClone(orig)); // Cancel
    expect(h.doc().committed()[0]).toBe(h.drawings()[0]);
    h.m.preview({ ...orig, color: "#00ff00" });
    h.m.replaceSelected({ ...orig, color: "#00ff00" }, orig);
    expect(h.doc().undoStack.length).toBe(undo0 + 1);
    h.key("z", true);
    expect(h.drawings()[0].color).toBe(orig.color);
  });
});

describe("kéo bảng màu", () => {
  it("cả lần kéo là một bước undo, một lần lưu mặc định", async () => {
    const h = harness();
    await ready(h);
    trend(h, [10, 100], [20, 150]);
    const orig = h.drawings()[0].color;
    const undo0 = h.doc().undoStack.length;
    const setDefault = vi.spyOn(drawingGlobal.getState(), "setToolDefault");
    for (const c of ["#100000", "#200000", "#300000"]) h.m.update({ color: c }, true);
    expect(h.drawings()[0].color).toBe("#300000"); // xem trước ngay
    expect(h.doc().undoStack.length).toBe(undo0);
    expect(h.doc().committed()[0].color).toBe(orig);
    h.m.update({ color: "#300000" }); // nhả chuột
    expect(h.doc().undoStack.length).toBe(undo0 + 1);
    expect(setDefault).toHaveBeenCalledTimes(1);
    h.key("z", true);
    expect(h.drawings()[0].color).toBe(orig);
  });
});

describe("kéo cả hình trên trục log", () => {
  it("giữ tỉ lệ giá giữa các điểm (hình không méo, không xuống ≤ 0)", async () => {
    const h = harness();
    await ready(h);
    h.env.log = true;
    h.m.setTool("trendline");
    const y = (p: number) => 400 - 100 * Math.log10(p);
    h.down(100, y(100)); h.up(100, y(100));
    h.down(200, y(400)); h.up(200, y(400));
    const mid = y(200); // log-giữa của 100 và 400
    h.down(150, mid);
    h.move(150, mid + 100 * Math.log10(4)); // kéo xuống đúng ×1/4
    h.up(150, mid + 100 * Math.log10(4));
    const [a, b] = h.drawings()[0].points.map((p) => p.price);
    expect(a).toBeCloseTo(25, 6); // trước đây: 100 - 150 = -50
    expect(b).toBeCloseTo(100, 6);
  });
});

describe("destroy", () => {
  it("dữ liệu về sau khi gỡ chart thì không vẽ / tải tiếp", async () => {
    const h = harness();
    await ready(h);
    h.m.destroy();
    h.redraw.mockClear();
    h.m.refresh();
    h.m.onTickDelta({ symbol: "XAU", bars: [BARS[99]], cells: [] });
    expect(h.redraw).not.toHaveBeenCalled();
  });
});
