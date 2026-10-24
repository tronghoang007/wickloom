import { create } from "zustand";
import { persist } from "zustand/middleware";

// Chart settings (dialog "Settings" kiểu TradingView). Màu `null` = theo theme sáng/tối.
// Mặc định giữ đúng giao diện trước khi có dialog.
export type ChartSettings = {
  // Symbol
  colorByPrevClose: boolean;
  body: boolean;
  bodyUp: string;
  bodyDown: string;
  borders: boolean;
  borderUp: string;
  borderDown: string;
  wick: boolean;
  wickUp: string;
  wickDown: string;
  precision: number | null; // null = theo symbol
  timezone: string; // "local" | IANA, vd "Asia/Bangkok"
  // Status line
  showTitle: boolean;
  titleMode: "name" | "description";
  showChartValues: boolean;
  showBarChange: boolean;
  showVolume: boolean;
  showIndicatorTitles: boolean;
  showIndicatorInputs: boolean;
  // Scales and lines
  countdown: boolean;
  symbolLabel: "value_line" | "value" | "line" | "hidden";
  prevDayClose: "hidden" | "value_line";
  prevDayCloseColor: string;
  highLow: "hidden" | "value_line";
  highLowColor: string;
  bidAsk: "hidden" | "value_line";
  bidColor: string;
  askColor: string;
  dayOfWeek: boolean;
  dateFormat: DateFormat;
  hours: "24" | "12";
  // Canvas
  bgType: "solid" | "gradient";
  bg: string | null;
  bg2: string | null;
  vertGrid: boolean;
  horzGrid: boolean;
  gridColor: string | null;
  crosshairColor: string | null;
  scaleTextColor: string | null;
  fontSize: number;
  scaleLineColor: string | null;
  marginTop: number; // %
  marginBottom: number; // %
  rightOffset: number; // bar
  // Trading
  // One-click trading (như TradingView): tắt (mặc định) = đóng vị thế hỏi bằng hộp thoại, kéo SL/TP / lệnh chờ đã đặt dừng ở giá mới chờ bấm ✓ trên thẻ;
  // bật = làm ngay, không hỏi
  oneClick: boolean;
  // Events: biểu tượng sự kiện kinh tế (lịch MT5 qua EA) ngay trên chart, ở sát trục thời gian
  showEvents: boolean;
  eventsMinImportance: 1 | 2 | 3;
};

export const DATE_FORMATS = [
  "dd MMM 'yy",
  "dd MMM yyyy",
  "MMM dd, yyyy",
  "dd-MM-yyyy",
  "yyyy-MM-dd",
  "MM/dd/yy",
] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const UP = "#089981";
export const DOWN = "#f23645";

// Màu mặc định theo theme cho các setting màu đang để `null`.
export const CHART_THEMES = {
  dark: { bg: "#0f0f0f", text: "#b2b5be", grid: "#242424", label: "#363a45", crosshair: "#758696" },
  light: { bg: "#ffffff", text: "#131722", grid: "#f0f3fa", label: "#131722", crosshair: "#758696" },
};

export const DEFAULT_SETTINGS: ChartSettings = {
  colorByPrevClose: false,
  body: true,
  bodyUp: UP,
  bodyDown: DOWN,
  borders: true,
  borderUp: UP,
  borderDown: DOWN,
  wick: true,
  wickUp: UP,
  wickDown: DOWN,
  precision: null,
  timezone: "local",
  showTitle: true,
  titleMode: "description", // như TV: "Gold vs US Dollar", không phải mã broker
  showChartValues: true,
  showBarChange: true,
  showVolume: true,
  showIndicatorTitles: true,
  showIndicatorInputs: true,
  countdown: true,
  symbolLabel: "value_line",
  prevDayClose: "hidden",
  prevDayCloseColor: "#787b86",
  highLow: "hidden",
  highLowColor: "#787b86",
  bidAsk: "hidden",
  bidColor: "#2962ff",
  askColor: "#f23645",
  dayOfWeek: true,
  dateFormat: "dd MMM 'yy",
  hours: "24",
  bgType: "solid",
  bg: null,
  bg2: null,
  vertGrid: true,
  horzGrid: true,
  gridColor: null,
  crosshairColor: null,
  scaleTextColor: null,
  fontSize: 12,
  scaleLineColor: null,
  marginTop: 8,
  marginBottom: 25,
  rightOffset: 8,
  oneClick: false,
  showEvents: true,
  eventsMinImportance: 2,
};

/** Setting đã lưu + mặc định cho field mới. `confirmClose` (bản thử trước, đã gộp vào One-click trading): ai đã tắt xác nhận đóng thì giữ ý đó. */
export function mergeSettings(saved: (Partial<ChartSettings> & { confirmClose?: boolean }) | undefined): ChartSettings {
  const legacy = saved && saved.oneClick === undefined && saved.confirmClose === false ? { oneClick: true } : {};
  return { ...DEFAULT_SETTINGS, ...saved, ...legacy };
}

type State = {
  s: ChartSettings;
  open: boolean;
  set: (patch: Partial<ChartSettings>) => void;
  replace: (s: ChartSettings) => void;
};

export const useSettingsStore = create<State>()(
  persist(
    (set) => ({
      s: DEFAULT_SETTINGS,
      open: false,
      set: (patch) => set((st) => ({ s: { ...st.s, ...patch } })),
      replace: (s) => set({ s }),
    }),
    {
      name: "tv-chart-settings",
      version: 1,
      // v0 lưu sẵn titleMode "name" (giá trị mặc định cũ) -> chuyển sang tên mô tả như mặc định mới
      migrate: (saved, version) => {
        const st = saved as { s?: Partial<ChartSettings> };
        if (version < 1 && st?.s) st.s.titleMode = "description";
        return st as State;
      },
      partialize: (st) => ({ s: st.s }),
      // thêm field mới vào DEFAULT_SETTINGS không làm mất setting đã lưu
      merge: (saved, cur) => ({ ...cur, s: mergeSettings((saved as { s?: Partial<ChartSettings> })?.s) }),
    },
  ),
);
