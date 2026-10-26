import { create } from "zustand";

// Panel đang mở ở thanh bên phải (watchlist / alert / lịch kinh tế / bảng đặt lệnh). Đặt ngoài RightRail để bảng đặt lệnh tự mở thanh khi bấm SELL / BUY.
export type RailPanel = "watchlist" | "alerts" | "calendar" | "order";
type State = {
  open: RailPanel | null;
  setOpen: (p: RailPanel | null) => void;
  /** Panel đang mở trước khi bảng đặt lệnh chiếm chỗ (null = thanh đang đóng): đặt xong / huỷ bản nháp thì trả lại đúng nó. */
  before: RailPanel | null;
  openOrder: () => void;
  closeOrder: () => void;
};

export const useRailStore = create<State>()((set, get) => ({
  open: null,
  setOpen: (open) => set({ open }),
  before: null,
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
