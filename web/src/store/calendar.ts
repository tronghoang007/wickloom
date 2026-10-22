import { fetchCalendar } from "@/lib/calendarApi";
import { mergeWindow, type CalEvent, type CalendarEa } from "@/lib/calendarFormat";
import { create } from "zustand";
import { persist } from "zustand/middleware";

// Kho lịch kinh tế dùng chung cho bảng ở thanh bên phải và biểu tượng trên chart (một lần tải phục vụ cả hai). Dữ liệu từ backend (EA đẩy lên, cache SQLite).
const FRESH_MS = 60_000; // trong ngần này thì không tải lại cùng cửa sổ

type State = {
  events: CalEvent[];
  updatedAt: number | null; // lần cuối EA gửi lịch lên backend
  ea: CalendarEa | null;
  error: boolean; // lần tải gần nhất lỗi mạng / HTTP
  loaded: boolean; // đã có ít nhất một phản hồi
  /** Bảo đảm đã có sự kiện của [from, to] (giây): tải nếu chưa phủ cửa sổ hoặc đã cũ hơn FRESH_MS; `force` luôn tải. */
  ensure: (from: number, to: number, force?: boolean) => Promise<void>;
};

const fetched = new Map<string, number>(); // "from|to" → lúc tải xong (ms)
const inflight = new Map<string, Promise<void>>();

export const useCalendarStore = create<State>()((set, get) => ({
  events: [],
  updatedAt: null,
  ea: null,
  error: false,
  loaded: false,
  ensure: (from, to, force = false) => {
    const key = `${Math.floor(from)}|${Math.floor(to)}`;
    const at = fetched.get(key);
    if (!force && at !== undefined && Date.now() - at < FRESH_MS) return Promise.resolve();
    const running = inflight.get(key);
    if (running) return running;
    const p = fetchCalendar(from, to)
      .then((r) => {
        if (!r) return set({ error: true });
        fetched.set(key, Date.now());
        set({ events: mergeWindow(get().events, r.events, Math.floor(from), Math.floor(to)), updatedAt: r.updated_at, ea: r.ea, error: false, loaded: true });
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, p);
    return p;
  },
}));

export type CalendarPreset = "today" | "tomorrow" | "week" | "next";
export type CalendarPrefs = {
  preset: CalendarPreset;
  minImportance: 1 | 2 | 3;
  /** "all" = mọi đồng tiền, "symbol" = đồng tiền của symbol đang xem, hoặc một mã (USD, EUR…). */
  currency: string;
  set: (p: Partial<Omit<CalendarPrefs, "set">>) => void;
};

export const useCalendarPrefs = create<CalendarPrefs>()(
  persist(
    (set) => ({
      preset: "week",
      minImportance: 2,
      currency: "all",
      set: (p) => set(p),
    }),
    { name: "wickloom-calendar-prefs", partialize: (s) => ({ preset: s.preset, minImportance: s.minImportance, currency: s.currency }) },
  ),
);
