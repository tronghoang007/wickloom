import type { ChartType } from "@/store/paneStores";
import type { Patch } from "./diff";

// "Color Candles" của Pine (plotcandle đè lên nến chart): mỗi indicator trả một màu cho từng nến, "" = giữ màu mặc định.

/** Gộp màu của nhiều indicator: indicator đứng sau thắng ở nến nào nó có màu. Không indicator nào tô thì null. */
export function mergeCandleColors(lists: (string[] | null)[]): string[] | null {
  const got = lists.filter((l): l is string[] => !!l);
  if (got.length === 0) return null;
  const out = got[0].slice();
  for (const l of got.slice(1)) l.forEach((c, i) => { if (c) out[i] = c; });
  return out;
}

/** Cách cập nhật series nến chính từ bộ màu cũ sang mới (null = không tô): chỉ nến cuối đổi thì `tail`, còn lại dựng lại cả series. */
export function planCandleColors(prev: string[] | null, next: string[] | null): Patch {
  if (!prev && !next) return { kind: "none" };
  if (!prev || !next || next.length < prev.length) return { kind: "all" };
  const n = next.length;
  for (let i = 0; i < n; i++) {
    if ((prev[i] ?? "") === (next[i] ?? "")) continue;
    return i >= n - 1 ? { kind: "tail", from: n - 1 } : { kind: "all" };
  }
  return n === prev.length ? { kind: "none" } : { kind: "tail", from: n - 1 };
}

const CLEAR = "rgba(0,0,0,0)";

/** Điểm dữ liệu của series chính sau khi tô `color`: thân/viền/bấc nến, màu bar, màu đường. `body` = thân nến đang bật (nến rỗng giữ thân trong suốt). */
export function overridePoint<P extends object>(point: P, type: ChartType, color: string, body: boolean): P {
  if (type === "line") return { ...point, color };
  if (type === "area") return { ...point, lineColor: color };
  if (type === "bars") return { ...point, color };
  return { ...point, color: body ? color : CLEAR, borderColor: color, wickColor: color };
}
