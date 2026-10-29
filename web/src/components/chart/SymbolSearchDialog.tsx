"use client";

import { fetchSymbols } from "@/lib/api";
import { useChartStore } from "@/store/chart";
import { useEffect, useMemo, useRef, useState } from "react";
import EmptyState from "../EmptyState";
import { ClearX, Close, EmptyPlugI, EmptySearchI, Search } from "../icons";
import { SymbolBadge } from "../SymbolIcon";

const TYPE_LABEL: Record<string, string> = {
  forex: "forex",
  metal: "commodity cfd",
  index: "index cfd",
  crypto: "crypto",
  stocks: "stock cfd",
  other: "cfd",
};
const CHIPS: { id: string; label: string }[] = [
  { id: "forex", label: "Forex" },
  { id: "metal", label: "Metals" },
  { id: "index", label: "Indices" },
  { id: "crypto", label: "Crypto" },
  { id: "stocks", label: "Stocks" },
  { id: "other", label: "Other" },
];
function Highlight({ text, q }: { text: string; q: string }) {
  const i = q ? text.toLowerCase().indexOf(q.toLowerCase()) : -1;
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <span className="text-[var(--accent-text)]">
        {text.slice(i, i + q.length)}
      </span>
      {text.slice(i + q.length)}
    </>
  );
}

export default function SymbolSearchDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  /** Mặc định load symbol vào chart chính; truyền riêng để dùng dialog này cho việc
   * khác (vd WatchlistPanel dùng để "thêm vào watchlist" thay vì đổi chart). */
  onPick?: (name: string) => void;
}) {
  const { symbol, symbols, set } = useChartStore();
  // Như TV: mở từ nút symbol thì input đã có symbol hiện tại (bôi đen sẵn để gõ đè);
  // dialog "thêm vào watchlist" (có onPick) không liên quan symbol đang xem nên để rỗng.
  const [q, setQ] = useState(onPick ? "" : symbol);
  const [type, setType] = useState("all");
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const present = useMemo(() => new Set(symbols.map((s) => s.type)), [symbols]);
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return symbols
      .filter(
        (s) =>
          (type === "all" || s.type === type) &&
          (!query ||
            s.name.toLowerCase().includes(query) ||
            (s.description ?? "").toLowerCase().includes(query)),
      )
      .sort((a, b) => {
        const score = (n: string) =>
          n.toLowerCase() === query
            ? 0
            : n.toLowerCase().startsWith(query)
              ? 1
              : 2;
        return score(a.name) - score(b.name) || a.name.localeCompare(b.name);
      });
  }, [symbols, q, type]);

  // Refresh ngay khi mở dialog — không cần chờ interval 10s ở Toolbar
  useEffect(() => {
    fetchSymbols().then((syms) => set({ symbols: syms })).catch(() => {});
  }, [set]);

  useEffect(() => {
    listRef.current?.children[sel]?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const pick = (name: string) => {
    if (onPick) onPick(name);
    else set({ symbol: name });
    onClose();
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(rows.length - 1, s + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(0, s - 1));
    } else if (e.key === "Enter") {
      const r = rows[sel];
      if (r) pick(r.name);
      else if (q.trim()) pick(q.trim().toUpperCase());
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-16 max-md:pt-0"
      onClick={onClose}
      onKeyDown={onKey}
    >
      <div
        // phone (max-md): toàn màn để danh sách dài và bàn phím ảo đều có chỗ
        className="flex max-h-[80vh] w-[790px] max-w-[96vw] flex-col overflow-hidden rounded-2xl popup max-md:h-dvh max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)] max-md:max-h-none max-md:max-w-none max-md:w-full max-md:rounded-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pb-3 pt-4">
          <h2 className="text-xl font-semibold">Symbol search</h2>
          <button
            className="rounded p-1 hover:bg-[var(--hover)]"
            onClick={onClose}
            aria-label="Close"
          >
            <Close />
          </button>
        </div>

        <div className="px-5 pb-3">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 focus-within:border-[var(--accent)]">
            <Search />
            <input
              autoFocus
              value={q}
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                setQ(e.target.value);
                setSel(0);
              }}
              onKeyDown={onKey}
              placeholder="Search"
              className="h-11 w-full bg-transparent text-base outline-none"
            />
            {q && (
              <button
                className="text-[var(--muted)] hover:text-[var(--fg)]"
                onClick={() => {
                  setQ("");
                  setSel(0);
                }}
                aria-label="Clear"
              >
                <ClearX />
              </button>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {[
            { id: "all", label: "All" },
            ...CHIPS.filter((c) => present.has(c.id)),
          ].map((c) => (
            <button
              key={c.id}
              onClick={() => {
                setType(c.id);
                setSel(0);
              }}
              className={`rounded-full px-3.5 py-1.5 text-sm ${type === c.id ? "bg-[var(--fg)] text-[var(--bg)]" : "bg-[var(--hover)] hover:brightness-125"}`}
            >
              {c.label}
            </button>
          ))}
        </div>

        <div
          ref={listRef}
          className="min-h-[200px] flex-1 overflow-y-auto border-t border-[var(--border)]"
        >
          {rows.length === 0 && (
            <EmptyState icon={symbols.length === 0 ? <EmptyPlugI /> : <EmptySearchI />} className="h-full">
              {symbols.length === 0
                ? "Chưa có symbol: EA chưa gửi danh sách."
                : "Không tìm thấy symbol."}
            </EmptyState>
          )}
          {rows.map((s, i) => (
            <div
              key={s.name}
              onClick={() => pick(s.name)}
              onMouseMove={() => setSel(i)}
              className={`mx-1 my-0.5 flex cursor-pointer items-center gap-3 rounded px-4 py-2 ${i === sel ? "outline outline-2 -outline-offset-2 outline-white/90" : ""} ${s.name === symbol ? "bg-[var(--hover)]" : ""}`}
            >
              <SymbolBadge name={s.name} type={s.type} />
              <span className="w-24 shrink-0 font-medium text-[var(--accent-text)]">
                <Highlight text={s.name} q={q.trim()} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">
                <Highlight text={s.description ?? ""} q={q.trim()} />
              </span>
              <span className="shrink-0 text-xs text-[var(--muted)]">
                {TYPE_LABEL[s.type] ?? s.type}
              </span>
              <span className="w-24 shrink-0 truncate text-right text-sm">
                {s.broker}
              </span>
            </div>
          ))}
        </div>

        {/* gợi ý phím: màn cảm ứng không có bàn phím vật lý */}
        <div className="border-t border-[var(--border)] bg-[var(--hover)]/40 px-5 py-2.5 text-center text-xs text-[var(--muted)] pointer-coarse:hidden">
          ↑ ↓ để chọn, Enter để mở, Esc để đóng
        </div>
      </div>
    </div>
  );
}
