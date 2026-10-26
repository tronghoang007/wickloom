import {
  createAlert,
  deleteAlert,
  fetchAlertLog,
  fetchChannels,
  listAlerts,
  patchAlert,
  type Alert,
  type AlertChannels,
  type AlertInput,
  type AlertLogRow,
  type AlertPatch,
  type ChannelsInfo,
  type DeliveryResults,
  type Result,
} from "@/lib/alertsApi";
import { useAuthStore } from "@/store/auth";
import { chartGlobal, useChartStore } from "@/store/chart";
import { useSettingsStore } from "@/store/settings";
import { useQuoteStore } from "@/trading/quote";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export type AlertSound = "chime" | "beep" | "alarm" | "off";

/** Tuỳ chọn của riêng máy này (âm thanh, thông báo của trình duyệt, kênh mặc định khi tạo alert mới). */
export type AlertPrefs = {
  sound: AlertSound;
  desktop: boolean; // đã bật Notification của trình duyệt (quyền được xin lúc bật, không xin khi mở app)
  channels: AlertChannels;
  set: (p: Partial<Omit<AlertPrefs, "set">>) => void;
};

export const useAlertPrefs = create<AlertPrefs>()(
  persist(
    (set) => ({ sound: "chime", desktop: false, channels: { web: true, telegram: false, mt5: false }, set: (p) => set(p) }),
    { name: "wickloom-alert-prefs", partialize: (s) => ({ sound: s.sound, desktop: s.desktop, channels: s.channels }) },
  ),
);

type State = {
  alerts: Alert[];
  loaded: boolean;
  error: string | null;
  log: AlertLogRow[];
  logLoaded: boolean;
  channels: ChannelsInfo | null;
  refresh: () => Promise<void>;
  refreshLog: () => Promise<void>;
  refreshChannels: () => Promise<void>;
  create: (input: AlertInput) => Promise<Result<Alert>>;
  update: (id: string, patch: AlertPatch, optimistic?: Partial<Alert>) => Promise<Result<Alert>>;
  remove: (id: string) => Promise<Result<unknown>>;
  /** Một alert vừa nổ (tin `alert_fired` của backend): cập nhật trạng thái và thêm dòng nhật ký. */
  applyFired: (a: Alert, logId: number, price: number, time: number) => void;
  /** Kết quả giao từng kênh của một dòng nhật ký (tin `alert_delivery`). */
  applyDelivery: (logId: number, results: DeliveryResults) => void;
  reset: () => void;
};

const replace = (list: Alert[], a: Alert) => (list.some((x) => x.id === a.id) ? list.map((x) => (x.id === a.id ? a : x)) : [a, ...list]);

export const useAlertStore = create<State>()((set, get) => ({
  alerts: [],
  loaded: false,
  error: null,
  log: [],
  logLoaded: false,
  channels: null,

  refresh: async () => {
    const r = await listAlerts();
    if (r.ok) set({ alerts: r.data, loaded: true, error: null });
    else set({ error: r.error });
  },
  refreshLog: async () => {
    const r = await fetchAlertLog();
    if (r.ok) set({ log: r.data, logLoaded: true });
  },
  refreshChannels: async () => {
    const r = await fetchChannels();
    if (r.ok) set({ channels: r.data });
  },

  create: async (input) => {
    const r = await createAlert(input);
    if (r.ok) set((s) => ({ alerts: replace(s.alerts, r.data) }));
    return r;
  },
  update: async (id, patch, optimistic) => {
    const before = get().alerts.find((a) => a.id === id);
    if (optimistic && before) set((s) => ({ alerts: replace(s.alerts, { ...before, ...optimistic }) }));
    const r = await patchAlert(id, patch);
    if (r.ok) set((s) => ({ alerts: replace(s.alerts, r.data) }));
    else if (before) set((s) => ({ alerts: replace(s.alerts, before) })); // thất bại: trả về như cũ (đường trên chart nhảy lại chỗ cũ)
    return r;
  },
  remove: async (id) => {
    const r = await deleteAlert(id);
    if (r.ok) set((s) => ({ alerts: s.alerts.filter((a) => a.id !== id) }));
    return r;
  },

  applyFired: (a, logId, price, time) =>
    set((s) => ({
      alerts: replace(s.alerts, a),
      log: s.logLoaded && !s.log.some((l) => l.id === logId)
        ? [{ id: logId, alert_id: a.id, time, symbol: a.symbol, name: a.name, message: a.message, cond: a.cond, level: a.level, price, results: {} }, ...s.log]
        : s.log,
    })),
  applyDelivery: (logId, results) => set((s) => ({ log: s.log.map((l) => (l.id === logId ? { ...l, results } : l)) })),
  reset: () => set({ alerts: [], loaded: false, error: null, log: [], logLoaded: false, channels: null }),
}));

// --- hộp thoại tạo / sửa alert ----------------------------------------------------------------------------------------------------------------------------------

export type AlertSeed = { symbol: string; price: number | null; tf: string };
type DialogState = {
  seed: AlertSeed | null; // đang mở để tạo mới
  editing: Alert | null; // đang mở để sửa
  close: () => void;
};
export const useAlertDialog = create<DialogState>()((set) => ({ seed: null, editing: null, close: () => set({ seed: null, editing: null }) }));

/** Số chữ số thập phân của symbol (5 khi chưa biết). */
export const digitsOf = (symbol: string) => chartGlobal.getState().symbols.find((s) => s.name === symbol)?.digits ?? 5;

/** Giá hiện tại của symbol (bid từ tick realtime), null khi chưa có tick. */
export const lastPrice = (symbol: string): number | null => useQuoteStore.getState().quotes[symbol]?.bid ?? null;

/** Mở hộp thoại tạo alert (cần đăng nhập). Không truyền gì = symbol của chart đang active tại giá hiện tại. */
export async function openCreateAlert(seed?: Partial<AlertSeed>): Promise<void> {
  if (!(await useAuthStore.getState().requireLogin("Đăng nhập để tạo alert"))) return;
  const c = useChartStore.getState();
  const symbol = seed?.symbol ?? c.symbol;
  useAlertDialog.setState({ editing: null, seed: { symbol, price: seed && "price" in seed ? (seed.price ?? null) : lastPrice(symbol), tf: seed?.tf ?? c.tf } });
  void useAlertStore.getState().refreshChannels();
}

export function openEditAlert(a: Alert): void {
  useAlertDialog.setState({ seed: null, editing: a });
  void useAlertStore.getState().refreshChannels();
}

/** Mở Settings thẳng ở tab Alerts. */
export const useSettingsTab = create<{ tick: number }>()(() => ({ tick: 0 }));
export function openAlertSettings(): void {
  useSettingsTab.setState((s) => ({ tick: s.tick + 1 }));
  useSettingsStore.setState({ open: true });
}
