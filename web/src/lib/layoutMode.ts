import { useSyncExternalStore } from "react";

// Bố cục theo bề rộng màn hình (docs/mobile-responsive-plan.md mục 3). Mốc trùng breakpoint mặc định của Tailwind
// (md = 768px, xl = 1280px) để phần chỉ cần CSS dùng thẳng `md:` / `xl:` mà vẫn khớp với hook này.
export type LayoutMode = "phone" | "tablet" | "desktop";
export const TABLET_MIN = 768;
export const DESKTOP_MIN = 1280;

export function layoutModeFor(width: number): LayoutMode {
  if (width < TABLET_MIN) return "phone";
  if (width < DESKTOP_MIN) return "tablet";
  return "desktop";
}

// Chỉ báo khi vượt mốc (không phải mỗi lần resize): media query đổi trạng thái đúng lúc innerWidth qua mốc.
const MODE_QUERIES = [`(min-width: ${TABLET_MIN}px)`, `(min-width: ${DESKTOP_MIN}px)`];
// Con trỏ chính là ngón tay (điện thoại / máy tính bảng). Tách khỏi bề rộng: iPad dùng bút hay laptop cảm ứng vẫn
// theo đúng loại con trỏ chính của nó.
const TOUCH_QUERY = "(pointer: coarse)";

function subscribeQueries(queries: string[], onChange: () => void) {
  const lists = queries.map((q) => window.matchMedia(q));
  for (const l of lists) l.addEventListener("change", onChange);
  return () => {
    for (const l of lists) l.removeEventListener("change", onChange);
  };
}

const subscribeMode = (onChange: () => void) => subscribeQueries(MODE_QUERIES, onChange);
const subscribeTouch = (onChange: () => void) => subscribeQueries([TOUCH_QUERY], onChange);

/** phone / tablet / desktop theo bề rộng hiện tại; cập nhật khi xoay máy hay kéo cửa sổ qua mốc. Server luôn là desktop. */
export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribeMode, () => layoutModeFor(window.innerWidth), () => "desktop");
}

/** true khi con trỏ chính là cảm ứng: dùng để phóng to vùng chạm, hiện các nút vốn chỉ hiện khi hover. */
export function useTouch(): boolean {
  return useSyncExternalStore(subscribeTouch, () => window.matchMedia(TOUCH_QUERY).matches, () => false);
}

// Ngón tay che và rung nhiều hơn chuột: thao tác bằng cảm ứng (pointerType "touch") nới vùng bắt và ngưỡng "bấm hay kéo" thêm bấy nhiêu px.
// Theo từng sự kiện chứ không theo loại máy: iPad có chuột / bút vẫn giữ dung sai chính xác như desktop.
export const TOUCH_SLOP = 10;
export const isTouch = (e: Event): boolean => (e as PointerEvent).pointerType === "touch";
