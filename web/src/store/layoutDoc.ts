import { TF_SECONDS } from "@/lib/api";
import { MAX_PANES, paneIds, type Node } from "./layoutTree";
import { snapshotPane, type PaneInit } from "./paneStores";
import { parsePaneInit } from "./paneStorage";
import type { Pane } from "./paneStores";

// Document của một layout lưu trên server (`/me/layouts/<id>`): bố cục + state từng chart. KHÔNG lưu: bars, drawings (nằm riêng theo
// `<symbol>__<layoutId>`), góc nhìn, công cụ/con trỏ, Replay, theme/favTfs/ChartSettings (toàn cục).
export const LAYOUT_VERSION = 1;

export type PaneSaved = ReturnType<typeof snapshotPane>;

export type LayoutDoc = {
  version: number;
  name: string;
  templateId: string; // mẫu đang dùng (để tô trong popup); có thể là id lạ nếu bản app khác tạo
  tree: Node;
  active: string;
  panes: Record<string, PaneSaved>;
  updatedAt: number;
};

/** Từ khoá so sánh "có thay đổi chưa lưu không": bỏ `updatedAt` (đổi mỗi lần lưu) và `active` (bấm sang chart khác không đáng một lần PUT). */
export function docKey(d: LayoutDoc): string {
  const { updatedAt: _u, active: _a, ...rest } = d;
  void _u;
  void _a;
  return JSON.stringify(rest);
}

export type LayoutInput = {
  name: string;
  templateId: string;
  tree: Node;
  order: string[];
  panes: Record<string, Pane>;
  activeId: string;
};

export function buildDoc(s: LayoutInput, now = Date.now()): LayoutDoc {
  return {
    version: LAYOUT_VERSION,
    name: s.name,
    templateId: s.templateId,
    tree: s.tree,
    active: s.activeId,
    panes: Object.fromEntries(s.order.map((id) => [id, snapshotPane(s.panes[id])])),
    updatedAt: now,
  };
}

const MAX_NAME = 100;
export const cleanName = (n: unknown, fallback = "Unnamed") =>
  (typeof n === "string" ? n.trim().slice(0, MAX_NAME) : "") || fallback;

function validNode(n: unknown, seen: Set<string>, depth = 0): Node | null {
  if (!n || typeof n !== "object" || depth > 6) return null;
  const o = n as Record<string, unknown>;
  if (typeof o.pane === "string") {
    if (seen.has(o.pane)) return null;
    seen.add(o.pane);
    return { pane: o.pane };
  }
  if ((o.dir !== "row" && o.dir !== "col") || !Array.isArray(o.children) || o.children.length < 2) return null;
  const sizes = o.sizes;
  if (!Array.isArray(sizes) || sizes.length !== o.children.length || !sizes.every((x) => typeof x === "number" && x > 0 && Number.isFinite(x)))
    return null;
  const children = o.children.map((c) => validNode(c, seen, depth + 1));
  if (children.some((c) => c === null)) return null;
  const sum = (sizes as number[]).reduce((a, b) => a + b, 0);
  return { dir: o.dir, children: children as Node[], sizes: (sizes as number[]).map((x) => x / sum) };
}

export type ParsedDoc = { ok: true; doc: LayoutDoc } | { ok: false; reason: "version" | "invalid" };

/** Đọc document từ server/cache. `version` lạ (bản app mới hơn) hoặc hỏng → không dùng, người gọi KHÔNG được ghi đè nó. */
export function parseLayoutDoc(raw: unknown): ParsedDoc {
  if (!raw || typeof raw !== "object") return { ok: false, reason: "invalid" };
  const o = raw as Record<string, unknown>;
  if (typeof o.version !== "number" || !Number.isFinite(o.version)) return { ok: false, reason: "invalid" };
  if (o.version > LAYOUT_VERSION) return { ok: false, reason: "version" };
  const rawPanes = o.panes;
  if (!rawPanes || typeof rawPanes !== "object" || Array.isArray(rawPanes)) return { ok: false, reason: "invalid" };
  const seen = new Set<string>();
  const tree = validNode(o.tree, seen);
  const ids = Object.keys(rawPanes);
  if (!tree || seen.size < 1 || seen.size > MAX_PANES || ids.length !== seen.size || !ids.every((id) => seen.has(id)))
    return { ok: false, reason: "invalid" };
  const panes: Record<string, PaneSaved> = {};
  for (const id of ids) {
    const p = (rawPanes as Record<string, unknown>)[id];
    if (!p || typeof p !== "object") return { ok: false, reason: "invalid" };
    const init: PaneInit = parsePaneInit(p as Record<string, unknown>);
    panes[id] = {
      chart: { symbol: "XAUUSDm", tf: "M5", chartType: "candles", scaleMode: "normal", ...init.chart },
      indicators: init.indicators ?? [],
      legendCollapsed: init.legendCollapsed ?? false,
      volume: (init.volume ?? {}) as PaneSaved["volume"],
    };
  }
  const order = paneIds(tree);
  return {
    ok: true,
    doc: {
      version: LAYOUT_VERSION,
      name: cleanName(o.name),
      templateId: typeof o.templateId === "string" ? o.templateId : "",
      tree,
      active: typeof o.active === "string" && order.includes(o.active) ? o.active : order[0],
      panes,
      updatedAt: typeof o.updatedAt === "number" && Number.isFinite(o.updatedAt) ? o.updatedAt : 0,
    },
  };
}

/** Nhãn khung như TV: phút là số trần ("15"), còn lại "1h", "1D", "1W", "1M". */
export function tfShort(tf: string): string {
  if (tf === "MN1") return "1M";
  if (tf === "W1") return "1W";
  const sec = TF_SECONDS[tf];
  if (!sec) return tf;
  if (sec >= 86400) return `${sec / 86400}D`;
  if (sec >= 3600) return `${sec / 3600}h`;
  return String(sec / 60);
}

/** Một dòng tóm tắt cho danh sách: "XAUUSDm 15 · BTCUSDm 1h" (tối đa 4 chart, còn lại "+N"). */
export function summarizeDoc(d: LayoutDoc): string {
  const ids = paneIds(d.tree);
  const part = (id: string) => `${d.panes[id].chart.symbol} ${tfShort(d.panes[id].chart.tf)}`;
  const shown = ids.slice(0, 4).map(part).join(" · ");
  return ids.length > 4 ? `${shown} · +${ids.length - 4}` : shown;
}
