import { useSyncExternalStore } from "react";

// Bố cục theo LOẠI MÁY + bề rộng màn (docs/mobile-responsive-plan.md mục 3; user 10-29: "check theo platform + screen width cho rõ").
// Trước đây đoán bằng `pointer: coarse` + chiều cao: iPad mini dọc (744px) thành phone, iPad Pro ngang (1366px) thành desktop.
export type LayoutMode = "phone" | "tablet" | "desktop";
export type Platform = "phone" | "tablet" | "desktop";
// Máy tính: mốc theo bề rộng cửa sổ, trùng breakpoint md / xl mặc định của Tailwind
export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1280;
// Điện thoại / máy tính bảng: cửa sổ hẹp hơn ngần này (iPad Slide Over / Split View hẹp) dùng khung phone; điện thoại mà cạnh ngắn từ ngần này
// trở lên (máy gập mở ra) dùng khung tablet. Điện thoại thường (cạnh ngắn 360–430) luôn là phone, kể cả xoay ngang.
export const COMPACT_MAX = 660; // thanh trên của tablet cần ~650px (đo headless: 600px tràn, 678px vừa)

export function layoutModeFor(width: number, height = Infinity, platform: Platform = "desktop"): LayoutMode {
  if (platform === "phone") return Math.min(width, height) < COMPACT_MAX ? "phone" : "tablet";
  if (platform === "tablet") return width < COMPACT_MAX ? "phone" : "tablet"; // máy tính bảng không bao giờ là desktop: không chuột, không hover
  if (width < TABLET_MIN) return "phone";
  if (width < DESKTOP_MIN) return "tablet";
  return "desktop";
}

/** Loại máy theo user agent, không đổi trong phiên. iPadOS Safari tự xưng là Mac: nhận ra bằng màn cảm ứng nhiều điểm.
 *  Android: điện thoại có "Mobile" trong UA, máy tính bảng thì không. */
export function platformOf(ua: string, maxTouchPoints = 0, uaMobile?: boolean): Platform {
  if (uaMobile || /iPhone|iPod|Windows Phone|Android.*Mobile|Mobile.*Firefox/i.test(ua)) return "phone";
  if (/iPad|Android|Tablet|Silk|Kindle|PlayBook/i.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1)) return "tablet";
  return "desktop";
}
let platformCache: Platform | null = null;
const platformNow = (): Platform => {
  if (platformCache) return platformCache;
  if (typeof navigator === "undefined" || typeof navigator.userAgent !== "string") return "desktop";
  const uaData = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  return (platformCache = platformOf(navigator.userAgent, navigator.maxTouchPoints ?? 0, uaData?.mobile));
};

// Con trỏ chính là ngón tay (điện thoại / máy tính bảng). Tách khỏi bề rộng: iPad dùng bút hay laptop cảm ứng vẫn
// theo đúng loại con trỏ chính của nó.
const TOUCH_QUERY = "(pointer: coarse)";
// Chỉ báo khi vượt mốc (không phải mỗi lần resize): media query đổi trạng thái đúng lúc innerWidth / innerHeight qua mốc.
const MODE_QUERIES = [`(min-width: ${COMPACT_MAX}px)`, `(min-height: ${COMPACT_MAX}px)`, `(min-width: ${TABLET_MIN}px)`, `(min-width: ${DESKTOP_MIN}px)`];
const LANDSCAPE_QUERY = "(orientation: landscape)";
const modeNow = (): LayoutMode | null =>
  typeof window !== "undefined" && typeof window.innerWidth === "number" ? layoutModeFor(window.innerWidth, window.innerHeight ?? Infinity, platformNow()) : null;
const currentMode = () => modeNow()!;

function subscribeQueries(queries: string[], onChange: () => void) {
  const lists = queries.map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener("change", onChange);
  return () => {
    for (const l of lists) l.removeEventListener("change", onChange);
  };
}

const subscribeMode = (onChange: () => void) => subscribeQueries(MODE_QUERIES, onChange);
const subscribeTouch = (onChange: () => void) => subscribeQueries([TOUCH_QUERY], onChange);
const subscribeLandscape = (onChange: () => void) => subscribeQueries([LANDSCAPE_QUERY], onChange);

/** Đang ở bố cục phone? Đọc ngay, cho code ngoài React (hàm xử lý lệnh). Server / test không có window = false. */
export const isPhoneNow = () => modeNow() === "phone";

/** Bảng đặt lệnh đang là sheet ở đáy chart (phone + tablet, MobileOrderSheet) chứ không phải panel bên phải của desktop: chạm nền chart huỷ nháp,
 *  đặt lệnh xong đóng hẳn bảng. Đọc ngay, cho code ngoài React. */
export const orderSheetNow = () => {
  const m = modeNow();
  return m !== null && m !== "desktop";
};

/** phone / tablet / desktop theo loại máy + kích thước màn hiện tại; cập nhật khi xoay máy hay kéo cửa sổ qua mốc. Server luôn là desktop. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribeMode, currentMode, () => "desktop");
}

/** Màn đang nằm ngang (rộng hơn cao): khung phone xoay ngang đổi tab bar thành cột dọc, bảng lệnh sang bên phải. */
export function useLandscape(): boolean {
  return useSyncExternalStore(subscribeLandscape, () => window.matchMedia(LANDSCAPE_QUERY).matches, () => false);
}

/** true khi con trỏ chính là cảm ứng: dùng để phóng to vùng chạm, hiện các nút vốn chỉ hiện khi hover. */
export function useTouch(): boolean {
  return useSyncExternalStore(subscribeTouch, () => window.matchMedia(TOUCH_QUERY).matches, () => false);
}

// Ngón tay che và rung nhiều hơn chuột: thao tác bằng cảm ứng (pointerType "touch") nới vùng bắt và ngưỡng "bấm hay kéo" thêm bấy nhiêu px.
// Theo từng sự kiện chứ không theo loại máy: iPad có chuột / bút vẫn giữ dung sai chính xác như desktop.
export const TOUCH_SLOP = 10;
export const isTouch = (e: Event): boolean => (e as PointerEvent).pointerType === "touch";

const stopTouchScroll = (e: TouchEvent) => {
  if (e.cancelable) e.preventDefault();
};
/** Đang kéo đường / hình bằng ngón tay: khoá pan của lightweight-charts (handleScroll: false) thì nó cũng thôi chặn cuộn trang ở touchmove,
 *  trình duyệt giành lấy cú chạm và bắn pointercancel giữa chừng. Chặn touchmove trên `el` cho tới khi gọi hàm trả về. */
export function holdTouch(el: HTMLElement): () => void {
  el.addEventListener("touchmove", stopTouchScroll, { passive: false, capture: true });
  return () => el.removeEventListener("touchmove", stopTouchScroll, { capture: true });
}

// Phần tử nhận pointerdown gần nhất (pha capture, trên cả trang)
let lastDown: EventTarget | null = null;
if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("pointerdown", (e) => (lastDown = e.target), true);
}
/** Nút đặt / xác nhận lệnh: chỉ nhận cú bấm BẮT ĐẦU trên chính nút. Vuốt bắt đầu chỗ khác rồi nhấc tay trên nút (vuốt thu bảng lệnh xuống: bảng co lại,
 *  nút đặt lệnh nằm ngay dưới ngón tay) trình duyệt vẫn có thể bắn click — đã từng đặt nhầm lệnh như vậy. Bàn phím (Enter / Space, detail = 0) không bị chặn.
 *  Trả false (và chặn mặc định, vd. submit form) nếu không phải cú bấm thật trên nút. */
export function startedOn(e: { detail: number; currentTarget: EventTarget; preventDefault: () => void }): boolean {
  const ok = e.detail === 0 || (lastDown !== null && (e.currentTarget as Node).contains(lastDown as Node));
  if (!ok) e.preventDefault();
  return ok;
}

/** Vùng bắt của vách ngăn pane trong lightweight-charts (div `row-resize` cao 9px, top -4px trong hàng cao 1px): ngón tay khó trúng. Màn cảm ứng nới thành
 *  29px quanh vạch (vạch vẫn 1px); hàng vách dựng lại mỗi khi thêm / bớt pane nên theo dõi `root` bằng MutationObserver. Trả hàm gỡ. */
export function widenPaneHandles(root: HTMLElement): () => void {
  const widen = () =>
    root.querySelectorAll<HTMLElement>("td[colspan='3'] > div").forEach((el) => {
      if (el.style.cursor !== "row-resize" || el.style.position !== "absolute" || el.style.height === "29px") return;
      el.style.top = "-14px";
      el.style.height = "29px";
    });
  widen();
  const mo = new MutationObserver(widen);
  mo.observe(root, { childList: true, subtree: true });
  return () => mo.disconnect();
}
