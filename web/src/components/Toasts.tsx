"use client";

import { useToastStore } from "@/store/toast";

export default function Toasts() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-4 left-16 z-[80] flex flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2.5 text-[13px] text-[var(--fg)] shadow-xl"
        >
          <span>{t.text}</span>
          {t.action && (
            <button
              className="font-semibold text-[var(--accent)] hover:underline"
              onClick={() => {
                t.action!.run();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
