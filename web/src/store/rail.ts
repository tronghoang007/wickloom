import { create } from "zustand";

// Panel đang mở ở thanh bên phải (watchlist / alert / lịch kinh tế / bảng đặt lệnh). Đặt ngoài RightRail để bảng đặt lệnh tự mở thanh khi bấm SELL / BUY.
// "trading" (vị thế / lệnh chờ / lịch sử), "objects" (chọn công cụ vẽ) và "account" (tài khoản) chỉ có trên phone; RightRail không có tab của chúng nên bỏ qua.
export type RailPanel = "watchlist" | "alerts" | "calendar" | "order" | "trading" | "objects" | "account";
type State = {
  open: RailPanel | null;
  setOpen: (p: RailPanel | null) => void;
  /** Panel đang mở trước khi bảng đặt lệnh chiếm chỗ (null = thanh đang đóng): đặt xong / huỷ bản nháp thì trả lại đúng nó. */
  before: RailPanel | null;
  openOrder: () => void;
  closeOrder: () => void;
  /** Phone: bảng đặt lệnh (sheet kiểu MT5) đang mở rộng cho bảng có `id` này của useTicketStore. Bảng mới (id khác) thì hiện thu gọn trước, như MT5. */
  sheetExpandedFor: number | null;
  /** Phone dọc: mép trên (toạ độ viewport, px) của bảng đặt lệnh đang nổi đè lên đáy chart, null = không có. Khung giá chừa phần bị che (Chart.tsx). */
  sheetTop: number | null;
  /** Phone: bộ chọn khung đang mở — vòng kiểu MT5 (TimeframeRing; mở bằng nút khung hoặc chạm nền chart) hay lưới đủ khung (nút ⋯ của vòng). */
  tfPicker: "ring" | "grid" | null;
  /** Chỗ chạm chart (toạ độ viewport) mở vòng: tâm vòng đặt ở đó; null = giữa màn (mở bằng nút khung). */
  ringAt: { x: number; y: number } | null;
};

export const useRailStore = create<State>()((set, get) => ({
  open: null,
  setOpen: (open) => set({ open }),
  before: null,
  sheetExpandedFor: null,
  sheetTop: null,
  tfPicker: null,
  ringAt: null,
  openOrder: () => {
    const { open, before } = get();
    set({ open: "order", before: open === "order" ? before : open });
  },
  // Đang xem bảng đặt lệnh thì quay về panel trước đó; người dùng đã tự chuyển sang panel khác trong lúc soạn thì giữ nguyên.
  closeOrder: () => {
    const { open, before } = get();
    set(open === "order" ? { open: before, before: null } : { before: null });
  },
}));
