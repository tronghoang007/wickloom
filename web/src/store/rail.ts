import { create } from "zustand";

// Panel đang mở ở thanh bên phải (watchlist / lịch kinh tế / bảng đặt lệnh). Đặt ngoài RightRail để bảng đặt lệnh tự mở thanh khi bấm SELL / BUY.
export type RailPanel = "watchlist" | "calendar" | "order";
type State = { open: RailPanel | null; setOpen: (p: RailPanel | null) => void };

export const useRailStore = create<State>()((set) => ({ open: null, setOpen: (open) => set({ open }) }));
