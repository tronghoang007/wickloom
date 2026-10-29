import { useSyncExternalStore } from "react";

// Bố cục theo bề rộng màn hình (docs/mobile-responsive-plan.md mục 3). Mốc trùng breakpoint mặc định của Tailwind
// (md = 768px, xl = 1280px) để phần chỉ cần CSS dùng thẳng `md:` / `xl:` mà vẫn khớp với hook này.
export type LayoutMode = "phone" | "tablet" | "desktop";
export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1280;
// Màn cảm ứng thấp hơn ngần này (điện thoại xoay ngang: rộng 844 nhưng chỉ cao ~390) cũng dùng khung phone: khung desktop cao ~150px chrome là hết chỗ cho chart.
// Chỉ tính màn cảm ứng: cửa sổ desktop kéo thấp vẫn là desktop.
export const SHORT_MAX = 500;

export function layoutModeFor(width: number, height = Infinity, touch = false): LayoutMode {
  if (width < TABLET_MIN || (touch && height < SHORT_MAX)) return "phone";
  if (width < DESKTOP_MIN) return "tablet";
  return "desktop";
}

// Con trỏ chính là ngón tay (điện thoại / máy tính bảng). Tách khỏi bề rộng: iPad dùng bút hay laptop cảm ứng vẫn
// theo đúng loại con trỏ chính của nó.
const TOUCH_QUERY = "(pointer: coarse)";
// Chỉ báo khi vượt mốc (không phải mỗi lần resize): media query đổi trạng thái đúng lúc innerWidth / innerHeight qua mốc.
const MODE_QUERIES = [`(min-width: ${TABLET_MIN}px)`, `(min-width: ${DESKTOP_MIN}px)`, `(max-height: ${SHORT_MAX - 1}px)`, TOUCH_QUERY];
const LANDSCAPE_QUERY = "(orientation: landscape)";
const currentMode = () => layoutModeFor(window.innerWidth, window.innerHeight, window.matchMedia(TOUCH_QUERY).matches);

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
export const isPhoneNow = () =>
  typeof window !== "undefined" &&
  typeof window.innerWidth === "number" &&
  layoutModeFor(window.innerWidth, window.innerHeight ?? Infinity, typeof window.matchMedia === "function" && window.matchMedia(TOUCH_QUERY).matches) === "phone";

/** Bảng đặt lệnh đang là sheet ở đáy chart (phone + tablet, MobileOrderSheet) chứ không phải panel bên phải của desktop: chạm nền chart huỷ nháp,
 *  đặt lệnh xong đóng hẳn bảng. Đọc ngay, cho code ngoài React. */
export const orderSheetNow = () =>
  typeof window !== "undefined" &&
  typeof window.innerWidth === "number" &&
  layoutModeFor(window.innerWidth, window.innerHeight ?? Infinity, typeof window.matchMedia === "function" && window.matchMedia(TOUCH_QUERY).matches) !== "desktop";

/** phone / tablet / desktop theo bề rộng (và chiều cao với màn cảm ứng) hiện tại; cập nhật khi xoay máy hay kéo cửa sổ qua mốc. Server luôn là desktop. */
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
