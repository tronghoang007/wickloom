import { create } from "zustand";

export type ToastKind = "success" | "error" | "info";
export type ToastItem = { id: number; text: string; kind: ToastKind; title?: string; action?: { label: string; run: () => void } };

type State = { items: ToastItem[]; dismiss: (id: number) => void };

export const useToastStore = create<State>()((set) => ({
  items: [],
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

let seq = 0;

/** Thông báo nhỏ góc dưới trái (như TradingView), tự tắt sau `ms`. `title` = dòng đậm phía trên `text`; `kind` chọn biểu tượng (mặc định info). */
export function toast(text: string, opts: { action?: ToastItem["action"]; ms?: number; title?: string; kind?: ToastKind } = {}) {
  const id = ++seq;
  useToastStore.setState((s) => ({ items: [...s.items.slice(-2), { id, text, kind: opts.kind ?? "info", title: opts.title, action: opts.action }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), opts.ms ?? 4500);
}
