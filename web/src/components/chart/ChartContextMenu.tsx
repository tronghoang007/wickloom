import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Chevron } from "@/components/icons";

export type MenuItem =
  | "sep"
  | {
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      onSelect?: () => void;
      disabled?: boolean;
      submenu?: boolean; // chỉ hiện mũi tên (mục chưa làm); có children thì tự có mũi tên
      children?: MenuItem[];
    };

const panel = "popup rounded-md py-1.5 text-sm";

// Menu con mở sang phải của hàng cha (lật sang trái nếu tràn mép màn hình).
function SubMenu({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [flip, setFlip] = useState(false);
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setFlip(r.right > window.innerWidth - 4);
  }, []);
  return (
    <div ref={ref} role="menu" className={`absolute top-[-5px] z-10 min-w-[200px] ${panel} ${flip ? "right-full" : "left-full"}`}>
      <MenuList items={items} onClose={onClose} />
    </div>
  );
}

function MenuList({ items, onClose }: { items: MenuItem[]; onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <>
      {items.map((it, i) =>
        it === "sep" ? (
          <div key={i} className="my-1.5 h-px bg-[var(--border)]" />
        ) : (
          <div key={i} className="relative" onMouseEnter={() => setOpen(it.children && !it.disabled ? i : null)}>
            <button
              type="button"
              role="menuitem"
              disabled={it.disabled}
              title={it.disabled ? "Sắp có" : undefined}
              onClick={() => {
                if (it.children) return setOpen(i);
                it.onSelect?.();
                onClose();
              }}
              className={`flex h-8 w-full items-center gap-2 px-3 text-left enabled:hover:bg-[var(--hover)] disabled:opacity-55 ${open === i ? "bg-[var(--hover)]" : ""}`}
            >
              <span className="-ml-1.5 flex w-7 shrink-0 justify-center text-[var(--muted)]">{it.icon}</span>
              <span className="min-w-0 flex-1 truncate">{it.label}</span>
              {it.shortcut && <span className="shrink-0 pl-4 text-xs text-[var(--muted)]">{it.shortcut}</span>}
              {(it.submenu || it.children) && (
                <span className="shrink-0 -rotate-90 text-[var(--muted)]">
                  <Chevron />
                </span>
              )}
            </button>
            {it.children && open === i && <SubMenu items={it.children} onClose={onClose} />}
          </div>
        ),
      )}
    </>
  );
}

// Menu chuột phải trên chart, bố cục theo TradingView. Mục chưa có tính năng thì hiện
// disabled + "sắp có" (cùng quy ước với nút trên Toolbar).
export default function ChartContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  // Lật vào trong nếu tràn mép màn hình (như menu hệ điều hành).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    setPos({
      left: x + width > window.innerWidth - 4 ? Math.max(4, x - width) : x,
      top: y + height > window.innerHeight - 4 ? Math.max(4, window.innerHeight - height - 4) : y,
    });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onClose);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onClose);
      window.removeEventListener("wheel", onClose);
    };
  }, [onClose]);

  return (
    <>
      <div
        className="fixed inset-0 z-40"
        onMouseDown={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        ref={ref}
        role="menu"
        className={`fixed z-50 min-w-[240px] max-w-[340px] ${panel}`}
        style={pos}
        onContextMenu={(e) => e.preventDefault()}
      >
        <MenuList items={items} onClose={onClose} />
      </div>
    </>
  );
}
