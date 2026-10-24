import type { UTCTimestamp } from "lightweight-charts";
import { visibleOn } from "@/drawings/visibility";
import type { Bar } from "@/lib/api";
import { composeStore } from "./compose";
import { DEFAULT_VOLUME, type VolumeSettings } from "./paneStores";

export { DEFAULT_VOLUME, type VolumeSettings };

/** Cho UI ngoài chart: Volume của pane ĐANG ACTIVE. Chart gắn thẳng vào `pane.volume`. */
export const useVolumeStore = composeStore({ pane: (p) => p.volume, paneKeys: ["s", "open"] });

/** Cột volume tăng: so với giá mở (mặc định) hoặc giá đóng nến trước ("Color based on previous close"). */
export function volUp(b: Bar, prevC: number | undefined, v: VolumeSettings) {
  return v.colorByPrevClose && prevC !== undefined ? b.c >= prevC : b.c >= b.o;
}

/** Màu mặc định của cột volume: đo từ TV (`#26a69a` / `#ef5350` ở 50%), độc lập với màu nến như TV. */
export const VOL_UP = "#26a69a80";
export const VOL_DOWN = "#ef535080";

/** Màu cột (có thể kèm alpha #rrggbbaa); chưa chọn thì dùng màu mặc định của TV. */
export function volColor(v: VolumeSettings, up: boolean) {
  return (up ? v.growing : v.falling) ?? (up ? VOL_UP : VOL_DOWN);
}

/** Histogram volume có đang hiện không (chưa gỡ, không ẩn, bật Volume, đúng khung thời gian). */
export const volShown = (v: VolumeSettings, tf: string) =>
  !v.removed && !v.hidden && v.show && visibleOn(v.visibility, tf);

/** Đường MA của volume có đang hiện không (độc lập với ô Volume, như TV). */
export const volMaShown = (v: VolumeSettings, tf: string) =>
  !v.removed && !v.hidden && v.maOn && visibleOn(v.visibility, tf);

/** Số chữ số của volume: "Default" là 2, như cách legend vẫn hiện từ trước. */
export const volDigits = (v: VolumeSettings) => v.precision ?? 2;

/** SMA của volume cho toàn bộ nến (bỏ n-1 nến đầu chưa đủ dữ liệu). */
export function volMaData(bars: Bar[], n: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i].v;
    if (i >= n) sum -= bars[i - n].v;
    if (i >= n - 1) out.push({ time: bars[i].t as UTCTimestamp, value: sum / n });
  }
  return out;
}

/** SMA của volume tại nến `i` (null nếu chưa đủ n nến). */
export function volMaAt(bars: Bar[], i: number, n: number): number | null {
  if (i < n - 1 || !bars[i]) return null;
  let sum = 0;
  for (let j = i - n + 1; j <= i; j++) sum += bars[j].v;
  return sum / n;
}

/** Volume rút gọn như legend của TV: 1.05 K, 2.31 M. */
export function fmtVol(v: number, digits = 2) {
  if (v >= 1e6) return `${(v / 1e6).toFixed(digits)} M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(digits)} K`;
  return String(v);
}
