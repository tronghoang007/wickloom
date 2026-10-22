"use client";

import { eventClock, filterEvents, fmtEventValue, groupByDay, impactClass, IMPORTANCE_COLOR, IMPORTANCE_NAME, isSoon, shortEventName, type CalEvent } from "@/lib/calendarFormat";
import { clockAt, startOfDayAt, startOfWeekAt } from "@/lib/timefmt";
import { CURRENCY_FLAG, symbolCurrencies } from "@/lib/symbolIcon";
import { useChartStore } from "@/store/chart";
import { useSettingsStore } from "@/store/settings";
import { useCalendarPrefs, useCalendarStore, type CalendarPreset } from "@/store/calendar";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlagBadge } from "../SymbolIcon";

const PRESETS: { id: CalendarPreset; label: string }[] = [
  { id: "today", label: "Today" },
  { id: "tomorrow", label: "Tomorrow" },
  { id: "week", label: "This week" },
  { id: "next", label: "Next week" },
];
const IMPORTANCE: { v: 1 | 2 | 3; label: string }[] = [
  { v: 1, label: "All" },
  { v: 2, label: "Medium+" },
  { v: 3, label: "High" },
];
const MAJORS = ["USD", "EUR", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "CNY"];
const POLL_MS = 60_000;
const STALE_SEC = 20 * 60; // EA lâu hơn thế chưa gửi lại lịch (khi đang online) thì cảnh báo dữ liệu cũ

/** Cửa sổ [from, to) của bộ lọc ngày, theo múi giờ trong Settings. */
function rangeFor(preset: CalendarPreset, now: number): [number, number] {
  const day = startOfDayAt(now);
  if (preset === "today") return [day, day + 86400];
  if (preset === "tomorrow") return [day + 86400, day + 2 * 86400];
  const week = startOfWeekAt(now);
  return preset === "week" ? [week, week + 7 * 86400] : [week + 7 * 86400, week + 14 * 86400];
}

const flagOf = (e: CalEvent) => CURRENCY_FLAG[e.currency] ?? e.country;

function Importance({ level }: { level: number }) {
  return (
    <span className="flex shrink-0 items-end gap-[2px]" title={`Importance: ${IMPORTANCE_NAME[level]}`} aria-label={`Importance ${IMPORTANCE_NAME[level]}`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className="w-[3px] rounded-sm" style={{ height: 4 + i * 3, background: i <= level ? IMPORTANCE_COLOR[level] : "var(--border)" }} />
      ))}
    </span>
  );
}

function Value({ label, text, cls = "" }: { label: string; text: string; cls?: string }) {
  return (
    <span className="flex min-w-0 items-baseline gap-1">
      <span className="text-[10px] uppercase text-[var(--muted)]">{label}</span>
      <span className={`tabular-nums ${cls}`}>{text}</span>
    </span>
  );
}

function Row({ e, now }: { e: CalEvent; now: number }) {
  const soon = isSoon(e, now);
  const released = e.actual !== null;
  return (
    <div className={`flex gap-2.5 border-b border-[var(--border)] px-3 py-2 text-[13px] ${soon ? "bg-[color-mix(in_srgb,var(--accent)_10%,transparent)]" : ""}`} style={soon ? { boxShadow: "inset 2px 0 0 var(--accent)" } : undefined} data-testid="calendar-row">
      <div className="h-[18px] w-[52px] shrink-0 text-xs leading-[18px] tabular-nums text-[var(--muted)]">{eventClock(e)}</div>
      <div className="flex h-[18px] w-12 shrink-0 items-center gap-1 self-start text-xs font-medium">
        <FlagBadge code={flagOf(e)} size={16} />
        {e.currency}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <span className="min-w-0 flex-1 leading-snug text-[var(--fg)]" title={e.name}>
            {shortEventName(e.name)}
          </span>
          <Importance level={e.importance} />
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
          {released && <Value label="A" text={fmtEventValue(e.actual, e)} cls={`font-semibold ${impactClass(e.impact)}`} />}
          <Value label="F" text={fmtEventValue(e.forecast, e)} />
          <Value label="P" text={fmtEventValue(e.revised ?? e.previous, e)} cls={e.revised !== null ? "text-[#ff9800]" : ""} />
        </div>
      </div>
    </div>
  );
}

const chip = (on: boolean) => `h-7 cursor-pointer rounded-full px-3 text-xs transition-colors ${on ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--hover)] text-[var(--fg)] hover:brightness-125"}`;

/** Lịch kinh tế ở thanh bên phải. Dữ liệu là lịch có sẵn của MT5 do EA TVBridge (>= 2.15) đẩy lên backend (cache SQLite): không phụ thuộc mạng ngoài / widget TradingView.
 *  Lọc theo ngày, mức quan trọng, đồng tiền (mặc định mọi đồng; "Symbol" = các đồng của symbol đang xem); giờ theo múi giờ trong Settings. Tự làm mới mỗi phút. */
export default function EconomicCalendarPanel() {
  const prefs = useCalendarPrefs();
  const symbol = useChartStore((s) => s.symbol);
  const symInfo = useChartStore((s) => s.symbols.find((x) => x.name === s.symbol));
  const { events, updatedAt, ea, error, loaded, ensure } = useCalendarStore();
  useSettingsStore((s) => `${s.s.timezone}|${s.s.hours}`); // đổi múi giờ / 12-24h thì vẽ lại giờ và ranh giới ngày
  const [now, setNow] = useState(() => Date.now() / 1000);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 30_000);
    return () => clearInterval(t);
  }, []);

  const [from, to] = useMemo(() => rangeFor(prefs.preset, now), [prefs.preset, now]);
  useEffect(() => {
    void ensure(from, to);
    const t = setInterval(() => void ensure(from, to, true), POLL_MS);
    return () => clearInterval(t);
  }, [from, to, ensure]);

  const symCurrencies = useMemo(() => symbolCurrencies(symbol, symInfo?.type), [symbol, symInfo?.type]);
  // Chỉ lịch SẮP TỚI (từ bây giờ): sự kiện đã qua trong ngày / tuần không hiện
  const inRange = useMemo(() => events.filter((e) => e.time >= Math.max(from, now) && e.time < to), [events, from, to, now]);
  const shown = useMemo(
    () => filterEvents(inRange, { minImportance: prefs.minImportance, currencies: prefs.currency === "all" ? null : prefs.currency === "symbol" ? symCurrencies : [prefs.currency] }),
    [inRange, prefs.minImportance, prefs.currency, symCurrencies],
  );
  const groups = useMemo(() => groupByDay(shown, now), [shown, now]);

  const empty = (() => {
    if (!loaded) return error ? "Không kết nối được backend." : "Đang tải lịch…";
    if (updatedAt === null) {
      if (ea && ea.online && !ea.supports) return `EA đang chạy bản ${ea.version ?? "cũ"} chưa gửi được lịch. Biên dịch lại TVBridge ≥ 2.15 (F7 trong MetaEditor) rồi gắn lại EA.`;
      if (ea && !ea.online) return "Chưa có dữ liệu: EA chưa kết nối. Lịch kinh tế lấy từ MT5 qua EA TVBridge.";
      return "EA chưa gửi lịch. Lịch kinh tế của MT5 có thể chưa đồng bộ (mở tab Calendar trong MT5 một lần) hoặc broker không cung cấp.";
    }
    return inRange.length === 0 ? "Không còn sự kiện sắp tới trong khoảng này." : "Không có sự kiện khớp bộ lọc (thử hạ mức quan trọng hoặc chọn mọi đồng tiền).";
  })();
  // Mở bảng / đổi khoảng ngày: cuộn tới nhóm "Today" (hoặc sự kiện đầu tiên) thay vì để ở đầu tuần
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef("");
  useEffect(() => {
    const box = scroller.current;
    if (!box || groups.length === 0) return;
    const sig = `${prefs.preset}|${prefs.minImportance}|${prefs.currency}`;
    if (scrolledFor.current === sig) return;
    scrolledFor.current = sig;
    const today = box.querySelector<HTMLElement>('[data-today="true"]');
    box.scrollTop = today ? today.offsetTop - 2 : 0;
  }, [groups, prefs.preset, prefs.minImportance, prefs.currency]);
  const stale = updatedAt !== null && ea?.online === true && now - updatedAt > STALE_SEC;

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="economic-calendar">
      <div className="shrink-0 space-y-2 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" aria-pressed={prefs.preset === p.id} className={chip(prefs.preset === p.id)} onClick={() => prefs.set({ preset: p.id })}>
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          {IMPORTANCE.map((i) => (
            <button key={i.v} type="button" aria-pressed={prefs.minImportance === i.v} className={chip(prefs.minImportance === i.v)} onClick={() => prefs.set({ minImportance: i.v })}>
              {i.label}
            </button>
          ))}
          <select
            aria-label="Currency"
            value={prefs.currency}
            onChange={(e) => prefs.set({ currency: e.target.value })}
            className="ml-auto h-7 w-[136px] rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-xs text-[var(--fg)] outline-none focus:border-[var(--accent)]"
          >
            <option value="all">All currencies</option>
            <option value="symbol">{`Symbol (${symCurrencies.join(", ")})`}</option>
            {MAJORS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        {groups.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-[var(--muted)]" role="status">
            {empty}
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.key} data-today={g.label.startsWith("Today") ? "true" : undefined}>
              <div className="sticky top-0 z-10 bg-[var(--panel)] px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">{g.label}</div>
              {g.events.map((e) => (
                <Row key={e.id} e={e} now={now} />
              ))}
            </section>
          ))
        )}
      </div>
      <div className="shrink-0 border-t border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--muted)]">
        {updatedAt !== null ? (
          <span className={stale ? "text-[#ff9800]" : ""}>
            Nguồn: lịch MT5 qua EA · cập nhật {clockAt(updatedAt)}
            {stale ? " (cũ: EA chưa gửi lại)" : ""}
          </span>
        ) : (
          "Nguồn: lịch MT5 qua EA TVBridge"
        )}
        {error && loaded ? " · lỗi tải, hiện bản đã lưu" : ""}
      </div>
    </div>
  );
}
