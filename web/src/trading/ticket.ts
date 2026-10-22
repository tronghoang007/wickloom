import { create } from "zustand";
import type { Side } from "./orderType";

// Hộp thoại đặt lệnh chờ ("Add order on … at …" ở menu chuột phải). `seed` = ý định ban đầu; `id` đổi mỗi lần mở để form dựng lại từ đầu.
export type TicketSeed = { symbol: string; side: Side; price: number };
type State = { seed: TicketSeed | null; id: number; show: (s: TicketSeed) => void; close: () => void };

export const useTicketStore = create<State>()((set) => ({
  seed: null,
  id: 0,
  show: (seed) => set((s) => ({ seed, id: s.id + 1 })),
  close: () => set({ seed: null }),
}));
