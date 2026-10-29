"use client";

import { useConfirmStore, type ConfirmRow } from "@/store/confirm";
import { useEffect, useRef, useState } from "react";
import { Close } from "./icons";

const TONE: Record<NonNullable<ConfirmRow["tone"]>, string> = { buy: "text-[var(--accent-text)]", sell: "text-[#f23645]", pos: "text-[#089981]", neg: "text-[#f23645]" };

/** Hộp thoại xác nhận (mở bằng `askConfirm`): tiêu đề, bảng tóm tắt, Huỷ / nút xác nhận. Esc hoặc bấm nền = huỷ. */
export default function ConfirmHost() {
  const request = useConfirmStore((s) => s.request);
  const close = useConfirmStore((s) => s.close);
  const [busy, setBusy] = useState(false);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (request) okRef.current?.focus(); // Enter xác nhận, Esc huỷ
  }, [request]);

  if (!request) return null;
  const dismiss = () => {
    void request.onCancel?.();
    close();
  };
  const run = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await request.onConfirm();
    } finally {
      setBusy(false);
      close();
    }
  };

  return (
    <div
      className="anim-fade fixed inset-0 z-[75] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && dismiss()}
      onKeyDown={(e) => e.key === "Escape" && !busy && dismiss()}
    >
      <div role="alertdialog" aria-label={request.title} className="w-[400px] max-w-[94vw] rounded-2xl popup p-5">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-lg font-semibold">{request.title}</span>
          <button type="button" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={dismiss} aria-label="Close">
            <Close size={22} />
          </button>
        </div>
        {request.message && <p className="mb-3 text-[13px] text-[var(--muted)]">{request.message}</p>}
        {request.rows && request.rows.length > 0 && (
          <div className="mb-1 divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] text-[13px]">
            {request.rows.map((r) => (
              <div key={r.label} className="flex items-center justify-between gap-4 px-3 py-2">
                <span className="text-[var(--muted)]">{r.label}</span>
                <span className={`text-right font-medium tabular-nums ${r.tone ? TONE[r.tone] : ""}`}>{r.value}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="h-9 rounded border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]" onClick={dismiss} disabled={busy}>
            {request.cancelLabel ?? "Huỷ"}
          </button>
          <button
            ref={okRef}
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className={`h-9 rounded px-5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-55 ${request.danger ? "bg-[#f23645]" : "bg-[var(--accent)]"}`}
          >
            {busy ? "…" : request.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
