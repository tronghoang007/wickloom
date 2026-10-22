import type { IndicatorDef } from "./schema";
import type { IndicatorInstance } from "./instance";

// Indicator nào nằm pane nào, thang giá nào. `pane` của instance là khoá nhóm: cùng khoá = cùng pane, "main" = pane chính
// (chung thang giá với nến); không đặt thì overlay -> main, còn lại -> pane riêng (khoá `own:<uid>`).

export const MAIN_PANE = "main";
export type Scale = "right" | "left" | "none";
export const SCALES: Scale[] = ["right", "left", "none"];

export const ownPane = (uid: string): string => `own:${uid}`;

export const paneKeyOf = (inst: IndicatorInstance, def: IndicatorDef): string => inst.pane ?? (def.overlay ? MAIN_PANE : ownPane(inst.uid));

/** Chỉ số pane LWC của từng instance: main = 0, các pane khác đánh số 1.. theo thứ tự xuất hiện (khớp thứ tự dựng series). */
export function paneIndices(keys: string[]): number[] {
  const idx = new Map<string, number>([[MAIN_PANE, 0]]);
  return keys.map((k) => {
    if (!idx.has(k)) idx.set(k, idx.size);
    return idx.get(k)!;
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
