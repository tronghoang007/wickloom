import { useSettingsStore, type DateFormat } from "@/store/settings";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");

// Danh sách như dropdown múi giờ của TradingView (thành phố đại diện cho từng mức lệch). `id` là IANA, "local" = giờ máy; giữ nguyên các id đã lưu từ bản trước.
export const TIMEZONES: { id: string; label: string }[] = [
  { id: "local", label: "Giờ máy" },
  { id: "UTC", label: "UTC" },
  { id: "Pacific/Honolulu", label: "Honolulu" },
  { id: "America/Anchorage", label: "Anchorage" },
  { id: "America/Los_Angeles", label: "Los Angeles" },
  { id: "America/Vancouver", label: "Vancouver" },
  { id: "America/Denver", label: "Denver" },
  { id: "America/Phoenix", label: "Phoenix" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "America/Mexico_City", label: "Mexico City" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Toronto", label: "Toronto" },
  { id: "America/Bogota", label: "Bogota" },
  { id: "America/Lima", label: "Lima" },
  { id: "America/Halifax", label: "Halifax" },
  { id: "America/Caracas", label: "Caracas" },
  { id: "America/Santiago", label: "Santiago" },
  { id: "America/Sao_Paulo", label: "Sao Paulo" },
  { id: "America/Argentina/Buenos_Aires", label: "Buenos Aires" },
  { id: "Atlantic/Reykjavik", label: "Reykjavik" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Dublin", label: "Dublin" },
  { id: "Europe/Lisbon", label: "Lisbon" },
  { id: "Europe/Paris", label: "Paris" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Europe/Madrid", label: "Madrid" },
  { id: "Europe/Rome", label: "Rome" },
  { id: "Europe/Amsterdam", label: "Amsterdam" },
  { id: "Europe/Zurich", label: "Zurich" },
  { id: "Europe/Vienna", label: "Vienna" },
  { id: "Europe/Warsaw", label: "Warsaw" },
  { id: "Europe/Stockholm", label: "Stockholm" },
  { id: "Africa/Lagos", label: "Lagos" },
  { id: "Europe/Athens", label: "Athens" },
  { id: "Europe/Helsinki", label: "Helsinki" },
  { id: "Africa/Cairo", label: "Cairo" },
  { id: "Africa/Johannesburg", label: "Johannesburg" },
  { id: "Asia/Jerusalem", label: "Jerusalem" },
  { id: "Europe/Istanbul", label: "Istanbul" },
  { id: "Europe/Moscow", label: "Moscow" },
  { id: "Asia/Riyadh", label: "Riyadh" },
  { id: "Africa/Nairobi", label: "Nairobi" },
  { id: "Asia/Tehran", label: "Tehran" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Kabul", label: "Kabul" },
  { id: "Asia/Karachi", label: "Karachi" },
  { id: "Asia/Kolkata", label: "Kolkata" },
  { id: "Asia/Kathmandu", label: "Kathmandu" },
  { id: "Asia/Dhaka", label: "Dhaka" },
  { id: "Asia/Yangon", label: "Yangon" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh" },
  { id: "Asia/Jakarta", label: "Jakarta" },
  { id: "Asia/Shanghai", label: "Shanghai" },
  { id: "Asia/Hong_Kong", label: "Hong Kong" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Taipei", label: "Taipei" },
  { id: "Asia/Manila", label: "Manila" },
  { id: "Australia/Perth", label: "Perth" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Asia/Seoul", label: "Seoul" },
  { id: "Australia/Adelaide", label: "Adelaide" },
  { id: "Australia/Brisbane", label: "Brisbane" },
  { id: "Australia/Sydney", label: "Sydney" },
  { id: "Pacific/Auckland", label: "Auckland" },
];

type Parts = { y: number; mo: number; d: number; dow: number; h: number; mi: number; s: number };

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function parts(t: number, tz: string): Parts {
  const date = new Date(t * 1000);
  if (tz === "local") {
    return {
      y: date.getFullYear(), mo: date.getMonth(), d: date.getDate(), dow: date.getDay(),
      h: date.getHours(), mi: date.getMinutes(), s: date.getSeconds(),
    };
  }
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric",
      weekday: "short", hour: "numeric", minute: "numeric", second: "numeric",
    });
    fmtCache.set(tz, f);
  }
  const o: Record<string, string> = {};
  for (const p of f.formatToParts(date)) o[p.type] = p.value;
  return {
    y: +o.year, mo: +o.month - 1, d: +o.day, dow: DAYS.indexOf(o.weekday),
    h: +o.hour % 24, mi: +o.minute, s: +o.second,
  };
}

function fmtDate(p: Parts, f: DateFormat): string {
  const yy = String(p.y).slice(2);
  switch (f) {
    case "dd MMM yyyy": return `${p.d} ${MONTHS[p.mo]} ${p.y}`;
    case "MMM dd, yyyy": return `${MONTHS[p.mo]} ${p.d}, ${p.y}`;
    case "dd-MM-yyyy": return `${p2(p.d)}-${p2(p.mo + 1)}-${p.y}`;
    case "yyyy-MM-dd": return `${p.y}-${p2(p.mo + 1)}-${p2(p.d)}`;
    case "MM/dd/yy": return `${p2(p.mo + 1)}/${p2(p.d)}/${yy}`;
    default: return `${p.d} ${MONTHS[p.mo]} '${yy}`;
  }
}

function fmtTime(p: Parts, hours: "24" | "12", secs = false): string {
  const s = secs ? `:${p2(p.s)}` : "";
  if (hours === "24") return `${p2(p.h)}:${p2(p.mi)}${s}`;
  return `${p.h % 12 || 12}:${p2(p.mi)}${s} ${p.h < 12 ? "AM" : "PM"}`;
}

/** Ví dụ ngày cho dropdown "Date format" (cùng mốc như TradingView). */
export const sampleDate = (f: DateFormat) =>
  fmtDate({ y: 1997, mo: 8, d: 29, dow: 1, h: 0, mi: 0, s: 0 }, f);

/** Nhãn crosshair trên trục thời gian: "Mon 19 Oct '26  23:15". */
export function crosshairLabel(t: number): string {
  const s = useSettingsStore.getState().s;
  const p = parts(t, s.timezone);
  return `${s.dayOfWeek ? `${DAYS[p.dow]} ` : ""}${fmtDate(p, s.dateFormat)}  ${fmtTime(p, s.hours)}`;
}

// TickMarkType: 0 Year, 1 Month, 2 DayOfMonth, 3 Time, 4 TimeWithSeconds
export function tickLabel(t: number, type: number): string {
  const s = useSettingsStore.getState().s;
  const p = parts(t, s.timezone);
  if (type === 0) return String(p.y);
  if (type === 1) return MONTHS[p.mo];
  if (type === 2) return String(p.d);
  return fmtTime(p, s.hours);
}

/** Khoá ngày "2026-10-22" của thời điểm `t` (giây) theo múi giờ trong Settings: nhóm lịch kinh tế theo ngày. */
export function dayKeyAt(t: number): string {
  const p = parts(t, useSettingsStore.getState().s.timezone);
  return `${p.y}-${p2(p.mo + 1)}-${p2(p.d)}`;
}

/** "Thu 22 Oct" theo múi giờ trong Settings. */
export function dayLabelAt(t: number): string {
  const p = parts(t, useSettingsStore.getState().s.timezone);
  return `${DAYS[p.dow]} ${p.d} ${MONTHS[p.mo]}`;
}

/** Giờ trong ngày "14:30" (hoặc "2:30 PM") theo Settings (múi giờ + định dạng 12/24h). */
export function clockAt(t: number): string {
  const s = useSettingsStore.getState().s;
  return fmtTime(parts(t, s.timezone), s.hours);
}

/** 00:00 của ngày chứa `t` theo múi giờ trong Settings (epoch giây). Không tính giờ mùa hè đổi giữa ngày (sai tối đa 1 giờ vào đúng ngày đổi). */
export function startOfDayAt(t: number): number {
  const p = parts(t, useSettingsStore.getState().s.timezone);
  return t - (p.h * 3600 + p.mi * 60 + p.s);
}

/** 00:00 thứ Hai của tuần chứa `t` theo múi giờ trong Settings. */
export function startOfWeekAt(t: number): number {
  const p = parts(t, useSettingsStore.getState().s.timezone);
  return startOfDayAt(t) - ((p.dow + 6) % 7) * 86400;
}

/** Lệch giờ so với UTC của `tz` tại thời điểm `t` (giây), tính bằng phút (UTC+5:45 → 345). */
export function tzOffsetMinutes(tz: string, t = Date.now() / 1000): number {
  const p = parts(t, tz);
  return Math.round((Date.UTC(p.y, p.mo, p.d, p.h, p.mi) / 1000 - Math.floor(t / 60) * 60) / 60);
}

/** "UTC+7", "UTC-5", "UTC+5:30"; đúng UTC thì chỉ "UTC" (như TradingView). */
export function tzOffsetLabel(tz: string, t = Date.now() / 1000): string {
  const m = tzOffsetMinutes(tz, t);
  if (m === 0) return "UTC";
  const a = Math.abs(m);
  return `UTC${m < 0 ? "-" : "+"}${Math.floor(a / 60)}${a % 60 ? `:${p2(a % 60)}` : ""}`;
}

/** Danh sách múi giờ cho dropdown: "Giờ máy" và UTC đứng đầu, còn lại theo mức lệch HIỆN TẠI (có giờ mùa hè) rồi theo tên, như TradingView. */
export function sortedTimezones(t = Date.now() / 1000): typeof TIMEZONES {
  const rest = TIMEZONES.slice(2).map((z) => [z, tzOffsetMinutes(z.id, t)] as const);
  rest.sort((a, b) => a[1] - b[1] || a[0].label.localeCompare(b[0].label));
  return [...TIMEZONES.slice(0, 2), ...rest.map(([z]) => z)];
}

/** Dòng trong dropdown múi giờ: "UTC", "(UTC+7) Bangkok". */
export const tzMenuLabel = (z: { id: string; label: string }, t = Date.now() / 1000) => (z.id === "UTC" ? "UTC" : `(${tzOffsetLabel(z.id, t)}) ${z.label}`);

/** Đồng hồ thanh dưới chart: "20:43:07 UTC+7". */
export function clockLabel(nowMs: number): string {
  const s = useSettingsStore.getState().s;
  const t = nowMs / 1000;
  return `${fmtTime(parts(t, s.timezone), s.hours, true)} ${tzOffsetLabel(s.timezone, t)}`;
}
