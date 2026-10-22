import { create } from "zustand";

// Lệnh (vị thế / lệnh chờ / bản nháp) đang được "focus" trên chart: khi có nhiều lệnh, bấm vào thẻ hoặc đường của một lệnh để thấy SL/TP nào là của lệnh đó, các lệnh khác mờ đi.
// `owner` = "position:<ticket>" | "order:<ticket>" | "draft" (cùng khoá với nhóm thẻ trong TradeOverlay). Không còn trên chart (đã đóng / huỷ) thì coi như không focus gì.
export const useTradeFocus = create<{ owner: string | null; set: (owner: string | null) => void }>()((set) => ({ owner: null, set: (owner) => set({ owner }) }));

/** Màu `#rrggbb` + độ đục (0-1) → `#rrggbbaa`; màu khác dạng thì giữ nguyên. */
export function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  return color + Math.round(Math.max(0, Math.min(1, alpha)) * 255).toString(16).padStart(2, "0");
}
