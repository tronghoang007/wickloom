"use client";

import { WS_URL, fetchBars, getWatchlist, saveWatchlist, type Bar } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useChartStore } from "@/store/chart";
import { useSettingsStore } from "@/store/settings";
import { useEffect, useRef, useState } from "react";
import { Chevron, Close, Plus } from "../icons";
import { SymbolBadge } from "../SymbolIcon";
import SymbolSearchDialog from "./SymbolSearchDialog";

// Quote của 1 symbol: nến D1 mới nhất (mở/cao/thấp/giá hiện tại) + đóng cửa phiên trước. Chg =
// giá hiện tại - đóng cửa phiên trước, giống cột Chg/Chg% của watchlist TradingView.
type Quote = {
  t: number; // mở nến D1 hiện tại (epoch s)
  last: number;
  prev: number | null;
  open: number;
  high: number;
  low: number;
};

const fromBars = (bars: Bar[]): Quote | null => {
  const b = bars[bars.length - 1];
  if (!b) return null;
  return { t: b.t, last: b.c, prev: bars[bars.length - 2]?.c ?? null, open: b.o, high: b.h, low: b.l };
};

/** Giá thật cho các symbol trong watchlist: nạp 3 nến D1 gần nhất, rồi nghe `bar_update` D1 của
 *  backend (mỗi tick) qua 1 WebSocket riêng. Subscribe D1 cũng khiến EA stream tick của symbol
 *  và backend tự xin nến D1 nếu cache thiếu. */
function useQuotes(symbols: string[]) {
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const key = symbols.join(",");

  useEffect(() => {
    if (symbols.length === 0) return;
    let alive = true;
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout>;

    const load = (s: string) =>
      fetchBars(s, "D1", undefined, 3)
        .then((bars) => {
          const q = fromBars(bars);
          if (alive && q) setQuotes((cur) => ({ ...cur, [s]: q }));
        })
        .catch(() => {});

    const apply = (s: string, b: Bar) =>
      setQuotes((cur) => {
        const q = cur[s];
        if (!q) return { ...cur, [s]: fromBars([b]) ?? q };
        if (b.t < q.t) return cur;
        const next: Quote =
          b.t === q.t
            ? { ...q, last: b.c, open: b.o, high: b.h, low: b.l }
            : { t: b.t, last: b.c, prev: q.last, open: b.o, high: b.h, low: b.l }; // sang ngày mới
        return { ...cur, [s]: next };
      });

    symbols.forEach(load);

    const connect = () => {
      ws = new WebSocket(WS_URL);
      ws.onopen = () => symbols.forEach((s) => ws!.send(JSON.stringify({ action: "subscribe", symbol: s, tf: "D1" })));
      ws.onmessage = (e) => {
        const m = JSON.parse(e.data);
        if (m.type === "reset") symbols.forEach(load);
        else if (m.tf !== "D1" || !symbols.includes(m.symbol)) return;
        else if (m.type === "bar_update" || m.type === "bar_close") apply(m.symbol, m.bar);
        else if (m.type === "bars_loaded") load(m.symbol);
      };
      ws.onclose = () => {
        if (alive) retry = setTimeout(connect, 2000);
      };
    };
    connect();

    return () => {
      alive = false;
      clearTimeout(retry);
      ws?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return quotes;
}

const fmt = (n: number, d: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const sign = (n: number) => (n > 0 ? "+" : n < 0 ? "−" : "");

/** Khách: watchlist thuộc tài khoản nên thay thân panel bằng lời mời đăng nhập. loading: khung xương, không chớp nút Login. */
function WatchlistGate({ status }: { status: "loading" | "guest" }) {
  const openAuth = useAuthStore((s) => s.openAuth);
  if (status === "loading")
    return (
      <div className="space-y-2 px-4 py-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-5 animate-pulse rounded bg-[var(--hover)]" />
        ))}
      </div>
    );
  return (
    <div className="flex flex-col items-center px-6 py-10 text-center">
      <div className="text-[15px] font-semibold">Đăng nhập để dùng watchlist</div>
      <div className="mt-1 text-[13px] text-[var(--muted)]">Watchlist, layout và hình vẽ được lưu theo tài khoản Wickloom của bạn.</div>
      <div className="mt-4 flex w-full max-w-[220px] flex-col gap-2">
        <button className="h-9 rounded bg-[var(--accent)] text-sm font-semibold text-white hover:brightness-110" onClick={() => openAuth("login")}>
          Sign in
        </button>
        <button className="h-9 rounded border border-[var(--border)] text-sm hover:bg-[var(--hover)]" onClick={() => openAuth("register")}>
          Create account
        </button>
      </div>
    </div>
  );
}

export default function WatchlistPanel() {
  const set = useChartStore((s) => s.set);
  const current = useChartStore((s) => s.symbol);
  const info = useChartStore((s) => s.symbols);
  const up = useSettingsStore((s) => s.s.bodyUp);
  const down = useSettingsStore((s) => s.s.bodyDown);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const quotes = useQuotes(symbols);
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);

  // Watchlist thuộc tài khoản: đổi user / đăng xuất thì nạp lại (khách không có watchlist, không gọi server)
  useEffect(() => {
    if (status !== "user") return;
    let alive = true;
    getWatchlist().then((s) => alive && setSymbols(s));
    return () => {
      alive = false;
      setSymbols([]);
    };
  }, [status, userId]);

  const persist = (next: string[]) => {
    setSymbols(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveWatchlist(next), 500);
  };
  const add = (name: string) => {
    if (!symbols.includes(name)) persist([...symbols, name]);
  };
  const remove = (name: string) => persist(symbols.filter((s) => s !== name));

  const meta = (name: string) => info.find((x) => x.name === name);
  const digits = (name: string) => meta(name)?.digits ?? 2;
  const color = (v: number) => (v > 0 ? up : v < 0 ? down : "var(--muted)");

  const sel = symbols.includes(current) ? current : null;
  const sq = sel ? quotes[sel] : undefined;
  const sm = sel ? meta(sel) : undefined;
  const sChg = sq && sq.prev ? sq.last - sq.prev : null;

  const title = (
    <div className="flex h-10 shrink-0 items-center justify-between pl-4 pr-2">
      <span className="flex items-center gap-1 text-[14px] font-semibold">
        Watchlist
        <Chevron size={14} />
      </span>
      {status === "user" && (
        <button
          className="flex h-7 w-7 items-center justify-center rounded text-[var(--fg)] hover:bg-[var(--hover)]"
          title="Add symbol"
          onClick={() => setAdding(true)}
        >
          <Plus size={24} />
        </button>
      )}
    </div>
  );

  if (status !== "user")
    return (
      <div className="flex h-full flex-col">
        {title}
        <WatchlistGate status={status} />
      </div>
    );

  return (
    <div className="flex h-full flex-col">
      {title}

      <div className="grid shrink-0 grid-cols-[1fr_66px_54px_52px_18px] items-center gap-x-1 px-4 pb-1 text-[11px] text-[var(--muted)]">
        <span>Symbol</span>
        <span className="text-right">Last</span>
        <span className="text-right">Chg</span>
        <span className="text-right">Chg%</span>
        <span />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
        {symbols.length === 0 && (
          <div className="px-2 py-6 text-sm text-[var(--muted)]">
            Chưa có symbol trong watchlist. Bấm &quot;+&quot; để thêm.
          </div>
        )}
        {symbols.map((s) => {
          const q = quotes[s];
          const d = digits(s);
          const chg = q && q.prev ? q.last - q.prev : null;
          const pct = chg !== null && q?.prev ? (chg / q.prev) * 100 : null;
          return (
            <div
              key={s}
              onClick={() => set({ symbol: s })}
              className={`group grid h-7 cursor-pointer grid-cols-[1fr_66px_54px_52px_18px] items-center gap-x-1 rounded-md px-2 text-[13px] hover:bg-[var(--hover)] ${s === current ? "ring-1 ring-[var(--muted)]" : ""}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <SymbolBadge name={s} type={meta(s)?.type} size={20} />
                <span className="truncate" title={s}>
                  {meta(s)?.description || s}
                </span>
              </span>
              <span className="text-right tabular-nums">
                {q ? fmt(q.last, d) : <span className="text-[var(--muted)]">…</span>}
              </span>
              <span className="text-right tabular-nums" style={{ color: color(chg ?? 0) }}>
                {chg !== null ? `${sign(chg)}${fmt(Math.abs(chg), d)}` : ""}
              </span>
              <span className="text-right tabular-nums" style={{ color: color(chg ?? 0) }}>
                {pct !== null ? `${sign(pct)}${Math.abs(pct).toFixed(2)}%` : ""}
              </span>
              <button
                className="invisible flex h-5 w-5 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--border)] hover:text-[var(--fg)] group-hover:visible"
                title="Remove from watchlist"
                onClick={(e) => {
                  e.stopPropagation();
                  remove(s);
                }}
              >
                <Close size={18} />
              </button>
            </div>
          );
        })}
      </div>

      {sel && sq && (
        <div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <SymbolBadge name={sel} type={sm?.type} size={24} />
            <span className="truncate text-[16px] font-semibold">{sm?.description || sel}</span>
          </div>
          <div className="mt-1 truncate text-[12px] text-[var(--muted)]">
            {[sel, sm?.broker?.split(" ")[0]].filter(Boolean).join(" · ")}
          </div>
          <div className="mt-3 flex items-baseline gap-1.5">
            <span className="text-[28px] font-semibold leading-none tabular-nums">{fmt(sq.last, digits(sel))}</span>
          </div>
          {sChg !== null && sq.prev && (
            <div className="mt-1.5 text-[13px] tabular-nums" style={{ color: color(sChg) }}>
              {sign(sChg)}
              {fmt(Math.abs(sChg), digits(sel))} {sign(sChg)}
              {Math.abs((sChg / sq.prev) * 100).toFixed(2)}%
            </div>
          )}
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12px]">
            {(
              [
                ["Open", sq.open],
                ["Prev close", sq.prev],
                ["High", sq.high],
                ["Low", sq.low],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <span className="text-[var(--muted)]">{k}</span>
                <span className="tabular-nums">{v !== null ? fmt(v, digits(sel)) : "—"}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {adding && <SymbolSearchDialog onClose={() => setAdding(false)} onPick={add} />}
    </div>
  );
}
