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

/** Pine fixnan: na lấy giá trị hợp lệ gần nhất phía trước (na ở đầu giữ nguyên). */
export function fixnan(a: Num): Num {
  let last = NaN;
  return a.map((x) => (isNa(x) ? last : (last = x)));
}

/** Pine ta.dev: độ lệch tuyệt đối trung bình quanh SMA (dùng cho CCI). */
export function dev(a: Num, n: number): Num {
  const out = nan(a.length);
  const mean = sma(a, n);
  for (let i = n - 1; i < a.length; i++) {
    if (isNa(mean[i])) continue;
    let s = 0;
    for (let j = i - n + 1; j <= i; j++) s += Math.abs(a[j] - mean[i]);
    out[i] = s / n;
  }
  return out;
}

/** Tổng trượt n phần tử (Pine math.sum): cửa sổ chứa na thì na. */
export const sum = (a: Num, n: number): Num => sma(a, n).map((x) => x * n);

/** Pine ta.stoch: vị trí của `src` trong khoảng low..high của n nến (0..100); khoảng bằng 0 thì na. */
export function stoch(src: Num, high: Num, low: Num, n: number): Num {
  const hh = highest(high, n);
  const ll = lowest(low, n);
  return src.map((x, i) => (hh[i] === ll[i] ? NaN : (100 * (x - ll[i])) / (hh[i] - ll[i])));
}

/** Pine ta.cum: tổng cộng dồn; na chỉ làm na đúng nến đó (nến sau cộng tiếp từ tổng cũ). */
export function cum(a: Num): Num {
  let s = 0;
  return a.map((x) => (isNa(x) ? NaN : (s += x)));
}
