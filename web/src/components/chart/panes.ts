import type { IChartApi } from "lightweight-charts";

export type PaneRect = { top: number; height: number };

/** Vị trí từng pane của chart (px, tính từ mép trên của khung `box`); pane chưa dựng thì cao 0. */
export function paneRects(chart: IChartApi, box: HTMLElement): PaneRect[] {
  const base = box.getBoundingClientRect().top;
  return chart.panes().map((p) => {
    const el = p.getHTMLElement();
    if (!el) return { top: 0, height: 0 };
    const r = el.getBoundingClientRect();
    return { top: r.top - base, height: r.height };
  });
}

/** Chỉ số pane chứa toạ độ y (cùng gốc với paneRects), -1 nếu y rơi vào đường ngăn / ngoài chart. */
export const paneAt = (rects: PaneRect[], y: number): number => rects.findIndex((r) => y >= r.top && y < r.top + r.height);

export const MIN_PANE_H = 30; // LWC không cho pane thấp hơn 30px

/** Các pane bị ép thấp nhất: pane đã thu gọn (collapse) và, khi có một pane phóng to (maximize), mọi pane còn lại. */
export function squeezedPanes(count: number, collapsed: number[], maxi: number | null): Set<number> {
  const out = new Set(collapsed.filter((i) => i >= 0 && i < count));
  if (maxi !== null && maxi >= 0 && maxi < count) for (let i = 0; i < count; i++) if (i !== maxi) out.add(i);
  return out;
}

/** Chiều cao từng pane (px): pane bị ép = MIN_PANE_H, phần còn lại chia cho các pane khác theo tỉ lệ `weights` (stretch factor đã lưu). */
export function squeezedHeights(total: number, weights: number[], squeezed: Set<number>, min = MIN_PANE_H): number[] {
  const free = weights.map((_, i) => i).filter((i) => !squeezed.has(i));
  const rest = Math.max(0, total - squeezed.size * min);
  const sum = free.reduce((s, i) => s + weights[i], 0);
  return weights.map((_, i) => (squeezed.has(i) ? min : sum > 0 ? (rest * weights[i]) / sum : rest / free.length));
}

/** Kéo chart lên / xuống `dy` px (dương = chuột đi xuống = nội dung đi xuống, khoảng giá nhìn thấy dịch lên) trong pane cao `height` px: dịch khoảng giá theo số giá mỗi px, như `scrollTo` của lightweight-charts. */
export function panPriceRange(range: { from: number; to: number }, dy: number, height: number): { from: number; to: number } {
  const shift = (dy * (range.to - range.from)) / Math.max(1, height - 1);
  return { from: range.from + shift, to: range.to + shift };
}

/** Kéo dọc chừng này px thì coi là kéo giá (dưới ngưỡng: kéo ngang có rung tay thì thang giá vẫn tự co giãn như TV). */
export const VERT_DRAG_PX = 3;

