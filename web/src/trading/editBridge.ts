import { create } from "zustand";
import type { DragPreview } from "./format";

// Cầu nối giữa chart (nơi giữ các thay đổi SL/TP/giá vừa kéo, chờ xác nhận: chartOrders.ts) và bảng Modify ở thanh bên phải (OrderTicket). Mỗi chart (pane) báo các thay đổi đang chờ,
// gom theo chủ lệnh ("position:<ticket>" | "order:<ticket>"); bảng Modify đọc để hiện giá mới và gọi Modify / Discard, chart nào giữ thay đổi của chủ đó thì thực hiện.
type State = { byPane: Record<string, Record<string, DragPreview[]>>; setPane: (paneId: string, m: Record<string, DragPreview[]>) => void };

export const useEditBridge = create<State>()((set) => ({
  byPane: {},
  setPane: (paneId, m) => set((s) => ({ byPane: { ...s.byPane, [paneId]: m } })),
}));

type Handlers = { confirm: (owner: string) => void; cancel: (owner: string) => void };
const handlers = new Map<string, Handlers>();

export function registerEditHandlers(paneId: string, h: Handlers): () => void {
  handlers.set(paneId, h);
  return () => {
    if (handlers.get(paneId) === h) handlers.delete(paneId);
    useEditBridge.getState().setPane(paneId, {});
  };
}

export const confirmOwnerEdits = (owner: string) => handlers.forEach((h) => h.confirm(owner));
export const cancelOwnerEdits = (owner: string) => handlers.forEach((h) => h.cancel(owner));

/** Các thay đổi đang chờ của một lệnh, từ mọi chart. */
export function pendingFor(byPane: State["byPane"], owner: string): DragPreview[] {
  return Object.values(byPane).flatMap((m) => m[owner] ?? []);
}
