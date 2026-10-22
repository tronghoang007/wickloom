"use client";

import { appSession } from "@/store/appSession";
import { useLayoutStore } from "@/store/layout";
import { useSessionStore } from "@/store/layoutSession";
import { useMemo, useState } from "react";
import { Close, Search } from "../icons";
import PromptDialog from "./PromptDialog";

const when = (t: number) =>
  t ? new Date(t).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

/** Open layout: danh sách layout của user (tìm kiếm, tên, tóm tắt, thời gian sửa), bấm để mở, xoá có xác nhận. */
export default function OpenLayoutDialog() {
  const open = useSessionStore((s) => s.dialog === "open");
  const entries = useSessionStore((s) => s.entries);
  const loading = useSessionStore((s) => s.entriesLoading);
  const current = useLayoutStore((s) => s.layoutId);
  const [q, setQ] = useState("");
  const [del, setDel] = useState<{ id: string; name: string } | null>(null);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (entries ?? []).filter((e) => !needle || `${e.name} ${e.summary}`.toLowerCase().includes(needle));
  }, [entries, q]);
  if (!open) return null;

  const close = () => appSession().closeDialog();
  return (
    <>
      <div
        className="fixed inset-0 z-[65] flex items-start justify-center bg-black/50 pt-20"
        onMouseDown={(e) => e.target === e.currentTarget && close()}
        onKeyDown={(e) => e.key === "Escape" && close()}
      >
        <div className="flex max-h-[70vh] w-[640px] max-w-[96vw] flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-2xl" role="dialog" aria-label="Open layout">
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <span className="text-lg font-semibold">Open layout</span>
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
          <div className="min-h-[80px] flex-1 overflow-y-auto border-t border-[var(--border)]">
            {entries === null && <div className="px-5 py-6 text-sm text-[var(--muted)]">{loading ? "Đang tải…" : "Không tải được danh sách."}</div>}
            {entries !== null && shown.length === 0 && <div className="px-5 py-6 text-sm text-[var(--muted)]">Không có layout nào.</div>}
            {shown.map((e) => (
              <div key={e.id} className="group flex items-center gap-3 border-b border-[var(--border)] px-5 py-2.5 last:border-b-0 hover:bg-[var(--hover)]">
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
                  <div className="truncate text-xs text-[var(--muted)]">{e.summary}</div>
                </button>
                <span className="shrink-0 text-xs text-[var(--muted)]">{when(e.updatedAt)}</span>
                <button
                  className="invisible rounded p-1 text-[var(--muted)] hover:bg-[var(--border)] hover:text-[#f23645] group-hover:visible"
                  title="Delete layout"
                  aria-label={`Delete ${e.name}`}
                  onClick={() => setDel({ id: e.id, name: e.name })}
                >
                  <Close size={20} />
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
