import { isNa, nan, type Num } from "./core";
import { sma } from "./ma";

/** Độ lệch chuẩn tổng thể (Pine ta.stdev mặc định biased = true). Hai lượt trên cửa sổ, không cấp phát: chính xác hơn tổng bình phương trượt. */
export function stdev(a: Num, n: number): Num {
  const out = nan(a.length);
  const mean = sma(a, n);
  for (let i = n - 1; i < a.length; i++) {
    if (isNa(mean[i])) continue;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += (a[j] - mean[i]) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}

// Hàng đợi đơn điệu: O(n), không dùng Math.max(...w) (vỡ với cửa sổ lớn). na bị bỏ qua.
function extreme(a: Num, n: number, better: (x: number, y: number) => boolean): Num {
  const out = nan(a.length);
  const q: number[] = []; // chỉ số, giá trị tốt nhất ở đầu
  let head = 0;
  for (let i = 0; i < a.length; i++) {
    if (!isNa(a[i])) {
      while (q.length > head && !better(a[q[q.length - 1]], a[i])) q.pop();
      q.push(i);
    }
    while (q.length > head && q[head] <= i - n) head++;
    if (i >= n - 1 && q.length > head) out[i] = a[q[head]];
  }
  return out;
}

export const highest = (a: Num, n: number): Num => extreme(a, n, (x, y) => x > y);
export const lowest = (a: Num, n: number): Num => extreme(a, n, (x, y) => x < y);

/** Pine ta.change: a[i] − a[i−1]. */
export function change(a: Num): Num {
  return a.map((x, i) => (i === 0 ? NaN : x - a[i - 1]));
}
