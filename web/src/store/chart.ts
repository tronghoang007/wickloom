import type { SymbolInfo } from "@/lib/api";
import { DEFAULT_FAV_TFS } from "@/lib/timeframes";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ChartType = "candles" | "bars" | "line" | "area" | "heikin";
export type ScaleMode = "normal" | "log" | "percent";

type State = {
  symbol: string;
  tf: string;
  favTfs: string[];
  chartType: ChartType;
  scaleMode: ScaleMode;
  theme: "dark" | "light";
  symbols: SymbolInfo[];
  set: (p: Partial<Omit<State, "set">>) => void;
};

export const useChartStore = create<State>()(
  persist(
    (set) => ({
      symbol: "XAUUSDm",
      tf: "M5",
      favTfs: DEFAULT_FAV_TFS,
      chartType: "candles",
      scaleMode: "normal",
      theme: "dark",
      symbols: [],
      set: (p) => set(p),
    }),
    {
      name: "invest-chart-prefs",
      partialize: (state) => ({
        symbol: state.symbol,
        tf: state.tf,
        favTfs: state.favTfs,
        chartType: state.chartType,
        scaleMode: state.scaleMode,
        theme: state.theme,
      }),
      skipHydration: true,
    },
  ),
);
