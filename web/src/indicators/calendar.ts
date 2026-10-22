// Ranh giới phiên / kỳ (ngày, tuần, tháng, năm) theo GIỜ BROKER cho VWAP, Pivot, CVD, Session Volume Profile.
// Nến lưu `t` = UTC epoch giây; ngày của broker = UTC + offset (backend: bar_open). Offset đổi theo DST của server,
// nên khi có mốc mở nến D1 thật (`dayOpens`) thì ngày được lấy từ đó: ngày mùa đông không lệch 1 giờ so với offset hiện tại.

export type Period = "day" | "week" | "month" | "year";

export type CalendarOpts = {
  /** Giây: giờ broker − UTC (hiện tại, từ backend /health). */
  offset: number;
  /** Mốc mở các nến D1 (UTC epoch giây, tăng dần) nếu đã nạp. */
  dayOpens?: number[];
};

const DAY = 86400;

/** Số ngày kể từ 1970-01-01 theo lịch dân sự → [năm, tháng 0–11] (thuật toán Howard Hinnant). */
function civil(dayNum: number): [number, number] {
  const z = dayNum + 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const m = mp < 10 ? mp + 3 : mp - 9;
  const y = yoe + era * 400 + (m <= 2 ? 1 : 0);
  return [y, m - 1];
}

/** Khoá kỳ (tăng dần theo thời gian) của một số-ngày broker. Tuần bắt đầu thứ Hai (1970-01-05 là thứ Hai). */
function periodKey(dayNum: number, period: Period): number {
  switch (period) {
    case "day": return dayNum;
    case "week": return Math.floor((dayNum + 3) / 7);
    case "month": { const [y, m] = civil(dayNum); return y * 12 + m; }
    case "year": return civil(dayNum)[0];
  }
}

/** Khoá kỳ của từng nến: đổi giá trị = sang kỳ mới (reset VWAP, cộng dồn...). `times` tăng dần. */
export function periodKeys(times: number[], period: Period, opts: CalendarOpts): number[] {
  const opens = opts.dayOpens;
  let d = 0; // con trỏ vào `opens` (times tăng dần nên chỉ tiến)
  return times.map((t) => {
    if (opens && opens.length > 0 && t >= opens[0]) {
      while (d + 1 < opens.length && opens[d + 1] <= t) d++;
      // làm tròn thay vì cắt: mốc mở D1 lệch ±1 giờ so với offset hiện tại vẫn rơi đúng ngày broker
      return periodKey(Math.round((opens[d] + opts.offset) / DAY), period);
    }
    return periodKey(Math.floor((t + opts.offset) / DAY), period);
  });
}

/** Chỉ số các nến mở đầu kỳ (nến đầu tiên của mảng luôn là mở đầu, dù kỳ đó bị cắt). */
export function periodStarts(times: number[], period: Period, opts: CalendarOpts): number[] {
  const keys = periodKeys(times, period, opts);
  const out: number[] = [];
  keys.forEach((k, i) => {
    if (i === 0 || k !== keys[i - 1]) out.push(i);
  });
  return out;
}
