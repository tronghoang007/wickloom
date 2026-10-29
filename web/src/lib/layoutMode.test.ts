import { describe, expect, it, vi } from "vitest";
import { DESKTOP_MIN, TABLET_MIN, holdTouch, layoutModeFor } from "./layoutMode";

describe("layoutModeFor", () => {
  it("điện thoại dọc / ngang nhỏ là phone", () => {
    expect(layoutModeFor(320)).toBe("phone");
    expect(layoutModeFor(390)).toBe("phone");
    expect(layoutModeFor(TABLET_MIN - 1)).toBe("phone");
  });

  it("từ 768px đến dưới 1280px là tablet", () => {
    expect(layoutModeFor(TABLET_MIN)).toBe("tablet");
    expect(layoutModeFor(1024)).toBe("tablet");
    expect(layoutModeFor(DESKTOP_MIN - 1)).toBe("tablet");
  });

  it("từ 1280px trở lên là desktop", () => {
    expect(layoutModeFor(DESKTOP_MIN)).toBe("desktop");
    expect(layoutModeFor(1440)).toBe("desktop");
  });

  it("mốc trùng breakpoint md / xl mặc định của Tailwind", () => {
    expect(TABLET_MIN).toBe(768);
    expect(DESKTOP_MIN).toBe(1280);
  });
});

describe("holdTouch", () => {
  it("chặn cuộn trang ở touchmove trong lúc giữ, thả thì thôi", () => {
    const ls = new Map<string, (e: TouchEvent) => void>();
    const el = {
      addEventListener: (t: string, f: (e: TouchEvent) => void, o: AddEventListenerOptions) => {
        expect(o).toMatchObject({ passive: false, capture: true }); // passive thì preventDefault không có tác dụng
        ls.set(t, f);
      },
      removeEventListener: (t: string) => ls.delete(t),
    } as unknown as HTMLElement;
    const release = holdTouch(el);
    const e = { cancelable: true, preventDefault: vi.fn() } as unknown as TouchEvent;
    ls.get("touchmove")!(e);
    expect(e.preventDefault).toHaveBeenCalled();
    release();
    expect(ls.has("touchmove")).toBe(false);
  });
});

describe("startedOn: nút đặt lệnh chỉ nhận cú bấm bắt đầu trên chính nó", () => {
  async function load() {
    vi.resetModules();
    let onDown: ((e: { target: unknown }) => void) | null = null;
    vi.stubGlobal("window", { addEventListener: (t: string, f: (e: { target: unknown }) => void) => t === "pointerdown" && (onDown = f) });
    const mod = await import("./layoutMode");
    return { startedOn: mod.startedOn, down: (target: unknown) => onDown!({ target }) };
  }
  const button = { contains: (n: unknown) => n === button || n === label };
  const label = {};
  const handle = {};
  const click = (detail = 1) => ({ detail, currentTarget: button as unknown as EventTarget, preventDefault: vi.fn() });

  it("nhấn xuống trên nút (hoặc phần tử con) rồi nhả: nhận", async () => {
    const { startedOn, down } = await load();
    down(label);
    expect(startedOn(click())).toBe(true);
    vi.unstubAllGlobals();
  });

  it("vuốt bắt đầu ở thanh nắm, nhấc tay trên nút: chặn và preventDefault (không submit form)", async () => {
    const { startedOn, down } = await load();
    down(handle);
    const e = click();
    expect(startedOn(e)).toBe(false);
    expect(e.preventDefault).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("bàn phím (detail = 0) luôn nhận", async () => {
    const { startedOn, down } = await load();
    down(handle);
    expect(startedOn(click(0))).toBe(true);
    vi.unstubAllGlobals();
  });
});
