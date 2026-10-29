"use client";

import { useState, type ReactNode } from "react";

// Icon của nút hover trên hàng legend: lưới 18 hiện đúng 18px như TV, nét 1.2 và bo tròn
// (icon lưới 28px thu nhỏ bị mờ và thô)
const Ic = ({ children }: { children: ReactNode }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);
export const EyeIc = ({ off }: { off: boolean }) => (
  <Ic>
    <path d="M1.5 9C3.3 5.8 6 4 9 4s5.7 1.8 7.5 5c-1.8 3.2-4.5 5-7.5 5S3.3 12.2 1.5 9z" />
    <circle cx="9" cy="9" r="2.4" />
    {off && <path d="M3 15L15 3" />}
  </Ic>
);
export const GearIc = () => (
  <Ic>
    <path d="M15.55 10.47L13.55 13.94Q12.70 15.41 11.00 15.41L7.00 15.41Q5.30 15.41 4.45 13.94L2.45 10.47Q1.60 9.00 2.45 7.53L4.45 4.06Q5.30 2.59 7.00 2.59L11.00 2.59Q12.70 2.59 13.55 4.06L15.55 7.53Q16.40 9.00 15.55 10.47z" />
    <circle cx="9" cy="9" r="2.4" />
  </Ic>
);
export const TrashIc = () => (
  <Ic>
    <path d="M3 5h12M7 5V3.8a.8.8 0 0 1 .8-.8h2.4a.8.8 0 0 1 .8.8V5M4.5 5l.7 8.7a1.3 1.3 0 0 0 1.3 1.2h5a1.3 1.3 0 0 0 1.3-1.2L13.5 5M7.5 7.6v4.6M10.5 7.6v4.6" />
  </Ic>
);
export const DotsIc = () => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor">
    <circle cx="3.5" cy="9" r="1.5" />
    <circle cx="9" cy="9" r="1.5" />
    <circle cx="14.5" cy="9" r="1.5" />
  </svg>
);

/** Màn cảm ứng không có hover (Tailwind 4 chỉ áp `hover:` khi thiết bị có hover): chạm vào hàng legend thì bật / tắt cụm nút.
 *  Chạm trúng chính một nút thì không tính, để nút đó nhận được cú bấm trước khi cụm nút ẩn đi. */
export function useTapReveal() {
  const [open, setOpen] = useState(false);
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType !== "touch" || (e.target as Element).closest("button")) return;
    setOpen((v) => !v);
  };
  return { open, onPointerUp };
}

export function IconBtn({ title, onClick, children }: { title: string; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-5 w-7 items-center justify-center rounded text-[var(--fg)] hover:bg-[var(--hover)] pointer-coarse:h-7 pointer-coarse:w-9"
    >
      {children}
    </button>
  );
}

