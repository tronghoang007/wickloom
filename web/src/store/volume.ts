import type { UTCTimestamp } from "lightweight-charts";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { visibleOn, type Visibility } from "@/drawings/visibility";
import type { Bar } from "@/lib/api";
import type { ChartSettings } from "./settings";

// Volume là 1 indicator như TV ("Vol · Ticks"): có hàng legend, menu và Settings riêng.
// Màu `null` = theo màu nến tăng/giảm (40%), đúng như trước khi có Settings riêng.
export type VolumeSettings = {
  removed: boolean; // nút thùng rác: bỏ khỏi chart, thêm lại từ Indicators
  hidden: boolean; // nút mắt
  visibility?: Visibility; // hiện theo khung thời gian
  // Inputs
  maLength: number;
  colorByPrevClose: boolean;
  // Style
  show: boolean;
  growing: string | null;
  falling: string | null;
  maOn: boolean;
  maColor: string;
  precision: number | null; // null = mặc định (2 chữ số)
  priceLabel: boolean; // nhãn volume cuối trên trục giá
  statusValues: boolean;
  statusInputs: boolean;
};

export const DEFAULT_VOLUME: VolumeSettings = {
  removed: false,
  hidden: false,
  visibility: undefined,
  maLength: 20,
  colorByPrevClose: false,
  show: true,
  growing: null,
  falling: null,
  maOn: false,
  maColor: "#2962ff",
  precision: null,
  priceLabel: true,
  statusValues: true,
  statusInputs: true,
};

type State = {
  s: VolumeSettings;
  open: boolean; // dialog Settings
  set: (patch: Partial<VolumeSettings>) => void;
  replace: (s: VolumeSettings) => void;
};

export const useVolumeStore = create<State>()(
  persist(
    (set) => ({
      s: DEFAULT_VOLUME,
      open: false,
      set: (patch) => set((st) => ({ s: { ...st.s, ...patch } })),
      replace: (s) => set({ s }),
    }),
    {
      name: "tv-volume",
      partialize: (st) => ({ s: st.s }),
      // thêm field mới vào DEFAULT_VOLUME không làm mất setting đã lưu
      merge: (saved, cur) => ({ ...cur, s: { ...DEFAULT_VOLUME, ...(saved as Partial<State>)?.s } }),
    },
  ),
);

/** Cột volume tăng: so với giá mở (mặc định) hoặc giá đóng nến trước ("Color based on previous close"). */
export function volUp(b: Bar, prevC: number | undefined, v: VolumeSettings) {
  return v.colorByPrevClose && prevC !== undefined ? b.c >= prevC : b.c >= b.o;
}

/** Màu cột (có thể kèm alpha). Chưa chọn thì lấy màu nến 40%; màu nến có thể kèm alpha (#rrggbbaa). */
export function volColor(v: VolumeSettings, cs: ChartSettings, up: boolean) {
  return (up ? v.growing : v.falling) ?? `${(up ? cs.bodyUp : cs.bodyDown).slice(0, 7)}66`;
}

/** Histogram volume có đang hiện không (chưa gỡ, không ẩn, bật Volume, đúng khung thời gian). */
export const volShown = (v: VolumeSettings, tf: string) =>
  !v.removed && !v.hidden && v.show && visibleOn(v.visibility, tf);

/** Đường MA của volume có đang hiện không (độc lập với ô Volume, như TV). */
export const volMaShown = (v: VolumeSettings, tf: string) =>
  !v.removed && !v.hidden && v.maOn && visibleOn(v.visibility, tf);

/** Số chữ số của volume: "Default" là 2, như cách legend vẫn hiện từ trước. */
export const volDigits = (v: VolumeSettings) => v.precision ?? 2;

/** SMA của volume cho toàn bộ nến (bỏ n-1 nến đầu chưa đủ dữ liệu). */
export function volMaData(bars: Bar[], n: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].v;
    if (i >= n) sum -= bars[i - n].v;
    if (i >= n - 1) out.push({ time: bars[i].t as UTCTimestamp, value: sum / n });
  }
  return out;
}

/** SMA của volume tại nến `i` (null nếu chưa đủ n nến). */
export function volMaAt(bars: Bar[], i: number, n: number): number | null {
  if (i < n - 1 || !bars[i]) return null;
  let sum = 0;
  for (let j = i - n + 1; j <= i; j++) sum += bars[j].v;
  return sum / n;
}

/** Volume rút gọn như legend của TV: 1.05 K, 2.31 M. */
export function fmtVol(v: number, digits = 2) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(digits)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(digits)} K`;
  return String(v);
}
