import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { hitLine, LineDrag, type DragTarget } from "./lineDrag";
import { TOUCH_SLOP } from "@/lib/layoutMode";

describe("hitLine", () => {
  const lines = [{ id: "o:1", y: 100 }, { id: "d:sl", y: 140 }];
  it("trong ngưỡng thì trúng đường đó", () => {
    expect(hitLine(100, lines)).toBe("o:1");
    expect(hitLine(104, lines)).toBe("o:1");
    expect(hitLine(136, lines)).toBe("d:sl");
  });
  it("ngoài ngưỡng thì không trúng gì", () => {
    expect(hitLine(120, lines)).toBeNull();
    expect(hitLine(107, lines, 6)).toBeNull();
    expect(hitLine(50, [])).toBeNull();
  });
  it("hai đường sát nhau: lấy đường gần con trỏ hơn", () => {
    const close = [{ id: "a", y: 100 }, { id: "b", y: 108 }];
    expect(hitLine(103, close)).toBe("a");
    expect(hitLine(105, close)).toBe("b");
  });
  it("ngưỡng tuỳ chỉnh", () => {
    expect(hitLine(110, lines, 12)).toBe("o:1");
  });
});

// Dựng LineDrag trên DOM giả: giá = toạ độ y (priceToCoordinate là hàm đồng nhất), chart rộng 1000px
describe("đường chỉ-bấm (fixed)", () => {
  class FakeEl {
    constructor(private tag: string | null = null, private key: string | null = null) {}
    closest(sel: string) {
      if (sel === "[data-tag-btn]") return null;
      if (sel === "[data-line-key]") return this.key ? { getAttribute: () => this.key } : null;
      if (sel === "[data-tag]") return this.tag ? this : null;
      return null;
    }
  }
  type Ev = { button: number; clientX: number; clientY: number; pointerId: number; target: FakeEl; preventDefault: () => void; stopPropagation: () => void };
  let handlers: Record<string, (e: never) => void>;
  let winHandlers: Record<string, (e: never) => void>;
  let targets: DragTarget[];
  let onAbort: Mock<(id: string, from: number, click: boolean) => void>;
  let onMove: Mock<(id: string, price: number) => void>;
  let onHover: Mock<(id: string | null) => void>;
  let cursor: { cursor: string };
  let prevented: number;
  let drag: LineDrag;
  const canvas = new FakeEl();
  const ev = (y: number, target: FakeEl = canvas, x = 100): Ev => ({ button: 0, clientX: x, clientY: y, pointerId: 1, target, preventDefault: () => prevented++, stopPropagation: () => prevented++ });

  beforeEach(() => {
    handlers = {};
    winHandlers = {};
    prevented = 0;
    cursor = { cursor: "" };
    targets = [{ id: "p:1", price: 200, fixed: true }, { id: "o:2", price: 300 }];
    onAbort = vi.fn();
    onMove = vi.fn();
    onHover = vi.fn();
    vi.stubGlobal("Element", FakeEl);
    vi.stubGlobal("window", { addEventListener: (t: string, f: (e: never) => void) => (winHandlers[t] = f), removeEventListener: vi.fn() });
    drag = new LineDrag({
      chart: { timeScale: () => ({ width: () => 1000 }), options: () => ({ handleScroll: true, handleScale: true }), applyOptions: vi.fn() } as never,
      container: { contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0 }), style: cursor, setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() } as never,
      listenOn: { addEventListener: (t: string, f: (e: never) => void) => (handlers[t] = f), removeEventListener: vi.fn() } as never,
      getSeries: () => ({ priceToCoordinate: (p: number) => p, coordinateToPrice: (y: number) => y }) as never,
      getTargets: () => targets,
      digits: () => 0,
      tickSize: () => 1,
      onMove,
      onDrop: vi.fn(),
      onHover,
      onAbort,
    });
  });
  afterEach(() => {
    drag.destroy();
    vi.unstubAllGlobals();
  });

  it("nhấn rồi thả không dời trên đường fixed = bấm (chọn), mà không chặn sự kiện của chart", () => {
    handlers.pointerdown(ev(202) as never);
    expect(prevented).toBe(0); // chart vẫn nhận cú nhấn
    winHandlers.pointerup(ev(202) as never);
    expect(onAbort).toHaveBeenCalledWith("p:1", 200, true);
    expect(drag.consumeTap()).toBe(true);
    expect(drag.consumeTap()).toBe(false); // chỉ đọc được một lần
  });

  it("kéo ra khỏi chỗ bấm là kéo chart, không chọn lệnh", () => {
    handlers.pointerdown(ev(202) as never);
    winHandlers.pointerup(ev(202, canvas, 160) as never); // dời ngang 60px
    expect(onAbort).not.toHaveBeenCalled();
    expect(drag.consumeTap()).toBe(false);
  });

  it("đường fixed không bao giờ báo kéo (onMove)", () => {
    handlers.pointerdown(ev(200) as never);
    handlers.pointermove(ev(260) as never);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("đường kéo được vẫn chặn sự kiện và kéo như cũ", () => {
    handlers.pointerdown(ev(301) as never);
    expect(prevented).toBeGreaterThan(0);
    handlers.pointermove(ev(340) as never);
    expect(onMove).toHaveBeenCalledWith("o:2", 340);
  });

  it("bấm (không kéo) đường kéo được: chọn lệnh và nuốt cú click chart ngay sau (cảm ứng: LWC vẫn báo click)", () => {
    handlers.pointerdown(ev(301) as never);
    winHandlers.pointerup(ev(301) as never);
    expect(onAbort).toHaveBeenCalledWith("o:2", 300, true);
    expect(drag.consumeTap()).toBe(true);
    expect(drag.consumeTap()).toBe(false);
  });

  it("kéo đường kéo được rồi thả: không phải bấm", () => {
    handlers.pointerdown(ev(301) as never);
    handlers.pointermove(ev(340) as never);
    winHandlers.pointerup(ev(340) as never);
    expect(drag.consumeTap()).toBe(false);
  });

  it("trỏ vào đường fixed: con trỏ bàn tay và báo hover; đường kéo được là mũi tên lên xuống", () => {
    handlers.pointermove(ev(203) as never);
    expect(cursor.cursor).toBe("pointer");
    expect(onHover).toHaveBeenLastCalledWith("p:1");
    handlers.pointermove(ev(299) as never);
    expect(cursor.cursor).toBe("ns-resize");
    handlers.pointermove(ev(500) as never);
    expect(cursor.cursor).toBe("");
  });

  it("nhấn xuống chỗ khác sau đó xoá dấu 'vừa bấm' (click nền kế tiếp phải bỏ chọn)", () => {
    handlers.pointerdown(ev(200) as never);
    winHandlers.pointerup(ev(200) as never);
    handlers.pointerdown(ev(500) as never);
    expect(drag.consumeTap()).toBe(false);
  });

  it("nhấn vào thẻ của đường fixed thì để thẻ tự chọn (không chọn hai lần)", () => {
    handlers.pointerdown(ev(200, new FakeEl("p:1", "p:1")) as never);
    winHandlers.pointerup(ev(200, new FakeEl("p:1", "p:1")) as never);
    expect(onAbort).not.toHaveBeenCalled();
    // thẻ không có data-line-key (chỉ xem) cũng vậy: không rơi xuống dò đường theo toạ độ y
    handlers.pointerdown(ev(200, new FakeEl("p:1", null)) as never);
    winHandlers.pointerup(ev(200, new FakeEl("p:1", null)) as never);
    expect(onAbort).not.toHaveBeenCalled();
  });

  it("hai đường fixed sát nhau: bấm đường nào chọn đường đó", () => {
    targets = [{ id: "p:1", price: 200, fixed: true }, { id: "p:2", price: 208, fixed: true }];
    handlers.pointerdown(ev(207) as never);
    winHandlers.pointerup(ev(207) as never);
    expect(onAbort).toHaveBeenCalledWith("p:2", 208, true);
  });

  const touchEv = (y: number, x = 100) => ({ ...ev(y, canvas, x), pointerType: "touch" });

  it("touchedLine: nhấn trúng đường thì đúng trong ít lâu sau, nhấn nền thì không", () => {
    expect(drag.touchedLine()).toBe(false);
    handlers.pointerdown(touchEv(500) as never); // nền
    expect(drag.touchedLine()).toBe(false);
    handlers.pointerdown(touchEv(305) as never); // đường kéo được
    expect(drag.touchedLine()).toBe(true);
    expect(drag.touchedLine(-1)).toBe(false); // hết hạn
    winHandlers.pointerup(touchEv(305) as never); // nhả tay
    handlers.pointerdown(touchEv(500) as never); // chạm nền ngay sau: không còn tính là chạm đường
    expect(drag.touchedLine()).toBe(false);
  });

  it("ngón tay: chạm lệch 12px vẫn trúng đường (chuột thì không)", () => {
    handlers.pointerdown(ev(212) as never);
    winHandlers.pointerup(ev(212) as never);
    expect(onAbort).not.toHaveBeenCalled();
    handlers.pointerdown(touchEv(212) as never);
    winHandlers.pointerup(touchEv(212) as never);
    expect(onAbort).toHaveBeenCalledWith("p:1", 200, true);
  });

  it("ngón tay rung 8px khi chạm đường kéo được: vẫn là bấm, không dời giá", () => {
    handlers.pointerdown(touchEv(301) as never);
    handlers.pointermove(touchEv(309) as never);
    expect(onMove).not.toHaveBeenCalled();
    handlers.pointermove(touchEv(330) as never); // kéo thật
    expect(onMove).toHaveBeenCalledWith("o:2", 330);
  });
});

describe("hitLine: dung sai theo loại con trỏ", () => {
  it("ngón tay (6 + TOUCH_SLOP) bắt được đường mà chuột (6) bỏ qua", () => {
    const lines = [{ id: "sl", y: 200 }];
    expect(hitLine(212, lines)).toBeNull();
    expect(hitLine(212, lines, 6 + TOUCH_SLOP)).toBe("sl");
  });
});
