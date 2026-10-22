import type { Num } from "./ta";

// Quyết định cách đẩy dữ liệu 1 plot vào series của lightweight-charts: chỉ nến cuối đổi (tick) hoặc thêm 1 nến mới
// thì `update` đúng các điểm đó, còn lại mới `setData` cả mảng (đổi input, nạp thêm lịch sử, ...).

export type Snap = { times: number[]; values: Num; colors?: string[]; aux?: Num[] }; // aux: open/high/low của plot candles

export type Patch = { kind: "none" } | { kind: "all" } | { kind: "tail"; from: number };

const same = (a: number, b: number) => a === b || (Number.isNaN(a) && Number.isNaN(b));

export function planUpdate(prev: Snap | null, next: Snap): Patch {
  if (!prev || prev.times.length === 0 || next.times.length === 0) return { kind: "all" };
  const n = prev.times.length;
  // LWC.update chỉ sửa được điểm cuối hoặc nối thêm: nến đầu đổi / ngắn đi / dài thêm nhiều = dữ liệu khác hẳn
  if (prev.times[0] !== next.times[0] || next.times.length < n || next.times.length > n + 1) return { kind: "all" };
  for (let i = 0; i < n; i++) {
    const diff =
      prev.times[i] !== next.times[i] ||
      !same(prev.values[i], next.values[i]) ||
      (prev.colors?.[i] ?? "") !== (next.colors?.[i] ?? "") ||
      (next.aux?.some((a, k) => !same(a[i], prev.aux?.[k]?.[i] ?? NaN)) ?? false);
    if (!diff) continue;
    return i >= n - 1 ? { kind: "tail", from: n - 1 } : { kind: "all" };
  }
  return next.times.length > n ? { kind: "tail", from: n } : { kind: "none" };
}
