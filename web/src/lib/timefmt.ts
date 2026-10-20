import { useSettingsStore, type DateFormat } from "@/store/settings";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const p2 = (n: number) => String(n).padStart(2, "0");

export const TIMEZONES: { id: string; label: string }[] = [
  { id: "local", label: "Giờ máy" },
  { id: "UTC", label: "UTC" },
  { id: "America/New_York", label: "New York" },
  { id: "America/Chicago", label: "Chicago" },
  { id: "Europe/London", label: "London" },
  { id: "Europe/Berlin", label: "Berlin" },
  { id: "Asia/Dubai", label: "Dubai" },
  { id: "Asia/Bangkok", label: "Bangkok" },
  { id: "Asia/Ho_Chi_Minh", label: "Ho Chi Minh" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Asia/Hong_Kong", label: "Hong Kong" },
  { id: "Asia/Tokyo", label: "Tokyo" },
  { id: "Australia/Sydney", label: "Sydney" },
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

/** Lệch giờ so với UTC của `tz` tại thời điểm `t` (giây), vd "UTC+7". */
export function tzOffsetLabel(tz: string, t = Date.now() / 1000): string {
  const p = parts(t, tz);
  const off = Math.round((Date.UTC(p.y, p.mo, p.d, p.h, p.mi) / 1000 - Math.floor(t / 60) * 60) / 3600 * 2) / 2;
  return `UTC${off >= 0 ? "+" : ""}${off}`;
}

/** Đồng hồ thanh dưới chart: "20:43:07 UTC+7". */
export function clockLabel(nowMs: number): string {
  const s = useSettingsStore.getState().s;
  const t = nowMs / 1000;
  return `${fmtTime(parts(t, s.timezone), s.hours, true)} ${tzOffsetLabel(s.timezone, t)}`;
}
