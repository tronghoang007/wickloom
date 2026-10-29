import { describe, expect, it, vi } from "vitest";
import { COMPACT_MAX, DESKTOP_MIN, TABLET_MIN, holdTouch, layoutModeFor, platformOf } from "./layoutMode";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD_AS_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID_PHONE = "Mozilla/5.0 (Linux; Android 14; SM-A556E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36";
const ANDROID_TAB = "Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

describe("platformOf", () => {
  it("nhận ra điện thoại, máy tính bảng (kể cả iPadOS tự xưng là Mac), máy tính", () => {
    expect(platformOf(IPHONE)).toBe("phone");
    expect(platformOf(ANDROID_PHONE)).toBe("phone");
    expect(platformOf(ANDROID_TAB)).toBe("tablet");
    expect(platformOf(IPAD_AS_MAC, 5)).toBe("tablet");
    expect(platformOf(IPAD_AS_MAC, 0)).toBe("desktop"); // Mac thật
    expect(platformOf(WIN)).toBe("desktop");
    expect(platformOf(WIN, 0, true)).toBe("phone"); // userAgentData.mobile
  });
});

describe("layoutModeFor", () => {
  it("máy tính: theo bề rộng cửa sổ (768 / 1280), cửa sổ thấp không đổi", () => {
    expect(layoutModeFor(390)).toBe("phone");
    expect(layoutModeFor(TABLET_MIN - 1)).toBe("phone");
    expect(layoutModeFor(TABLET_MIN)).toBe("tablet");
    expect(layoutModeFor(DESKTOP_MIN - 1)).toBe("tablet");
    expect(layoutModeFor(DESKTOP_MIN)).toBe("desktop");
    expect(layoutModeFor(1440, 450, "desktop")).toBe("desktop");
  });

  it("điện thoại: luôn phone, kể cả xoay ngang; máy gập mở ra là tablet", () => {
    expect(layoutModeFor(360, 740, "phone")).toBe("phone");
    expect(layoutModeFor(844, 390, "phone")).toBe("phone");
    expect(layoutModeFor(932, 430, "phone")).toBe("phone");
    expect(layoutModeFor(884, 1104, "phone")).toBe("tablet");
    expect(layoutModeFor(1024, 600, "phone")).toBe("phone");
  });

  it("máy tính bảng: luôn tablet (iPad mini dọc, iPad Pro ngang), chỉ cửa sổ hẹp (Slide Over / Split View) là phone", () => {
    expect(layoutModeFor(744, 1133, "tablet")).toBe("tablet");
    expect(layoutModeFor(1366, 1024, "tablet")).toBe("tablet");
    expect(layoutModeFor(COMPACT_MAX, 1024, "tablet")).toBe("tablet");
    expect(layoutModeFor(COMPACT_MAX - 1, 1024, "tablet")).toBe("phone");
    expect(layoutModeFor(320, 1024, "tablet")).toBe("phone");
  });

  it("mốc máy tính trùng breakpoint md / xl mặc định của Tailwind", () => {
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
