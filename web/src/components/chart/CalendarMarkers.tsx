"use client";

import type { IChartApi, Logical } from "lightweight-charts";
import { TF_SECONDS } from "@/lib/api";
import { eventClock, filterEvents, fmtEventValue, IMPORTANCE_COLOR, impactClass, shortEventName, type CalEvent } from "@/lib/calendarFormat";
import { CURRENCY_FLAG, symbolCurrencies } from "@/lib/symbolIcon";
import { chartGlobal } from "@/store/chart";
import { useCalendarStore } from "@/store/calendar";
import { useSettingsStore } from "@/store/settings";
import { indexAt } from "@/store/paneSync";
import { drawingGlobal } from "@/drawings/store";
import { useEffect, useMemo, useRef, useState } from "react";
import { FlagBadge } from "../SymbolIcon";

const SIZE = 18;
const GAP_PX = 20; // hai biểu tượng gần hơn thế thì gộp thành một (bấm vào thẻ chi tiết liệt kê hết)
const AXIS_GAP = 6; // cách mép trên của trục thời gian
const WINDOW_SEC = 30 * 86400; // tải lịch quanh hôm nay ±30 ngày (backend giữ ~45 ngày quá khứ, 14 ngày tới), một lần cho mọi chart
const REFRESH_MS = 120_000;

/** Toạ độ x của chỉ số logic THỰC: `logicalToCoordinate` của LWC trả 0 cho số không nguyên, nên nội suy giữa hai nến liền kề (sự kiện nằm giữa nến, hoặc sau nến cuối). */
function xAt(ts: ReturnType<IChartApi["timeScale"]>, idx: number): number | null {
  const lo = Math.floor(idx);
  const a = ts.logicalToCoordinate(lo as Logical);
  if (a === null) return null;
  const frac = idx - lo;
  if (frac < 1e-6) return a as number;
  const b = ts.logicalToCoordinate((lo + 1) as Logical);
  return b === null ? (a as number) : (a as number) + ((b as number) - (a as number)) * frac;
}

type Mark = { x: number; events: CalEvent[]; level: number };
type Props = {
  symbol: string;
  tf: string;
  replay: boolean; // đang Replay: không hiện sự kiện sau nến đang chạy (lộ kết quả)
  getChart: () => IChartApi | null;
  getBars: () => readonly { t: number }[];
  getReplayEnd?: () => number | undefined; // con trỏ Replay: nến cuối có thể mới chạy dở tới đây
};

/** Biểu tượng sự kiện kinh tế trên chart kiểu TradingView: lá cờ tròn của quốc gia, viền theo mức quan trọng (đỏ cao / cam vừa / vàng thấp), nằm sát trục thời gian tại giờ công bố;
 *  CHỈ sự kiện sắp tới (từ bây giờ): sự kiện đã qua không vẽ; nhiều sự kiện cùng chỗ gộp thành một (không đánh số); BẤM vào ra thẻ chi tiết (giờ, tên, dự báo / kỳ trước), bấm ra ngoài hoặc Esc để đóng. Chỉ hiện sự kiện của các đồng tiền của symbol đang xem;
 *  bật / tắt và mức quan trọng ở Settings > Events. Vị trí tính lại khi cuộn / zoom / đổi dữ liệu (đọc mỗi khung hình vì chart không báo mọi thay đổi). */
export default function CalendarMarkers({ symbol, tf, replay, getChart, getBars, getReplayEnd }: Props) {
  const show = useSettingsStore((s) => s.s.showEvents);
  const minImportance = useSettingsStore((s) => s.s.eventsMinImportance);
  const events = useCalendarStore((s) => s.events);
  const ensure = useCalendarStore((s) => s.ensure);
  const type = chartGlobal((s) => s.symbols.find((x) => x.name === symbol)?.type);
  const tool = drawingGlobal((s) => s.tool);
  const currencies = useMemo(() => symbolCurrencies(symbol, type), [symbol, type]);
  const candidates = useMemo(() => filterEvents(events, { minImportance, currencies }), [events, minImportance, currencies]);

  const [marks, setMarks] = useState<Mark[]>([]);
  const [axisH, setAxisH] = useState(28);
  const [width, setWidth] = useState(0);
  const [selected, setSelected] = useState<number | null>(null); // id của sự kiện đầu tiên của cụm đang mở (theo id để cụm vẫn đúng khi vị trí tính lại)
  const candRef = useRef<CalEvent[]>([]);
  const sigRef = useRef("");
  useEffect(() => {
    candRef.current = candidates;
    sigRef.current = ""; // dữ liệu / bộ lọc đổi: tính lại ngay
  }, [candidates, replay, tf]);

  useEffect(() => {
    if (selected === null) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(e.target instanceof Element && e.target.closest("[data-calendar-ui]"))) setSelected(null);
    };
    window.addEventListener("pointerdown", close, true);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close, true);
      window.removeEventListener("keydown", close);
    };
  }, [selected]);

  useEffect(() => {
    if (!show) return;
    const load = (force: boolean) => {
      const now = Date.now() / 1000;
      void ensure(now - WINDOW_SEC, now + WINDOW_SEC, force);
    };
    load(false);
    const t = setInterval(() => load(true), REFRESH_MS);
    return () => clearInterval(t);
  }, [show, ensure]);

  useEffect(() => {
    if (!show) return;
    const tfSec = TF_SECONDS[tf] ?? 60;
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const chart = getChart();
      const bars = getBars();
      if (!chart || bars.length === 0) return;
      const ts = chart.timeScale();
      const range = ts.getVisibleLogicalRange();
      if (!range) return;
      const w = ts.width();
      const nowSec = Date.now() / 1000;
      // Replay: hết dữ liệu ở con trỏ (nến cuối chạy dở thì trước cuối nến), sự kiện từ đó trở đi là tương lai
      const lastT = (replay ? getReplayEnd?.() : undefined) ?? bars[bars.length - 1].t + tfSec;
      const sig = `${range.from.toFixed(2)}|${range.to.toFixed(2)}|${w}|${bars.length}|${lastT}|${ts.height()}|${Math.floor(nowSec / 30)}`; // mỗi 30s tính lại để sự kiện vừa qua biến mất
      if (sig === sigRef.current) return;
      sigRef.current = sig;
      const pts: { x: number; e: CalEvent }[] = [];
      for (const e of candRef.current) {
        if (e.time < nowSec) continue; // đã qua: bỏ
        if (replay && e.time >= lastT) continue;
        const idx = indexAt(bars, tfSec, e.time);
        if (idx === null || idx < range.from - 2 || idx > range.to + 2) continue;
        const x = xAt(ts, idx);
        if (x === null || x < SIZE / 2 || x > w - SIZE / 2) continue;
        pts.push({ x, e });
      }
      pts.sort((a, b) => a.x - b.x);
      const out: Mark[] = [];
      for (const p of pts) {
        const m = out[out.length - 1];
        if (m && p.x - m.x < GAP_PX) {
          m.events.push(p.e);
          m.level = Math.max(m.level, p.e.importance);
        } else out.push({ x: p.x, events: [p.e], level: p.e.importance });
      }
      for (const m of out) m.events.sort((a, b) => b.importance - a.importance || a.time - b.time);
      setMarks(out);
      setAxisH(ts.height());
      setWidth(w);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [show, tf, replay, getChart, getBars, getReplayEnd]);

  if (!show || marks.length === 0) return null;
  const bottom = axisH + AXIS_GAP;
  const opened = selected !== null ? marks.find((m) => m.events.some((e) => e.id === selected)) : undefined;
  return (
    <div className="pointer-events-none absolute inset-0 z-[4] overflow-hidden" data-testid="calendar-markers">
      {marks.map((m) => {
        const e = m.events[0];
        return (
          <button
            key={`${e.id}:${m.events.length}`}
            type="button"
            aria-label={`${m.events.length} economic event${m.events.length > 1 ? "s" : ""}: ${shortEventName(e.name, e.country)}`}
            aria-expanded={opened === m}
            data-testid="calendar-marker"
            data-calendar-ui
            className={`${tool ? "pointer-events-none" : "pointer-events-auto"} absolute cursor-pointer rounded-full`}
            style={{ left: m.x - SIZE / 2, bottom, width: SIZE, height: SIZE, boxShadow: `0 0 0 2px ${IMPORTANCE_COLOR[m.level]}, 0 0 0 3.5px var(--bg)` }}
            onClick={() => setSelected((cur) => (cur === e.id ? null : e.id))}
          >
            <FlagBadge code={CURRENCY_FLAG[e.currency] ?? e.country} size={SIZE} />
          </button>
        );
      })}
      {opened && (
        <div
          data-calendar-ui
          className="pointer-events-auto absolute max-h-[60%] w-[270px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel)] p-2.5 text-xs shadow-xl"
          style={{ left: Math.max(4, Math.min(width - 274, opened.x - 135)), bottom: bottom + SIZE + 8 }}
          role="dialog"
          aria-label="Economic events"
        >
          {opened.events.map((e) => (
            <div key={e.id} className="mb-2 last:mb-0">
              <div className="flex items-center gap-1.5">
                <FlagBadge code={CURRENCY_FLAG[e.currency] ?? e.country} size={14} />
                <span className="font-semibold">{e.currency}</span>
                <span className="tabular-nums text-[var(--muted)]">{eventClock(e)}</span>
                <span className="ml-auto h-2 w-2 rounded-full" style={{ background: IMPORTANCE_COLOR[e.importance] }} />
              </div>
              <div className="mt-0.5 leading-snug" title={e.name}>
                {shortEventName(e.name, e.country)}
              </div>
              <div className="mt-0.5 flex gap-3 tabular-nums text-[var(--muted)]">
                {e.actual !== null && (
                  <span>
                    A <span className={`font-semibold ${impactClass(e.impact)}`}>{fmtEventValue(e.actual, e)}</span>
                  </span>
                )}
                <span>
                  F <span className="text-[var(--fg)]">{fmtEventValue(e.forecast, e)}</span>
                </span>
                <span>
                  P <span className="text-[var(--fg)]">{fmtEventValue(e.revised ?? e.previous, e)}</span>
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
