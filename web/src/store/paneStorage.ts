import { migrateInstances } from "@/indicators/instance";
import { applyPaneInit, snapshotPane, type Pane, type PaneInit } from "./paneStores";

// Lưu pane chính vào localStorage cho tới khi layout có chỗ lưu riêng (layout-plan Phase 3).
// Trước đây state của chart nằm rải ở 3 key (invest-chart-prefs, tv-indicators, tv-volume): lần đầu chạy bản mới, đọc
// chúng sang key mới; key cũ không bị xoá để có thể quay lại bản trước (invest-chart-prefs và tv-indicators vẫn được
// ghi lại nhưng chỉ phần dùng chung: theme/favTfs, indicator yêu thích).
export const PANE_KEY = "wickloom-pane1";
const LEGACY = { prefs: "invest-chart-prefs", indicators: "tv-indicators", volume: "tv-volume" } as const;
const SAVE_DELAY = 300;

type KV = Pick<Storage, "getItem" | "setItem">;

const read = (kv: KV, key: string): Record<string, unknown> | null => {
  try {
    const raw = kv.getItem(key);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

const str = (v: unknown, ok: readonly string[] | null = null) =>
  typeof v === "string" && (!ok || ok.includes(v)) ? v : undefined;

/** Chỉ nhận các field đúng kiểu: dữ liệu lỗi/cũ không làm vỡ chart. */
export function parsePaneInit(raw: Record<string, unknown> | null): PaneInit {
  if (!raw) return {};
  const chart = (raw.chart ?? {}) as Record<string, unknown>;
  const out: PaneInit = {
    chart: {
      ...(str(chart.symbol) ? { symbol: str(chart.symbol) } : {}),
      ...(str(chart.tf) ? { tf: str(chart.tf) } : {}),
      ...(str(chart.chartType, ["candles", "bars", "line", "area", "heikin"])
        ? { chartType: str(chart.chartType) as never }
        : {}),
      ...(str(chart.scaleMode, ["normal", "log", "percent"]) ? { scaleMode: str(chart.scaleMode) as never } : {}),
    },
  };
  if (Array.isArray(raw.indicators)) out.indicators = migrateInstances(raw.indicators); // cả dạng cũ {uid,id,inputs,colors}
  if (typeof raw.legendCollapsed === "boolean") out.legendCollapsed = raw.legendCollapsed;
  if (raw.volume && typeof raw.volume === "object") out.volume = raw.volume as PaneInit["volume"];
  return out;
}

const fromLegacy = (kv: KV): PaneInit | null => {
  const prefs = read(kv, LEGACY.prefs)?.state as Record<string, unknown> | undefined;
  const ind = read(kv, LEGACY.indicators)?.state as Record<string, unknown> | undefined;
  const vol = read(kv, LEGACY.volume)?.state as Record<string, unknown> | undefined;
  if (!prefs && !ind && !vol) return null;
  return parsePaneInit({
    chart: prefs,
    indicators: ind?.list,
    legendCollapsed: ind?.collapsed,
    volume: vol?.s,
  });
};

/** Giá trị đã lưu của pane chính: key mới, nếu chưa có thì migrate từ key cũ, không có gì thì {}. */
export function loadPaneInit(kv: KV): PaneInit {
  const saved = read(kv, PANE_KEY);
  if (saved) return parsePaneInit(saved);
  return fromLegacy(kv) ?? {};
}

/** Nạp state đã lưu vào `pane` rồi tự lưu mỗi khi nó đổi (chỉ phần của layout: symbol/tf/loại nến/thang giá, indicator,
 *  volume). Trả hàm gỡ (đồng thời lưu nốt phần đang chờ). `onUnload` để cắm sự kiện đóng tab (pagehide). */
export function bindPanePersistence(
  pane: Pane,
  kv: KV,
  opts: {
    /** Đã đọc từ `loadPaneInit(kv)` — đọc SỚM, trước khi store chung rehydrate/ghi lại key cũ. Mặc định: đọc ngay bây giờ. */
    init?: PaneInit;
    onUnload?: (flush: () => void) => () => void;
  } = {},
): () => void {
  applyPaneInit(pane, opts.init ?? loadPaneInit(kv));

  let timer: ReturnType<typeof setTimeout> | null = null;
  let last = "";
  const save = () => {
    timer = null;
    const json = JSON.stringify(snapshotPane(pane));
    if (json === last) return;
    last = json;
    try {
      kv.setItem(PANE_KEY, json);
    } catch {
      /* localStorage đầy/bị chặn: mất khả năng nhớ, chart vẫn chạy */
    }
  };
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      save();
    }
  };
  const schedule = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, SAVE_DELAY);
  };
  save(); // ghi ngay lần đầu: key mới có mặt, đã migrate xong
  const offs = [
    pane.chart.subscribe(schedule),
    pane.indicators.subscribe((s, prev) => {
      if (s.list !== prev.list || s.collapsed !== prev.collapsed) schedule();
    }),
    pane.volume.subscribe((s, prev) => {
      if (s.s !== prev.s) schedule();
    }),
  ];
  const offUnload = opts.onUnload?.(flush);
  return () => {
    offs.forEach((f) => f());
    offUnload?.();
    flush();
  };
}
