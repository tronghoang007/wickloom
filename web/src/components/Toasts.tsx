"use client";

import { useToastStore, type ToastKind } from "@/store/toast";

const ICON_COLOR: Record<ToastKind, string> = { success: "#089981", error: "#f23645", info: "#2962ff" };

function Icon({ kind }: { kind: ToastKind }) {
  const c = ICON_COLOR[kind];
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0" aria-hidden>
      <circle cx="11" cy="11" r="9.5" />
      {kind === "success" && <path d="m6.8 11.3 3 3 5.4-6" />}
      {kind === "error" && <path d="m7.6 7.6 6.8 6.8m0-6.8-6.8 6.8" />}
      {kind === "info" && <path d="M11 10v5.2M11 6.8v.4" />}
    </svg>
  );
}

// Góc dưới trái như TradingView: thẻ tối, biểu tượng trạng thái, tiêu đề đậm + nội dung, nút đóng bên phải
export default function Toasts() {
  const items = useToastStore((s) => s.items);
  const dismiss = useToastStore((s) => s.dismiss);
  if (items.length === 0) return null;
  return (
    <div className="pointer-events-none fixed bottom-14 left-14 z-[80] flex w-[min(380px,calc(100vw-80px))] flex-col gap-2" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] py-3.5 pl-4 pr-3 text-[var(--fg)] shadow-xl">
          <Icon kind={t.kind} />
          <div className="min-w-0 flex-1 text-[14px] leading-[1.4]">
            {t.title && <div className="font-semibold">{t.title}</div>}
            <div className={t.title ? "text-[var(--fg)]/85" : ""}>{t.text}</div>
            {t.action && (
              <button
                className="mt-1 font-semibold text-[var(--accent-text)] hover:underline"
                onClick={() => {
                  t.action!.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button type="button" aria-label="Close" onClick={() => dismiss(t.id)} className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded text-[var(--fg)]/70 hover:bg-white/10 hover:text-[var(--fg)]">
            <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden>
              <path d="m2 2 10 10M12 2 2 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
