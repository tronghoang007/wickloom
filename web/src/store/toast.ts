import { create } from "zustand";

export type ToastItem = { id: number; text: string; action?: { label: string; run: () => void } };

type State = { items: ToastItem[]; dismiss: (id: number) => void };

export const useToastStore = create<State>()((set) => ({
  items: [],
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}));

let seq = 0;

/** Thông báo nhỏ góc dưới trái, tự tắt sau `ms`. */
export function toast(text: string, opts: { action?: ToastItem["action"]; ms?: number } = {}) {
  const id = ++seq;
  useToastStore.setState((s) => ({ items: [...s.items.slice(-2), { id, text, action: opts.action }] }));
  setTimeout(() => useToastStore.getState().dismiss(id), opts.ms ?? 4500);
}
