// State của MỘT chart (pane). Mỗi pane có bộ store riêng (createPane); phần dùng chung toàn app (theme, symbols,
// công cụ vẽ, Settings...) vẫn ở các store toàn cục. Không import facade nào ở đây để tránh vòng phụ thuộc:
// store/chart.ts, indicators/store.ts... import file này, không phải ngược lại.
import type { DrawingManager } from "@/drawings/manager";
import type { Drawing } from "@/drawings/types";
import type { Visibility } from "@/drawings/visibility";
import { byId } from "@/indicators/registry";
import { createStore, type StoreApi } from "zustand/vanilla";

export type ChartType = "candles" | "bars" | "line" | "area" | "heikin";
export type ScaleMode = "normal" | "log" | "percent";

export type ChartPane = { symbol: string; tf: string; chartType: ChartType; scaleMode: ScaleMode };

export type IndicatorInstance = {
  uid: string;
  id: string;
  inputs: Record<string, number | string>;
  colors: string[];
};

export type IndicatorsPane = {
  list: IndicatorInstance[];
  collapsed: boolean; // nút chevron trên legend: ẩn/hiện các hàng indicator (như TV)
  setCollapsed: (v: boolean) => void;
  add: (id: string) => void;
  remove: (uid: string) => void;
  update: (uid: string, patch: Partial<Pick<IndicatorInstance, "inputs" | "colors">>) => void;
};

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

export type VolumePane = {
  s: VolumeSettings;
  open: boolean; // dialog Settings
  set: (patch: Partial<VolumeSettings>) => void;
  replace: (s: VolumeSettings) => void;
};

export type ReplayPane = {
  selecting: boolean; // đang chọn bar bắt đầu
  active: boolean; // đã vào chế độ replay
  playing: boolean;
  speed: string;
  interval: string; // "" = theo TF của chart
};

export type DrawPane = {
  drawings: Drawing[];
  selectedId: string | null;
  settingsOpen: boolean;
  editing: { id: string; isNew: boolean; cell?: [number, number] } | null; // đang sửa text inline trên chart (cell: ô của Table)
  api: DrawingManager | null;
};

export type Pane = {
  id: string;
  chart: StoreApi<ChartPane>;
  indicators: StoreApi<IndicatorsPane>;
  volume: StoreApi<VolumePane>;
  replay: StoreApi<ReplayPane>;
  draw: StoreApi<DrawPane>;
};

/** Giá trị khởi tạo / lưu của 1 pane (phần được lưu trong layout; replay/drawings/dialog là trạng thái chạy, không lưu). */
export type PaneInit = {
  chart?: Partial<ChartPane>;
  indicators?: IndicatorInstance[];
  legendCollapsed?: boolean;
  volume?: Partial<VolumeSettings>;
};

export const DEFAULT_CHART: ChartPane = { symbol: "XAUUSDm", tf: "M5", chartType: "candles", scaleMode: "normal" };

export function createPane(id: string, init: PaneInit = {}): Pane {
  const chart = createStore<ChartPane>()(() => ({ ...DEFAULT_CHART, ...init.chart }));

  const indicators = createStore<IndicatorsPane>()((set) => ({
    list: init.indicators ?? [],
    collapsed: init.legendCollapsed ?? false,
    setCollapsed: (collapsed) => set({ collapsed }),
    add: (defId) =>
      set((s) => {
        const def = byId(defId);
        const inputs = Object.fromEntries(def.inputs.map((i) => [i.key, i.default]));
        return { list: [...s.list, { uid: crypto.randomUUID(), id: defId, inputs, colors: [...def.colors] }] };
      }),
    remove: (uid) => set((s) => ({ list: s.list.filter((x) => x.uid !== uid) })),
    update: (uid, patch) => set((s) => ({ list: s.list.map((x) => (x.uid === uid ? { ...x, ...patch } : x)) })),
  }));

  const volume = createStore<VolumePane>()((set) => ({
    s: { ...DEFAULT_VOLUME, ...init.volume },
    open: false,
    set: (patch) => set((st) => ({ s: { ...st.s, ...patch } })),
    replace: (s) => set({ s }),
  }));

  const replay = createStore<ReplayPane>()(() => ({
    selecting: false,
    active: false,
    playing: false,
    speed: "1x",
    interval: "",
  }));

  const draw = createStore<DrawPane>()(() => ({
    drawings: [],
    selectedId: null,
    settingsOpen: false,
    editing: null,
    api: null,
  }));

  return { id, chart, indicators, volume, replay, draw };
}

/** Phần của pane được lưu (layout / localStorage). */
export function snapshotPane(p: Pane): Required<PaneInit> & { chart: ChartPane } {
  const ind = p.indicators.getState();
  return {
    chart: { ...p.chart.getState() },
    indicators: ind.list,
    legendCollapsed: ind.collapsed,
    volume: p.volume.getState().s,
  };
}

/** Nạp giá trị đã lưu vào pane có sẵn (giữ nguyên store, các component đang nghe vẫn nhận cập nhật). */
export function applyPaneInit(p: Pane, init: PaneInit) {
  if (init.chart) p.chart.setState({ ...DEFAULT_CHART, ...init.chart });
  if (init.indicators || init.legendCollapsed !== undefined)
    p.indicators.setState({ list: init.indicators ?? [], collapsed: init.legendCollapsed ?? false });
  if (init.volume) p.volume.setState({ s: { ...DEFAULT_VOLUME, ...init.volume } });
}
