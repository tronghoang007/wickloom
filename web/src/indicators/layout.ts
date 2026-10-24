import type { IndicatorDef } from "./schema";
import type { IndicatorInstance } from "./instance";

// Indicator nào nằm pane nào, thang giá nào. `pane` của instance là khoá nhóm: cùng khoá = cùng pane, "main" = pane chính
// (chung thang giá với nến); không đặt thì overlay -> main, còn lại -> pane riêng (khoá `own:<uid>`).

export const MAIN_PANE = "main";
export type Scale = "right" | "left" | "none";
export const SCALES: Scale[] = ["right", "left", "none"];

export const ownPane = (uid: string): string => `own:${uid}`;

export const paneKeyOf = (inst: IndicatorInstance, def: IndicatorDef): string => inst.pane ?? (def.overlay ? MAIN_PANE : ownPane(inst.uid));

/** Các khoá pane riêng (không phải pane chính), theo thứ tự xuất hiện đầu tiên trong danh sách. */
export const otherPaneKeys = (keys: string[]): string[] => [...new Set(keys.filter((k) => k !== MAIN_PANE))];

/** `mainSlot` = số pane riêng nằm TRÊN pane chính; kẹp vào [0, số pane riêng]. */
export const clampSlot = (slot: number, nOther: number): number => Math.max(0, Math.min(slot, nOther));

/**
 * Chỉ số pane LWC của từng instance. Pane riêng đánh thứ tự 0.. theo lần xuất hiện đầu tiên; pane chính chen vào vị trí `mainSlot`
 * (mặc định 0 = trên cùng, các pane riêng là 1..). Khớp thứ tự dựng series.
 */
export function paneIndices(keys: string[], mainSlot = 0): number[] {
  const order = otherPaneKeys(keys);
  const slot = clampSlot(mainSlot, order.length);
  return keys.map((k) => {
    if (k === MAIN_PANE) return slot;
    const i = order.indexOf(k);
    return i < slot ? i : i + 1;
  });
}

/**
 * Thang giá hiệu lực: user chọn thì theo; không thì indicator pane riêng dùng thang phải của pane, còn indicator
 * vốn ở pane riêng bị chuyển lên pane chính thì "none" (overlay, thang ẩn) để không làm méo thang giá của nến.
 */
export function effectiveScale(inst: IndicatorInstance, def: IndicatorDef, paneKey: string): Scale {
  return inst.scale ?? (paneKey === MAIN_PANE && !def.overlay ? "none" : "right");
}

export type PaneChoice = { key: string; label: string };

/** Các pane khác mà `inst` có thể chuyển tới (không gồm pane chính và pane hiện tại), gọi tên theo indicator đầu tiên trong pane. */
export function otherPanes(list: IndicatorInstance[], inst: IndicatorInstance, defOf: (id: string) => IndicatorDef): PaneChoice[] {
  const mine = paneKeyOf(inst, defOf(inst.id));
  const out: PaneChoice[] = [];
  for (const o of list) {
    const key = paneKeyOf(o, defOf(o.id));
    if (key === MAIN_PANE || key === mine || out.some((p) => p.key === key)) continue;
    out.push({ key, label: defOf(o.id).name });
  }
  return out;
}

/**
 * Đổi chỗ pane `key` với pane liền trên (dir = -1) hoặc liền dưới (dir = 1). Thứ tự pane do thứ tự indicator trong `list` quyết định
 * (pane xuất hiện đầu tiên là pane 1), nên sắp lại list: indicator ở pane chính đứng đầu, rồi từng pane theo thứ tự mới,
 * trong cùng pane giữ nguyên thứ tự cũ.
 */
export function movePane(list: IndicatorInstance[], defOf: (id: string) => IndicatorDef, key: string, dir: -1 | 1): IndicatorInstance[] {
  const keys = list.map((i) => paneKeyOf(i, defOf(i.id)));
  const order = [...new Set(keys.filter((k) => k !== MAIN_PANE))];
  const at = order.indexOf(key);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= order.length) return list;
  [order[at], order[to]] = [order[to], order[at]];
  const rank = (k: string) => (k === MAIN_PANE ? -1 : order.indexOf(k));
  return list
    .map((inst, i) => ({ inst, i, r: rank(keys[i]) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map((x) => x.inst);
}

export type PaneLayout = { list: IndicatorInstance[]; mainSlot: number };

/**
 * Đổi chỗ pane `key` (MAIN_PANE = pane chính) với pane liền trên (dir = -1) hoặc liền dưới (dir = 1) theo thứ tự hiển thị.
 * Đổi chỗ với pane chính thì chỉ đổi `mainSlot`; hai pane riêng đổi chỗ thì sắp lại list (xem movePane). Không đi được thì trả nguyên.
 */
export function stepPane(list: IndicatorInstance[], defOf: (id: string) => IndicatorDef, mainSlot: number, key: string, dir: -1 | 1): PaneLayout {
  const order = otherPaneKeys(list.map((i) => paneKeyOf(i, defOf(i.id))));
  const slot = clampSlot(mainSlot, order.length);
  const display = [...order.slice(0, slot), MAIN_PANE, ...order.slice(slot)];
  const at = display.indexOf(key);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= display.length) return { list, mainSlot };
  if (key === MAIN_PANE) return { list, mainSlot: slot + dir };
  if (display[to] === MAIN_PANE) return { list, mainSlot: slot - dir };
  return { list: movePane(list, defOf, key, dir), mainSlot: slot };
}

/** Vị trí pane chính sau khi danh sách đổi (gỡ / gộp pane): giữ nguyên số pane riêng còn sống đang nằm trên pane chính. */
export function reslot(prev: IndicatorInstance[], next: IndicatorInstance[], defOf: (id: string) => IndicatorDef, mainSlot: number): number {
  if (mainSlot <= 0) return 0;
  const before = otherPaneKeys(prev.map((i) => paneKeyOf(i, defOf(i.id))));
  const alive = new Set(otherPaneKeys(next.map((i) => paneKeyOf(i, defOf(i.id)))));
  return before.slice(0, clampSlot(mainSlot, before.length)).filter((k) => alive.has(k)).length;
}
