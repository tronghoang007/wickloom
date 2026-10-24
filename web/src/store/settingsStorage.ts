import { DEFAULT_SETTINGS, mergeSettings, useSettingsStore, type ChartSettings } from "./settings";

// Setting của chart nằm trong layout (store/layoutDoc.ts, như TradingView). Riêng KHÁCH không có layout trên server nên vẫn nhớ
// vào localStorage; key + định dạng giữ như zustand persist trước đây ({ state: { s }, version }) để không mất setting đã lưu.
export const SETTINGS_KEY = "tv-chart-settings";
const SETTINGS_VERSION = 3;

type KV = Pick<Storage, "getItem" | "setItem">;

/** Setting đã lưu của khách (cũng là điểm bắt đầu cho layout cũ chưa lưu setting), đã migrate; không có/hỏng → mặc định. */
export function loadSettings(kv: KV): ChartSettings {
  try {
    const raw = JSON.parse(kv.getItem(SETTINGS_KEY) ?? "null");
    const saved = raw?.state?.s as Partial<ChartSettings> | undefined;
    if (!saved || typeof saved !== "object") return DEFAULT_SETTINGS;
    const version = typeof raw.version === "number" ? raw.version : 0;
    // v0 lưu sẵn titleMode "name" (giá trị mặc định cũ) -> chuyển sang tên mô tả như mặc định mới
    // v1 lưu sẵn marginBottom 25 (mặc định cũ) -> 8 như TV; giá trị khác 25 là người dùng tự chỉnh nên giữ
    // v2 lưu sẵn bg #000000/#0f0f0f (nền dark, chọn tay trước khi thành mặc định) -> null: màu đó đè cả theme sáng làm chart sáng bị đen; màu khác là người dùng tự chọn nên giữ
    if (version < 1) saved.titleMode = "description";
    if (version < 2 && saved.marginBottom === 25) saved.marginBottom = 8;
    if (version < 3 && ["#000000", "#0f0f0f"].includes(saved.bg?.toLowerCase() ?? "")) saved.bg = null;
    return mergeSettings(saved);
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Chế độ khách: nạp setting đã lưu vào store rồi ghi lại mỗi khi nó đổi. Trả hàm gỡ. */
export function bindSettingsPersistence(kv: KV): () => void {
  const store = useSettingsStore;
  store.getState().replace(loadSettings(kv));
  const save = (s: ChartSettings) => {
    try {
      kv.setItem(SETTINGS_KEY, JSON.stringify({ state: { s }, version: SETTINGS_VERSION }));
    } catch {
      /* localStorage đầy/bị chặn: mất khả năng nhớ, chart vẫn chạy */
    }
  };
  save(store.getState().s); // ghi ngay lần đầu: bản đã migrate
  return store.subscribe((st, prev) => {
    if (st.s !== prev.s) save(st.s);
  });
}
