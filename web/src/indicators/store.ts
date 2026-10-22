import { composeStore } from "@/store/compose";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type { IndicatorInstance } from "@/store/paneStores";

// Danh sách indicator đang dùng + legend thu gọn là của TỪNG chart (store/paneStores.ts); ở đây chỉ còn "yêu thích".
type Global = {
  favorites: string[];
  toggleFavorite: (id: string) => void;
};

export const indicatorGlobal = create<Global>()(
  persist(
    (set): Global => ({
      favorites: ["sma", "ema", "wma", "macd", "rsi", "volume", "vwap"],
      toggleFavorite: (id) =>
        set((s) => ({ favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] })),
    }),
    {
      name: "tv-indicators", // key này từng chứa cả `list` của chart: chỉ nhận `favorites`
      partialize: (s) => ({ favorites: s.favorites }),
      merge: (saved, cur) => {
        const f = (saved as Partial<Global> | undefined)?.favorites;
        return { ...cur, ...(Array.isArray(f) ? { favorites: f } : {}) };
      },
    },
  ),
);

/** Cho UI ngoài chart: indicator của pane ĐANG ACTIVE + danh sách yêu thích chung. */
export const useIndicatorStore = composeStore({
  global: indicatorGlobal,
  pane: (p) => p.indicators,
  paneKeys: ["list", "collapsed"],
});
