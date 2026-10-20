"use client";

import { fetchBars, getWatchlist, saveWatchlist } from "@/lib/api";
import { useChartStore } from "@/store/chart";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash } from "../icons";
import SymbolSearchDialog from "./SymbolSearchDialog";

export default function WatchlistPanel() {
  const set = useChartStore((s) => s.set);
  const current = useChartStore((s) => s.symbol);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [adding, setAdding] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    getWatchlist().then(setSymbols);
  }, []);

  const persist = (next: string[]) => {
    setSymbols(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => saveWatchlist(next), 500);
  };

  // Poll giá mới nhất mỗi ~7s - cùng kiểu polling Toolbar.tsx đang dùng cho symbol list,
  // không cần xây cơ chế realtime WS riêng cho 1 panel phụ.
  useEffect(() => {
    if (symbols.length === 0) return;
    let alive = true;
    const poll = () => {
      Promise.all(
        symbols.map((s) =>
          fetchBars(s, "M1", undefined, 1).then(
            (bars) => [s, bars[0]?.c] as const,
          ),
        ),
      ).then((rows) => {
        if (!alive) return;
        setPrices((prev) => {
          const next = { ...prev };
          for (const [s, c] of rows) if (c !== undefined) next[s] = c;
          return next;
        });
      });
    };
    poll();
    const id = setInterval(poll, 7000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [symbols]);

  const add = (name: string) => {
    if (!symbols.includes(name)) persist([...symbols, name]);
  };
  const remove = (name: string) => persist(symbols.filter((s) => s !== name));

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-[var(--border)] px-3 py-2">
        <button
          className="flex items-center gap-1.5 text-sm text-[var(--muted)] hover:text-[var(--fg)]"
          onClick={() => setAdding(true)}
        >
          <Plus /> Add symbol
        </button>
      </div>
      {symbols.length === 0 && (
        <div className="px-4 py-6 text-sm text-[var(--muted)]">
          Chưa có symbol trong watchlist. Bấm &quot;Add symbol&quot; để thêm.
        </div>
      )}
      {symbols.map((s) => (
        <div
          key={s}
          onClick={() => set({ symbol: s })}
          className={`group flex cursor-pointer items-center justify-between px-3 py-2 text-sm hover:bg-[var(--hover)] ${s === current ? "bg-[var(--hover)]" : ""}`}
        >
          <span className="font-medium">{s}</span>
          <div className="flex items-center gap-2">
            <span className="text-[var(--muted)]">
              {prices[s] !== undefined ? prices[s] : "…"}
            </span>
            <button
              className="text-transparent group-hover:text-[var(--muted)] hover:!text-red-400"
              onClick={(e) => {
                e.stopPropagation();
                remove(s);
              }}
              title="Remove"
            >
              <Trash />
            </button>
          </div>
        </div>
      ))}
      {adding && <SymbolSearchDialog onClose={() => setAdding(false)} onPick={add} />}
    </div>
  );
}
