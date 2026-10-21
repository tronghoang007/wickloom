import { create } from "zustand";
import { persist } from "zustand/middleware";
import { byId } from "./registry";

export type IndicatorInstance = {
  uid: string;
  id: string;
  inputs: Record<string, number | string>;
  colors: string[];
};

type State = {
  list: IndicatorInstance[];
  favorites: string[];
  collapsed: boolean; // nút chevron trên legend: ẩn/hiện các hàng indicator (như TV)
  setCollapsed: (v: boolean) => void;
  add: (id: string) => void;
  remove: (uid: string) => void;
  update: (uid: string, patch: Partial<Pick<IndicatorInstance, "inputs" | "colors">>) => void;
  toggleFavorite: (id: string) => void;
};

export const useIndicatorStore = create<State>()(
  persist(
    (set) => ({
      list: [],
      favorites: ["sma", "ema", "wma", "macd", "rsi", "volume", "vwap"],
      collapsed: false,
      setCollapsed: (collapsed) => set({ collapsed }),
      add: (id) =>
        set((s) => {
          const def = byId(id);
          const inputs = Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
          return { list: [...s.list, { uid: crypto.randomUUID(), id, inputs, colors: [...def.colors] }] };
        }),
      remove: (uid) => set((s) => ({ list: s.list.filter((x) => x.uid !== uid) })),
      update: (uid, patch) => set((s) => ({ list: s.list.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) })),
      toggleFavorite: (id) =>
        set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })),
    }),
    { name: "tv-indicators" },
  ),
);
