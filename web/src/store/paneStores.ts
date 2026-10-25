// State của MỘT chart (pane). Mỗi pane có bộ store riêng (createPane); phần dùng chung toàn app (theme, symbols,
// công cụ vẽ, Settings...) vẫn ở các store toàn cục. Không import facade nào ở đây để tránh vòng phụ thuộc:
// store/chart.ts, indicators/store.ts... import file này, không phải ngược lại.
import type { DrawingManager } from "@/drawings/manager";
import type { SettingsTab } from "@/drawings/tools";
import type { Drawing } from "@/drawings/types";
import type { Visibility } from "@/drawings/visibility";
import { byId } from "@/indicators/catalog";
import { newInstance, type IndicatorInstance } from "@/indicators/instance";
import { reslot, stepPane } from "@/indicators/layout";
import { createStore, type StoreApi } from "zustand/vanilla";

export type ChartType = "candles" | "bars" | "line" | "area" | "heikin";
export type ScaleMode = "normal" | "log" | "percent";

export type ChartPane = { symbol: string; tf: string; chartType: ChartType; scaleMode: ScaleMode };

export type { IndicatorInstance };

export type IndicatorPatch = Partial<Omit<IndicatorInstance, "uid" | "id" | "v">>;

export type IndicatorsPane = {
  list: IndicatorInstance[];
  collapsed: boolean; // nút chevron trên legend: ẩn/hiện các hàng indicator (như TV)
  settingsUid: string | null; // indicator đang mở dialog Settings (trạng thái chạy, không lưu)
  setCollapsed: (v: boolean) => void;
  add: (id: string) => void;
  remove: (uid: string) => void;
  /** Gỡ nhiều indicator một lần (nút "Delete pane": cả pane). */
  removeMany: (uids: string[]) => void;
  /** Số pane riêng nằm TRÊN pane chính (0 = pane chính trên cùng). Trạng thái chạy, không lưu. */
  mainSlot: number;
  /** Đổi chỗ pane `key` (hoặc pane chính nếu key = "main") với pane liền trên / dưới. */
  movePane: (key: string, dir: -1 | 1) => void;
  /** Đổi field của 1 instance; field có giá trị `undefined` thì bị bỏ (về mặc định). */
  update: (uid: string, patch: IndicatorPatch) => void;
  /** Thay nguyên instance (Cancel / Reset trong Settings). */
  replace: (inst: IndicatorInstance) => void;
  openSettings: (uid: string) => void;
  closeSettings: () => void;
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
  settingsTab: SettingsTab | null; // tab mở sẵn khi vào Settings (double-click hình có tab Text -> Text); null = tab đầu tiên
  editing: { id: string; isNew: boolean; cell?: [number, number]; label?: boolean } | null; // đang sửa text inline trên chart (cell: ô của Table; label: gõ ngay trên nhãn "+ Add text" của đường / hộp)
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
    settingsUid: null,
    mainSlot: 0,
    movePane: (key, dir) => set((s) => stepPane(s.list, byId, s.mainSlot, key, dir)),
    // đổi danh sách = có thể gỡ / gộp pane: giữ pane chính ở đúng chỗ so với các pane còn lại (reslot)
    add: (defId) => set((s) => ({ list: [...s.list, newInstance(defId)] })),
    remove: (uid) =>
      set((s) => {
        const list = s.list.filter((x) => x.uid !== uid);
        return { list, mainSlot: reslot(s.list, list, byId, s.mainSlot), settingsUid: s.settingsUid === uid ? null : s.settingsUid };
      }),
    removeMany: (uids) =>
      set((s) => {
        const list = s.list.filter((x) => !uids.includes(x.uid));
        return { list, mainSlot: reslot(s.list, list, byId, s.mainSlot), settingsUid: s.settingsUid && uids.includes(s.settingsUid) ? null : s.settingsUid };
      }),
    update: (uid, patch) =>
      set((s) => {
        const list = s.list.map((x) => {
          if (x.uid !== uid) return x;
          const next = { ...x, ...patch };
          for (const k of Object.keys(patch) as (keyof IndicatorPatch)[]) if (patch[k] === undefined) delete next[k];
          return next;
        });
        return { list, mainSlot: reslot(s.list, list, byId, s.mainSlot) };
      }),
    replace: (inst) =>
      set((s) => {
        const list = s.list.map((x) => (x.uid === inst.uid ? inst : x));
        return { list, mainSlot: reslot(s.list, list, byId, s.mainSlot) };
      }),
    openSettings: (uid) => set({ settingsUid: uid }),
    closeSettings: () => set({ settingsUid: null }),
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
    settingsTab: null,
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
    p.indicators.setState({ list: init.indicators ?? [], collapsed: init.legendCollapsed ?? false, settingsUid: null, mainSlot: 0 });
  if (init.volume) p.volume.setState({ s: { ...DEFAULT_VOLUME, ...init.volume } });
}
