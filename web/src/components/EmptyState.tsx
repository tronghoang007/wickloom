import type { ReactNode } from "react";

/** Trạng thái rỗng dùng chung (danh sách không có gì): icon + dòng chữ, canh giữa cả hai chiều trong vùng chứa.
 *  Vùng chứa phải có chiều cao (flex-1 / h-full) thì mới giữa theo chiều dọc; `compact` cho ô nhỏ nằm trong menu. */
export default function EmptyState({ icon, children, compact = false, className = "" }: { icon?: ReactNode; children: ReactNode; compact?: boolean; className?: string }) {
  return (
    <div role="status" className={`flex flex-col items-center justify-center gap-2.5 text-center text-sm text-[var(--muted)] ${compact ? "px-3 py-3" : "px-6 py-8"} ${className}`}>
      {icon && (
        <span aria-hidden className="opacity-70">
          {icon}
        </span>
      )}
      <span className="max-w-[320px] leading-snug">{children}</span>
    </div>
  );
}
