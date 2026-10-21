// Hiện hình theo khung thời gian, như tab Visibility của TradingView: mỗi đơn vị
// (phút, giờ, ngày, tuần, tháng) có bật/tắt và khoảng [from, to]. App không có tick/giây/range
// nên bỏ các hàng đó.
export type Unit = "minutes" | "hours" | "days" | "weeks" | "months";
export type VisRange = { on: boolean; from: number; to: number };
export type Visibility = Partial<Record<Unit, VisRange>>;

export const UNITS: { id: Unit; label: string; max: number }[] = [
  { id: "minutes", label: "Minutes", max: 59 },
  { id: "hours", label: "Hours", max: 24 },
  { id: "days", label: "Days", max: 366 },
  { id: "weeks", label: "Weeks", max: 52 },
  { id: "months", label: "Months", max: 12 },
];

// "M15" -> phút 15, "H4" -> giờ 4, "D1" -> ngày 1, "W1" -> tuần 1, "MN1" -> tháng 1
export function tfUnit(tf: string): { unit: Unit; n: number } | null {
  const m = /^(MN|M|H|D|W)(\d+)$/.exec(tf);
  if (!m) return null;
  const unit = ({ M: "minutes", H: "hours", D: "days", W: "weeks", MN: "months" } as const)[m[1] as "M" | "H" | "D" | "W" | "MN"];
  return { unit, n: Number(m[2]) };
}

// Không cấu hình (hoặc thiếu đơn vị đó) = hiện
export function visibleOn(v: Visibility | undefined, tf: string): boolean {
  const u = v && tfUnit(tf);
  const r = u && v[u.unit];
  if (!u || !r) return true;
  return r.on && u.n >= r.from && u.n <= r.to;
}

// Các lựa chọn nhanh trong menu "Visibility on intervals" của TV
export type VisPreset = "above" | "below" | "only" | "all";

export function presetVisibility(preset: VisPreset, tf: string): Visibility | undefined {
  const u = tfUnit(tf);
  if (preset === "all" || !u) return undefined;
  const cur = UNITS.findIndex((x) => x.id === u.unit);
  const out: Visibility = {};
  UNITS.forEach(({ id, max }, i) => {
    if (i === cur) {
      out[id] = preset === "only" ? { on: true, from: u.n, to: u.n }
        : preset === "above" ? { on: true, from: u.n, to: max }
        : { on: true, from: 1, to: u.n };
    } else {
      const on = preset === "above" ? i > cur : preset === "below" ? i < cur : false;
      out[id] = { on, from: 1, to: max };
    }
  });
  return out;
}
