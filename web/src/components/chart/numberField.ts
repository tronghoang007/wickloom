// Logic thuần của ô số trong Settings (component `NumberField` ở settingsParts.tsx): ô giữ chuỗi đang gõ nên "3." / "-" / "" gõ dở không bị ghi đè bằng giá trị cũ.

/** Chuỗi đang gõ có thể thành số không: chỉ chữ số, dấu +/- ở đầu và một dấu thập phân ("." hoặc "," như bàn phím vi). "3." / "-" / "" là gõ dở nhưng vẫn cho gõ tiếp. */
export const isNumText = (s: string): boolean => /^[+-]?\d*[.,]?\d*$/.test(s);

/** Giá trị của chuỗi đang gõ; NaN khi chưa thành số ("", "-", "."). */
export function parseNumText(s: string): number {
  const t = s.trim().replace(",", ".");
  return /\d/.test(t) ? Number(t) : NaN;
}

/** Giá trị sau một lần bấm ↑ (`dir` 1) / ↓ (-1): cộng `step`, làm tròn bỏ sai số nhị phân (3,5 + 0,1 = 3,6), kẹp trong [min, max]. */
export function stepNum(cur: number, dir: 1 | -1, step: number, min = -Infinity, max = Infinity): number {
  return Math.min(max, Math.max(min, Math.round((cur + dir * step) * 1e9) / 1e9));
}
