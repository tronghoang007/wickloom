import { clockAt, dayKeyAt, dayLabelAt } from "./timefmt";

// Lịch kinh tế (docs/calendar-plan.md): kiểu dữ liệu `GET /calendar` + hàm thuần để định dạng / nhóm / lọc. Số liệu do EA đọc từ lịch của MT5; đơn vị, hệ số, mức quan trọng
// là enum của MQL5 (ENUM_CALENDAR_EVENT_UNIT / _MULTIPLIER / _IMPORTANCE / _IMPACT / _TIMEMODE).

export type CalEvent = {
  id: number;
  time: number; // epoch giây UTC
  event_id: number;
  country: string; // "US"
  currency: string; // "USD"
  name: string;
  importance: number; // 0 không / 1 thấp / 2 vừa / 3 cao
  unit: number;
  multiplier: number; // 0 trơn, 1 nghìn (K), 2 triệu (M), 3 tỷ (B), 4 nghìn tỷ (T)
  digits: number;
  time_mode: number; // 0 có giờ, 1 cả ngày, 2 không giờ, 3 dự kiến
  impact: number; // 0 không rõ, 1 số thực tốt hơn dự báo cho đồng tiền, 2 xấu hơn
  actual: number | null;
  forecast: number | null;
  previous: number | null;
  revised: number | null;
};

export type CalendarEa = { online: boolean; version: string | null; supports: boolean };

export const IMPORTANCE_NAME = ["None", "Low", "Medium", "High"] as const;
export const IMPORTANCE_COLOR = ["#787b86", "#fdd835", "#ff9800", "#f23645"] as const;

const MULT = ["", "K", "M", "B", "T"];
const UNIT_SUFFIX: Record<number, string> = { 1: "%" }; // ENUM_CALENDAR_EVENT_UNIT: 1 = phần trăm; các đơn vị khác (người, thùng, việc làm…) để trần như TV

/** "3.8%", "200K", "−0.5%", "—" khi chưa có số. */
export function fmtEventValue(v: number | null, e: Pick<CalEvent, "digits" | "multiplier" | "unit">): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v.toFixed(Math.max(0, Math.min(8, e.digits)))}${MULT[e.multiplier] ?? ""}${UNIT_SUFFIX[e.unit] ?? ""}`;
}

/** Màu số thực theo `impact` của MT5: tốt hơn dự báo cho đồng tiền = xanh, xấu hơn = đỏ, không rõ = màu chữ thường. */
export const impactClass = (impact: number) => (impact === 1 ? "text-[#089981]" : impact === 2 ? "text-[#f23645]" : "");

/** Nhãn giờ của sự kiện: "14:30", hoặc "All day" / "Tentative" / "—" theo time_mode. */
export function eventClock(e: Pick<CalEvent, "time" | "time_mode">): string {
  if (e.time_mode === 1) return "All day";
  if (e.time_mode === 3) return "Tentative";
  if (e.time_mode === 2) return "—";
  return clockAt(e.time);
}

export type DayGroup = { key: string; label: string; events: CalEvent[] };

/** Nhóm theo ngày (múi giờ trong Settings), nhãn "Today" / "Tomorrow" / "Yesterday" kèm ngày. Giữ thứ tự đã có (backend sắp theo giờ). */
export function groupByDay(events: readonly CalEvent[], nowSec: number): DayGroup[] {
  const today = dayKeyAt(nowSec);
  const rel: Record<string, string> = { [dayKeyAt(nowSec - 86400)]: "Yesterday", [today]: "Today", [dayKeyAt(nowSec + 86400)]: "Tomorrow" };
  const out: DayGroup[] = [];
  for (const e of events) {
    const key = dayKeyAt(e.time);
    let g = out[out.length - 1];
    if (!g || g.key !== key) {
      g = { key, label: `${rel[key] ? `${rel[key]} · ` : ""}${dayLabelAt(e.time)}`, events: [] };
      out.push(g);
    }
    g.events.push(e);
  }
  return out;
}

/** Sắp tới trong `withinSec` giây (mặc định 30 phút) và chưa có số thực. */
export const isSoon = (e: Pick<CalEvent, "time" | "actual">, nowSec: number, withinSec = 1800) => e.actual === null && e.time >= nowSec && e.time - nowSec <= withinSec;

export type CalFilter = { minImportance: number; currencies: readonly string[] | null };

export function filterEvents(events: readonly CalEvent[], f: CalFilter): CalEvent[] {
  return events.filter((e) => e.importance >= f.minImportance && (!f.currencies || f.currencies.length === 0 || f.currencies.includes(e.currency)));
}

/** Gộp sự kiện vừa tải vào kho: thay hết sự kiện trong cửa sổ [lo, hi] bằng bản mới (sự kiện bị huỷ biến mất), giữ phần ngoài cửa sổ. Kết quả sắp theo giờ. */
export function mergeWindow(old: readonly CalEvent[], fresh: readonly CalEvent[], lo: number, hi: number): CalEvent[] {
  const kept = old.filter((e) => e.time < lo || e.time > hi);
  return [...kept, ...fresh].sort((a, b) => a.time - b.time || b.importance - a.importance || a.id - b.id);
}

// Tên sự kiện của MT5 hay dài ("Consumer Price Index (CPI) MoM"): rút gọn theo cách đặt tên của Forex Factory để đọc nhanh ("CPI m/m"). Bản đầy đủ vẫn nằm ở `title` khi rê chuột.
const BANK_RATE: [RegExp, string][] = [
  [/^(?:FOMC|Fed|Federal Reserve)\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "Federal Funds Rate"],
  [/^ECB\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "Main Refinancing Rate"],
  [/^(?:BoE|BOE|Bank of England)\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "Official Bank Rate"],
  [/^(?:BoJ|BOJ|Bank of Japan)\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "BOJ Policy Rate"],
  [/^RBA\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "Cash Rate"],
  [/^RBNZ\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "Official Cash Rate"],
  [/^(?:BoC|BOC|Bank of Canada)\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "BOC Rate Statement"],
  [/^SNB\b.*\b(?:Interest Rate|Rate Decision)\b.*$/i, "SNB Monetary Policy Assessment"],
];
const ABBREVIATE: [RegExp, string][] = [
  [/\b(?:Non-?farm Payrolls?|Non-?farm Employment Change)\b/i, "Non-Farm Employment Change"],
  [/\bInitial Jobless Claims\b/i, "Unemployment Claims"],
  [/\bContinuing Jobless Claims\b/i, "Continuing Claims"],
  [/\bBalance of Trade\b/i, "Trade Balance"],
  [/\bCore Personal Consumption Expenditures(?: \(PCE\))?(?: Price Index)?\b/i, "Core PCE Price Index"],
  [/\bPersonal Consumption Expenditures(?: \(PCE\))?(?: Price Index)?\b/i, "PCE Price Index"],
  [/\bConsumer Price Index(?: \(CPI\))?/i, "CPI"],
  [/\bProducer Price Index(?: \(PPI\))?/i, "PPI"],
  [/\bGross Domestic Product(?: \(GDP\))?/i, "GDP"],
  [/\bPurchasing Managers'? Index(?: \(PMI\))?/i, "PMI"],
  [/\bHarmonized Index of Consumer Prices(?: \(HICP\))?/i, "HICP"],
  [/\bManufacturing Purchasing Managers'? Index\b/i, "Manufacturing PMI"],
  [/\bAverage Hourly Earnings\b/i, "Average Hourly Earnings"],
  [/\bMoM\b/g, "m/m"],
  [/\bYoY\b/g, "y/y"],
  [/\bQoQ\b/g, "q/q"],
  [/\s*\((?:MoM|YoY|QoQ)\)/gi, ""],
];

export function shortEventName(name: string): string {
  let s = name.trim().replace(/\s+/g, " ");
  for (const [re, to] of BANK_RATE) if (re.test(s)) return to;
  for (const [re, to] of ABBREVIATE) s = s.replace(re, to);
  return s.replace(/\b(m\/m|y\/y|q\/q)\b/gi, (m) => m.toLowerCase()).replace(/\s+/g, " ").trim();
}
