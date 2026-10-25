import type { SymbolInfo } from "@/lib/api";

// Khối lượng (lot): làm tròn theo step, kẹp trong min/max của symbol (và MaxLotPerOrder của EA). Hàm thuần (docs/trade-plan.md mục 5).
export type LotSpec = { min: number; max: number; step: number };

/** min/max/step của symbol; null khi EA chưa báo (EA < 2.12) - app không đoán. `maxLot` = MaxLotPerOrder của EA (0/thiếu = không giới hạn). */
export function lotSpec(sym: SymbolInfo | undefined, maxLot?: number): LotSpec | null {
  const min = sym?.volume_min;
  const max = sym?.volume_max;
  const step = sym?.volume_step;
  if (!min || !max || !step || min <= 0 || max <= 0 || step <= 0) return null;
  const cap = maxLot && maxLot > 0 ? Math.min(max, maxLot) : max;
  return cap < min ? null : { min, max: cap, step };
}

/** Số chữ số thập phân cần để biểu diễn step (0.01 → 2, 0.5 → 1, 1 → 0). */
export function lotDecimals(step: number): number {
  for (let d = 0; d <= 8; d++) {
    const v = step * 10 ** d;
    if (Math.abs(v - Math.round(v)) < 1e-9) return d;
  }
  return 8;
}

/** Làm tròn về bội của step rồi kẹp [min, max]; không phải số thì về min. */
export function normalizeLot(v: number, s: LotSpec): number {
  if (!Number.isFinite(v)) return s.min;
  const top = Math.floor(s.max / s.step + 1e-9) * s.step; // max không phải bội của step thì hạ xuống bội gần nhất
  const r = Math.round(v / s.step + 1e-9) * s.step;
  return Number(Math.min(top, Math.max(s.min, r)).toFixed(lotDecimals(s.step)));
}

/** Nút − / +: nhảy một step. */
export const stepLot = (v: number, dir: 1 | -1, s: LotSpec) => normalizeLot(v + dir * s.step, s);

export const fmtLotValue = (v: number, s: LotSpec) => v.toFixed(lotDecimals(s.step));

// Lot nhớ theo từng account × symbol (lần nhập gần nhất). localStorage có thể bị chặn: không nhớ được thì dùng min.
const KEY = "wickloom-lots";
const keyOf = (accountId: string, symbol: string) => `${accountId}|${symbol}`;

export function readLot(accountId: string, symbol: string): number | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "{}")[keyOf(accountId, symbol)];
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function writeLot(accountId: string, symbol: string, lot: number): void {
  try {
    const all = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    all[keyOf(accountId, symbol)] = lot;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    /* không nhớ được lot thì thôi */
  }
}

/** Lot sẽ dùng cho lệnh nhanh (menu chuột phải): lot đã nhớ của account × symbol, chuẩn hoá theo spec; chưa nhớ thì lot tối thiểu. */
export const currentLot = (accountId: string | undefined, symbol: string, spec: LotSpec): number =>
  normalizeLot((accountId ? readLot(accountId, symbol) : null) ?? spec.min, spec);

/** Lot sẽ đóng của vị thế `total` lot theo ô đang nhập (thanh kéo ở bảng Modify): chưa nhập hoặc không biết step = đóng hết; còn lại làm tròn theo step, kẹp [min, total]. `spec.max` là `total`. */
export function closeLot(text: string | null, total: number, spec: LotSpec | null): number {
  if (text === null || !spec) return total;
  return normalizeLot(parseFloat(text.replace(",", ".")), spec);
}

/** Các mốc trên thanh kéo đóng một phần, tính theo LOT của vị thế (spec.max): ít bước (≤ 6) thì mỗi step một mốc; nhiều hơn thì chia theo khoảng "tròn" (1 / 2 / 2.5 / 5 × 10^n lot, là bội của step)
 *  sao cho còn ≤ 5 mốc, mốc cuối luôn là cả vị thế. Mốc nhỏ hơn lot tối thiểu bị bỏ (không đóng được lượng đó). */
export function lotMarks(spec: LotSpec): number[] {
  const dec = lotDecimals(spec.step);
  const r = (v: number) => Number(v.toFixed(Math.max(dec, 8)));
  const steps = Math.floor(spec.max / spec.step + 1e-9);
  const keep = (marks: number[]) => {
    const out = marks.filter((m) => m >= spec.min - 1e-9);
    return out.length ? out : [spec.max];
  };
  const full = r(spec.max);
  if (steps <= 6) {
    const marks = Array.from({ length: steps }, (_, i) => r((i + 1) * spec.step));
    return keep(marks[marks.length - 1] === full ? marks : [...marks, full]);
  }
  for (let e = -8; e <= 8; e++) {
    for (const k of [1, 2, 2.5, 5]) {
      const gap = r(k * 10 ** e);
      const q = gap / spec.step;
      if (gap < spec.step - 1e-12 || Math.abs(q - Math.round(q)) > 1e-6) continue; // khoảng chia phải là bội của step
      const n = Math.floor(spec.max / gap + 1e-9);
      const marks = Array.from({ length: n }, (_, i) => r((i + 1) * gap));
      if (marks[marks.length - 1] !== full) marks.push(full);
      if (marks.length <= 5) return keep(marks);
    }
  }
  return [full];
}
