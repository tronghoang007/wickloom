// Ranh giới phiên / kỳ (ngày, tuần, tháng, quý, năm, thập kỷ, thế kỷ) theo GIỜ BROKER cho VWAP, Pivot, CVD, Session Volume Profile.
// Nến lưu `t` = UTC epoch giây; ngày của broker = UTC + offset (backend: bar_open). Offset đổi theo DST của server,
// nên khi có mốc mở nến D1 thật (`dayOpens`) thì ngày được lấy từ đó: ngày mùa đông không lệch 1 giờ so với offset hiện tại.

export type Period = "day" | "week" | "month" | "quarter" | "year" | "year2" | "year3" | "year5" | "decade" | "century";

/** Mốc đổi "ngày" cho CVD / Session Volume Profile. Không đặt = 00:00 giờ broker (cùng nến D1 của MT5), vàng nghỉ một tiếng giữa phiên nên mốc đó không trùng phiên thật.
 *  hour: phiên mở lúc `hour` giờ broker (phiên mở từ 12h trở đi được tính là ngày giao dịch hôm sau, như CME).
 *  break: phiên mới mở ở nến đầu tiên sau khoảng trống ≥ `minutes` phút không có nến (giờ nghỉ, cuối tuần, lỗ dữ liệu). Chỉ đổi khoá của kỳ "day"; tuần / tháng / năm lấy theo ngày giao dịch của phiên. */
export type SessionStart = { mode: "hour"; hour: number } | { mode: "break"; minutes: number };

export type CalendarOpts = {
  /** Giây: giờ broker − UTC (hiện tại, từ backend /health). */
  offset: number;
  /** Mốc mở các nến D1 (UTC epoch giây, tăng dần) nếu đã nạp. */
  dayOpens?: number[];
  session?: SessionStart;
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
    case "quarter": { const [y, m] = civil(dayNum); return y * 4 + Math.floor(m / 3); }
    case "year": return civil(dayNum)[0];
    case "year2": return Math.floor(civil(dayNum)[0] / 2);
    case "year3": return Math.floor(civil(dayNum)[0] / 3);
    case "year5": return Math.floor(civil(dayNum)[0] / 5);
    case "decade": return Math.floor(civil(dayNum)[0] / 10);
    case "century": return Math.floor(civil(dayNum)[0] / 100);
  }
}

/** Ngày broker (số ngày kể từ 1970-01-01) và số giây kể từ 00:00 broker của từng nến. `times` tăng dần. */
function brokerDays(times: number[], opts: CalendarOpts): { day: number[]; tod: number[] } {
  const opens = opts.dayOpens;
  const day: number[] = [];
  const tod: number[] = [];
  let d = 0; // con trỏ vào `opens` (times tăng dần nên chỉ tiến)
  for (const t of times) {
    if (opens && opens.length > 0 && t >= opens[0]) {
      while (d + 1 < opens.length && opens[d + 1] <= t) d++;
      // làm tròn thay vì cắt: mốc mở D1 lệch ±1 giờ so với offset hiện tại vẫn rơi đúng ngày broker
      day.push(Math.round((opens[d] + opts.offset) / DAY));
      tod.push(t - opens[d]);
    } else {
      const local = t + opts.offset;
      const n = Math.floor(local / DAY);
      day.push(n);
      tod.push(local - n * DAY);
    }
  }
  return { day, tod };
}

const EVENING = 12 * 3600;

/** Khoá phiên theo khoảng trống: mỗi lần nến cách nến trước ≥ `minGap` giây (không tính bước nến) là phiên mới. Nếu cả một ngày broker trôi qua mà không có khoảng trống nào
 *  (khung H4 trở lên không thấy giờ nghỉ, BTC không nghỉ) thì phiên đổi lúc 00:00 broker như mặc định. */
function breakKeys(times: number[], day: number[], tod: number[], period: Period, minGap: number): number[] {
  const n = times.length;
  if (n === 0) return [];
  let step = Infinity;
  for (let i = 1; i < n; i++) step = Math.min(step, times[i] - times[i - 1]);
  const tradingDay = (i: number) => day[i] + (tod[i] >= EVENING ? 1 : 0);
  let id = 0;
  let label = tradingDay(0);
  // ngày broker có khoảng trống gần nhất. Phiên đầu mảng bị cắt nên chưa biết nó đã qua giờ nghỉ chưa: nếu dữ liệu có khoảng trống thì coi như rồi (không cắt lúc 00:00 đầu tiên)
  let lastBreak = times.some((t, i) => i > 0 && t - times[i - 1] - step >= minGap) ? day[0] : -Infinity;
  return times.map((t, i) => {
    if (i > 0) {
      const gap = t - times[i - 1] - step >= minGap;
      if (gap) lastBreak = day[i];
      if (gap || (day[i] !== day[i - 1] && lastBreak < day[i - 1])) {
        id++;
        label = tradingDay(i);
      }
    }
    return period === "day" ? id : periodKey(label, period);
  });
}

/** Khoá kỳ của từng nến: đổi giá trị = sang kỳ mới (reset VWAP, cộng dồn...). `times` tăng dần. */
export function periodKeys(times: number[], period: Period, opts: CalendarOpts): number[] {
  const { day, tod } = brokerDays(times, opts);
  const s = opts.session;
  if (s?.mode === "break") return breakKeys(times, day, tod, period, Math.max(1, s.minutes) * 60);
  const start = s ? s.hour * 3600 : 0;
  if (start === 0) return day.map((d) => periodKey(d, period));
  // phiên mở lúc `start`: nến trước giờ đó thuộc phiên của ngày hôm trước; phiên mở buổi tối là ngày giao dịch hôm sau
  const next = start >= EVENING ? 1 : 0;
  return day.map((d, i) => periodKey(d - (tod[i] < start ? 1 : 0) + next, period));
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
