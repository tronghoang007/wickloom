import { apiFetch } from "./api";
import type { CalEvent, CalendarEa } from "./calendarFormat";

export type CalendarResponse = { events: CalEvent[]; updated_at: number | null; ea: CalendarEa; now: number };

/** Sự kiện kinh tế trong [from, to] (epoch giây). Backend đọc từ cache SQLite (EA gửi lên), không gọi mạng ngoài. Lỗi mạng / HTTP → null. */
export async function fetchCalendar(from: number, to: number): Promise<CalendarResponse | null> {
  try {
    const res = await apiFetch(`/calendar?from=${Math.floor(from)}&to=${Math.floor(to)}`);
    return res.ok ? ((await res.json()) as CalendarResponse) : null;
  } catch {
    return null;
  }
}
