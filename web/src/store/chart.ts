import type { SymbolInfo } from "@/lib/api";
import { DEFAULT_FAV_TFS } from "@/lib/timeframes";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { composeStore } from "./compose";
import type { ChartPane } from "./paneStores";

export type { ChartType, ScaleMode } from "./paneStores";

// Phần dùng chung toàn app. symbol / tf / chartType / scaleMode là của TỪNG chart (pane): xem store/paneStores.ts.
type Global = {
  favTfs: string[];
  theme: "dark" | "light";
  symbols: SymbolInfo[];
};

export const chartGlobal = create<Global>()(
  persist(
    (): Global => ({ favTfs: DEFAULT_FAV_TFS, theme: "dark", symbols: [] }),
    {
      name: "invest-chart-prefs",
      partialize: (state) => ({ favTfs: state.favTfs, theme: state.theme }),
      // key này từng chứa cả symbol/tf/chartType/scaleMode của chart: chỉ nhận phần của store này
      merge: (saved, cur) => {
        const s = (saved ?? {}) as Partial<Global>;
        return { ...cur, ...(s.favTfs ? { favTfs: s.favTfs } : {}), ...(s.theme ? { theme: s.theme } : {}) };
      },
      skipHydration: true,
    },
  ),
);

/** Cho UI ngoài chart (toolbar, tìm symbol...): global + chart của pane ĐANG ACTIVE. `set` chia patch theo khoá. */
export const useChartStore = composeStore({
  global: chartGlobal,
  pane: (p) => p.chart,
  paneKeys: ["symbol", "tf", "chartType", "scaleMode"],
  extra: (setState) => ({ set: (p: Partial<Global & ChartPane>) => setState(p) }),
});
