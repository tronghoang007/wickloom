"use client";

import { useEffect, useRef, useState } from "react";
import { Close } from "../icons";

/** Hộp thoại nhỏ: nhập một dòng (đổi tên, tên bản sao...) hoặc chỉ xác nhận (`input` = false). */
export default function PromptDialog({
  title,
  message,
  initial = "",
  input = true,
  confirmLabel = "OK",
  danger = false,
  onSubmit,
  onClose,
}: {
  title: string;
  message?: string;
  initial?: string;
  input?: boolean;
  confirmLabel?: string;
  danger?: boolean;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const okRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // có ô nhập: focus + chọn sẵn chữ; chỉ xác nhận: focus nút để Enter / Esc hoạt động
    if (input) {
      ref.current?.focus();
      ref.current?.select();
    } else okRef.current?.focus();
  }, [input]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || (input && !value.trim())) return;
    setBusy(true);
    try {
      await onSubmit(value.trim());
    } finally {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form onSubmit={submit} className="w-[380px] max-w-[94vw] rounded-2xl popup p-5" role="dialog" aria-label={title}>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-lg font-semibold">{title}</span>
          <button type="button" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={onClose} aria-label="Close">
            <Close size={22} />
          </button>
        </div>
        {message && <p className="mb-3 text-[13px] text-[var(--muted)]">{message}</p>}
        {input && (
          <input
            ref={ref}
            value={value}
            maxLength={100}
            onChange={(e) => setValue(e.target.value)}
            className="h-10 w-full rounded border border-[var(--border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--accent)]"
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="h-9 rounded border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]" onClick={onClose}>
            Cancel
          </button>
          <button
            ref={okRef}
            type="submit"
            disabled={busy || (input && !value.trim())}
            className={`h-9 rounded px-5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-55 ${danger ? "bg-[#f23645]" : "bg-[var(--accent)]"}`}
          >
            {busy ? "…" : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  );
}
