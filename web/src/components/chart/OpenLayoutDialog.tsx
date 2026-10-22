"use client";

import { appSession } from "@/store/appSession";
import { useLayoutStore } from "@/store/layout";
import { useSessionStore } from "@/store/layoutSession";
import { useMemo, useState } from "react";
import { Close, Search, Trash } from "../icons";
import PromptDialog from "./PromptDialog";

// Như dòng 2 của TV: "Oct 21, 2026, 23:55"
const when = (t: number) =>
  t ? new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }) : "—";

type Sort = "date-desc" | "date-asc" | "name-asc" | "name-desc";
const SORTS: { id: Sort; label: string }[] = [
  { id: "name-asc", label: "Layout name ↑" },
  { id: "name-desc", label: "Layout name ↓" },
  { id: "date-asc", label: "Date modified ↑" },
  { id: "date-desc", label: "Date modified ↓" },
];

/** Dialog "Layouts" (như TV): tìm kiếm, sắp xếp 4 kiểu, tên + tóm tắt + giờ sửa, bấm để mở, thùng rác khi rê chuột (xoá có xác nhận). */
export default function OpenLayoutDialog() {
  const open = useSessionStore((s) => s.dialog === "open");
  const entries = useSessionStore((s) => s.entries);
  const loading = useSessionStore((s) => s.entriesLoading);
  const current = useLayoutStore((s) => s.layoutId);
  const [q, setQ] = useState("");
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  const [sort, setSort] = useState<Sort>("date-desc");
  const [sortOpen, setSortOpen] = useState(false);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = (entries ?? []).filter((e) => !needle || `${e.name} ${e.summary}`.toLowerCase().includes(needle));
    const by: Record<Sort, (a: (typeof list)[number], b: (typeof list)[number]) => number> = {
      "date-desc": (a, b) => b.updatedAt - a.updatedAt,
      "date-asc": (a, b) => a.updatedAt - b.updatedAt,
      "name-asc": (a, b) => a.name.localeCompare(b.name),
      "name-desc": (a, b) => b.name.localeCompare(a.name),
    };
    return list.sort(by[sort]);
  }, [entries, q, sort]);
  if (!open) return null;

  const close = () => appSession().closeDialog();
  return (
    <>
      <div
        className="fixed inset-0 z-[65] flex items-start justify-center bg-black/50 pt-20"
        onMouseDown={(e) => e.target === e.currentTarget && close()}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <div className="flex h-[540px] max-h-[88vh] w-[480px] max-w-[96vw] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-2xl" role="dialog" aria-label="Layouts">
          <div className="flex items-center justify-between px-5 pb-3 pt-4">
            <span className="text-xl font-semibold">Layouts</span>
            <button className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={close} aria-label="Close">
              <Close size={24} />
            </button>
          </div>
          <div className="px-5 pb-3">
            <div className="flex h-10 items-center gap-2 rounded border border-[var(--border)] px-3 focus-within:border-[var(--accent)]">
              <Search size={20} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="h-full flex-1 bg-transparent text-sm outline-none" />
            </div>
          </div>
          <div className="relative flex items-center justify-between px-5 pb-1 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">
            <span className="pl-3">Layout name</span>
            <button className="rounded p-1 hover:bg-[var(--hover)]" title="Sort" aria-label="Sort layouts" onClick={() => setSortOpen(!sortOpen)}>
              ↓≡
            </button>
            {sortOpen && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
                <div className="absolute right-5 top-7 z-20 min-w-[170px] rounded-lg border border-[var(--border)] bg-[var(--bg)] py-1 text-sm normal-case tracking-normal text-[var(--fg)] shadow-2xl">
                  {SORTS.map((o) => (
                    <button
                      key={o.id}
                      className={`flex w-full px-3 py-1.5 text-left hover:bg-[var(--hover)] ${o.id === sort ? "font-semibold text-[var(--accent)]" : ""}`}
                      onClick={() => {
                        setSort(o.id);
                        setSortOpen(false);
                      }}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div className="min-h-[80px] flex-1 overflow-y-auto px-2">
            {entries === null && <div className="px-3 py-6 text-sm text-[var(--muted)]">{loading ? "Đang tải…" : "Không tải được danh sách."}</div>}
            {entries !== null && shown.length === 0 && <div className="px-3 py-6 text-sm text-[var(--muted)]">Không có layout nào.</div>}
            {shown.map((e) => (
              <div
                key={e.id}
                className={`group flex items-center gap-2 rounded px-3 py-1.5 hover:bg-[var(--hover)] ${e.id === current ? "bg-[var(--hover)]" : ""}`}
              >
                <button
                  className="min-w-0 flex-1 text-left disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!e.doc}
                  onClick={() => void appSession().open(e.id)}
                  title={e.doc ? "Open" : e.summary}
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{e.name}</span>
                    {e.id === current && <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[10px] font-semibold text-white">CURRENT</span>}
                  </div>
                  <div className="flex text-xs text-[var(--muted)]">
                    <span className="truncate">{e.summary}</span>
                    <span className="shrink-0 whitespace-pre"> ({when(e.updatedAt)})</span>
                  </div>
                </button>
                <button
                  className="invisible rounded p-1 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[#f23645] group-hover:visible"
                  title="Delete layout"
                  aria-label={`Delete ${e.name}`}
                  onClick={() => setDel({ id: e.id, name: e.name })}
                >
                  <Trash />
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      {del && (
        <PromptDialog
          title="Delete layout"
          message={`Xoá layout "${del.name}" và hình vẽ của nó? Không hoàn tác được.`}
          input={false}
          confirmLabel="Delete"
          danger
          onSubmit={() => appSession().remove(del.id)}
          onClose={() => setDel(null)}
        />
      )}
    </>
  );
}
