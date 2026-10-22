import { composeStore } from "@/store/compose";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_FAVORITES } from "./tools";
import type { Drawing, DrawingType } from "./types";

export type CursorMode = "cross" | "dot" | "arrow" | "eraser";
export type MagnetMode = "weak" | "strong"; // yếu: chỉ hút khi gần OHLC; mạnh: luôn hút

export type DrawingDefaults = Partial<Pick<Drawing, "color" | "width" | "dash" | "textColor" | "opts">>;

// Công cụ vẽ và tuỳ chọn dùng chung toàn app. Danh sách hình vẽ, hình đang chọn, hộp thoại, DrawingManager là của TỪNG
// chart (pane): xem DrawPane trong store/paneStores.ts.
export type DrawingGlobal = {
  tool: DrawingType | null;
  cursor: CursorMode;
  magnet: boolean;
  magnetMode: MagnetMode;
  stay: boolean; // giữ tool sau khi vẽ xong
  lockAll: boolean;
  hideAll: boolean;
  favorites: string[];
  showFavs: boolean;
  favoritesPos: { x: number; y: number };
  lastTool: Record<string, string>; // tool gần nhất của mỗi nhóm
  toolDefaults: Record<string, DrawingDefaults>; // lưu setting vẽ cho lần sau (như TradingView)
  setToolDefault: (type: string, defs: DrawingDefaults) => void;
  resetToolDefault: (type: string) => void;
};

export const drawingGlobal = create<DrawingGlobal>()(
  persist(
    (set): DrawingGlobal => ({
      tool: null,
      cursor: "cross",
      magnet: false,
      magnetMode: "weak",
      stay: false,
      lockAll: false,
      hideAll: false,
      favorites: DEFAULT_FAVORITES,
      showFavs: true,
      favoritesPos: { x: 0, y: 0 },
      lastTool: {},
      toolDefaults: {},
      setToolDefault: (type, defs) => {
        set((s) => ({
          toolDefaults: {
            ...s.toolDefaults,
            [type]: {
              ...s.toolDefaults[type],
              ...defs,
              opts: {
                ...(s.toolDefaults[type]?.opts ?? {}),
                ...(defs.opts ?? {}),
              },
            },
          },
        }));
      },
      resetToolDefault: (type) => {
        set((s) => {
          const next = { ...s.toolDefaults };
          delete next[type];
          return { toolDefaults: next };
        });
      },
    }),
    {
      name: "tv-drawing-prefs",
      partialize: (s) => ({
        favorites: s.favorites,
        showFavs: s.showFavs,
        favoritesPos: s.favoritesPos,
        magnet: s.magnet,
        magnetMode: s.magnetMode,
        stay: s.stay,
        lastTool: s.lastTool,
        cursor: s.cursor,
        toolDefaults: s.toolDefaults,
      }),
      skipHydration: true,
    },
  ),
);

/** Các khoá của `useDrawingStore` thuộc về từng pane (DrawPane); còn lại là chung toàn app. */
export const DRAW_PANE_KEYS = ["drawings", "selectedId", "settingsOpen", "editing", "api"] as const;

/** Cho UI ngoài chart: công cụ vẽ chung + hình vẽ / hình đang chọn / DrawingManager của pane ĐANG ACTIVE. */
export const useDrawingStore = composeStore({
  global: drawingGlobal,
  pane: (p) => p.draw,
  paneKeys: DRAW_PANE_KEYS,
});

export function toggleFavorite(id: string) {
  const { favorites } = useDrawingStore.getState();
  useDrawingStore.setState({ favorites: favorites.includes(id) ? favorites.filter((x) => x !== id) : [...favorites, id] });
}
