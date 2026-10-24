import type { Bar } from "@/lib/api";

// Tìm chỗ thiếu trong nến khung nhỏ mà DB đang có, để LowerFeed xin EA nạp thêm (POST /backfill).

/** Chỗ thiếu: các nến khung nhỏ trong [from, to) chưa có trong DB. `before` là mốc UTC giây EA lùi từ đó (nến đầu tiên đang có sau chỗ thiếu). */
export type Gap = { kind: "head" | "hole"; from: number; to: number; before: number; bars: number; key: string };

const HEAD_SLACK_STEPS = 5; // nến khung nhỏ đầu tiên muộn hơn `from` chừng này nến mới coi là thiếu đầu (nến chart đầu có thể ít tick)

/** Thiếu ở đầu: DB bắt đầu muộn hơn `from`. DB rỗng thì thiếu cả [from, to) và neo ở `to` (nến mới nhất). */
export function headGap(bars: Bar[], step: number, from: number, to: number): Gap | null {
  if (bars.length === 0) return to > from ? { kind: "head", from, to, before: to, bars: Math.ceil((to - from) / step), key: "head:empty" } : null;
  const first = bars[0].t;
  if (first - from <= step * HEAD_SLACK_STEPS) return null;
  return { kind: "head", from, to: first, before: first, bars: Math.ceil((first - from) / step), key: `head:${first}` };
}

/** Chỉ số nến đầu tiên có t >= `t`. */
function lowerBound(bars: Bar[], t: number): number {
  let lo = 0;
  let hi = bars.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Lỗ hổng bên trong dữ liệu (kết thúc sau `from`), mới → cũ. MT5 không tạo nến khi không có tick và thị trường nghỉ (nghỉ giữa ngày, cuối tuần)
 *  cũng để lại khoảng trống, nên chỉ coi là lỗ khi khung thô hơn (`oracle`) có một nến nằm trọn trong chỗ trống (thị trường mở lúc đó). */
export function holeGaps(bars: Bar[], step: number, from: number, oracle: Bar[], oracleStep: number): Gap[] {
  const out: Gap[] = [];
  for (let i = Math.max(1, lowerBound(bars, from + 1)); i < bars.length; i++) {
    const a = bars[i - 1].t + step; // nến mịn đầu tiên bị thiếu
    const b = bars[i].t;
    if (b - a < oracleStep) continue;
    const o = oracle[lowerBound(oracle, a)];
    if (o && o.t + oracleStep <= b) out.push({ kind: "hole", from: a, to: b, before: b, bars: Math.round((b - a) / step), key: `hole:${b}` });
  }
  return out.reverse();
}

/** Thay các nến của `bars` nằm trong [from, to) bằng `got` (cả hai tăng dần). */
export function spliceRange(bars: Bar[], from: number, to: number, got: Bar[]): Bar[] {
  const lo = lowerBound(bars, from);
  const hi = lowerBound(bars, to);
  return bars.slice(0, lo).concat(got, bars.slice(hi));
}
