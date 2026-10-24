"use client";

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as RPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

// Bảng màu của TradingView: hàng xám, hàng màu chính, rồi 6 hàng từ nhạt tới đậm.
const GRAYS = ["#ffffff", "#dbdbdb", "#b8b8b8", "#9c9c9c", "#808080", "#636363", "#4a4a4a", "#2e2e2e", "#0f0f0f", "#000000"];
const BASE = ["#f23645", "#ff9800", "#ffeb3b", "#4caf50", "#089981", "#00bcd4", "#2962ff", "#673ab7", "#9c27b0", "#e91e63"];
const SHADES = [
  ["#fccbcd", "#ffe0b2", "#fff9c4", "#c8e6c9", "#ace5dc", "#b2ebf2", "#bbd9fb", "#d1c4e9", "#e1bee7", "#f8bbd0"],
  ["#faa1a4", "#ffcc80", "#fff59d", "#a5d6a7", "#70ccbd", "#80deea", "#90bff9", "#b39ddb", "#ce93d8", "#f48fb1"],
  ["#f77c80", "#ffb74d", "#fff176", "#81c784", "#42bda8", "#4dd0e1", "#5b9cf6", "#9575cd", "#ba68c8", "#f06292"],
  ["#f7525f", "#ffa726", "#ffee58", "#66bb6a", "#22ab94", "#26c6da", "#3179f5", "#7e57c2", "#ab47bc", "#ec407a"],
  ["#b22833", "#f57c00", "#fbc02d", "#388e3c", "#056656", "#0097a7", "#1848cc", "#512da8", "#7b1fa2", "#c2185b"],
  ["#801922", "#e65100", "#f57f17", "#1b5e20", "#00332a", "#006064", "#0c3299", "#311b92", "#4a148c", "#880e4f"],
];

const CUSTOM_KEY = "tv-custom-colors";
const MAX_CUSTOM = 20;
const POP_W = 248;

type RGB = [number, number, number];
type HSV = [number, number, number]; // h 0..360, s/v 0..1

export function parseHex(s: string): RGB | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s.trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Màu lưu là `#rrggbb`, hoặc `#rrggbbaa` khi opacity < 100% (canvas và lightweight-charts đọc được cả 2). */
export function splitColor(value: string): { base: string; alpha: number } {
  const m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(value.trim());
  if (!m) return { base: value.slice(0, 7).toLowerCase(), alpha: 1 };
  return { base: `#${m[1].toLowerCase()}`, alpha: m[2] ? parseInt(m[2], 16) / 255 : 1 };
}
export function joinColor(base: string, alpha: number): string {
  const a = Math.min(1, Math.max(0, alpha));
  return a >= 0.995 ? base : base + Math.round(a * 255).toString(16).padStart(2, "0");
}
// ô caro báo vùng trong suốt (dưới thanh opacity, ô màu có alpha)
const CHECKER = "conic-gradient(#808080 25%, #c8c8c8 0 50%, #808080 0 75%, #c8c8c8 0) 0 0 / 8px 8px";

const toHex = ([r, g, b]: RGB) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

function rgbToHsv([r, g, b]: RGB): HSV {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

function hsvToRgb([h, s, v]: HSV): RGB {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return [f(5), f(3), f(1)];
}

function loadCustom(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((c) => typeof c === "string" && parseHex(c)).slice(0, MAX_CUSTOM) : [];
  } catch {
    return [];
  }
}

function saveCustom(list: string[]) {
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(list));
  } catch {
    /* localStorage bị chặn: màu tuỳ chọn chỉ sống trong phiên này */
  }
}

/** Kéo trên 1 vùng: gọi `on(x, y)` với toạ độ 0..1 trong vùng, cả lúc nhấn xuống lẫn khi kéo. */
function useDrag(on: (x: number, y: number) => void) {
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    on(
      Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    );
  };
  return {
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      move(e);
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => {
      if (e.buttons) move(e);
    },
  };
}

/** Thanh Opacity như TV: nền caro + dải từ trong suốt tới màu hiện tại, kéo được, kèm ô nhập %. */
function OpacityRow({ base, alpha, onAlpha }: { base: string; alpha: number; onAlpha: (a: number) => void }) {
  const drag = useDrag((x) => onAlpha(Math.round(x * 100) / 100));
  return (
    <div>
      <div className="mb-1.5 text-[12px] text-[var(--muted)]">Opacity</div>
      <div className="flex items-center gap-3">
        <div
          {...drag}
          className="relative h-3 flex-1 cursor-pointer touch-none rounded"
          style={{ background: `linear-gradient(to right, transparent, ${base}), ${CHECKER}` }}
        >
          <span
            className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ left: `${alpha * 100}%`, background: base }}
          />
        </div>
        <label className="flex h-7 w-[60px] items-center rounded border border-[var(--border)] px-2 text-[13px] focus-within:border-[var(--accent)]">
          <input
            value={Math.round(alpha * 100)}
            inputMode="numeric"
            onChange={(e) => onAlpha(Math.min(100, Math.max(0, parseInt(e.target.value, 10) || 0)) / 100)}
            className="w-full min-w-0 bg-transparent text-right outline-none"
          />
          <span className="pl-0.5 text-[var(--muted)]">%</span>
        </label>
      </div>
    </div>
  );
}

function Editor({
  value,
  alpha,
  onLive,
  onAlpha,
  onAdd,
}: {
  value: string;
  alpha: number;
  onLive: (hex: string) => void;
  onAlpha: (a: number) => void;
  onAdd: (hex: string) => void;
}) {
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(parseHex(value) ?? [0, 0, 0]));
  const [text, setText] = useState(() => value.toUpperCase());
  const hex = toHex(hsvToRgb(hsv));

  const apply = (next: HSV) => {
    setHsv(next);
    const h = toHex(hsvToRgb(next));
    setText(h.toUpperCase());
    onLive(h);
  };
  const sv = useDrag((x, y) => apply([hsv[0], x, 1 - y]));
  const hue = useDrag((_, y) => apply([y * 360, hsv[1], hsv[2]]));
  const commitText = (t: string) => {
    setText(t);
    const rgb = parseHex(t);
    if (!rgb) return;
    setHsv(rgbToHsv(rgb));
    onLive(toHex(rgb));
  };

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex items-center gap-2">
        <span className="h-7 w-7 shrink-0 rounded border border-[var(--border)]" style={{ background: hex }} />
        <input
          autoFocus
          value={text}
          spellCheck={false}
          onChange={(e) => commitText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && onAdd(hex)}
          className="h-7 min-w-0 flex-1 rounded border border-[var(--accent)] bg-transparent px-2 text-[13px] uppercase text-[var(--fg)] outline-none"
        />
        <button
          type="button"
          onClick={() => onAdd(hex)}
          className="h-7 rounded border border-[var(--border)] px-3 text-[13px] hover:bg-[var(--hover)]"
        >
          Add
        </button>
      </div>
      <div className="flex gap-3">
        <div
          {...sv}
          className="relative h-[150px] flex-1 cursor-crosshair touch-none rounded"
          style={{
            background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent), hsl(${hsv[0]} 100% 50%)`,
          }}
        >
          <span
            className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ left: `${hsv[1] * 100}%`, top: `${(1 - hsv[2]) * 100}%` }}
          />
        </div>
        <div
          {...hue}
          className="relative h-[150px] w-3 cursor-pointer touch-none rounded"
          style={{ background: "linear-gradient(to bottom, #f00, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00)" }}
        >
          <span
            className="pointer-events-none absolute left-1/2 h-1.5 w-4 -translate-x-1/2 -translate-y-1/2 rounded-sm border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={{ top: `${(hsv[0] / 360) * 100}%` }}
          />
        </div>
      </div>
      <OpacityRow base={hex} alpha={alpha} onAlpha={onAlpha} />
    </div>
  );
}

function Cell({ color, selected, onPick }: { color: string; selected: boolean; onPick: (c: string) => void }) {
  return (
    <button
      type="button"
      title={color.toUpperCase()}
      onClick={() => onPick(color)}
      className={`h-5 w-5 rounded-[3px] ${selected ? "ring-2 ring-white ring-offset-1 ring-offset-[var(--panel)]" : "hover:scale-110"}`}
      style={{ background: color, boxShadow: selected ? undefined : "inset 0 0 0 1px rgba(255,255,255,0.08)" }}
    />
  );
}

/**
 * Color picker kiểu TradingView: bấm ô màu mở bảng màu (xám / màu chính / 6 hàng sắc độ), nút "+"
 * mở bộ chọn tự do (vùng bão hoà-độ sáng + thanh hue + ô hex), màu tự tạo được nhớ lại.
 * Thay cho `<input type="color">` của trình duyệt (hộp thoại hệ điều hành, khó dùng).
 * `children` thay nội dung ô bấm (vd icon + vạch màu); mặc định là ô vuông màu.
 */
export default function ColorPicker({
  value,
  onChange,
  title,
  disabled,
  className = "h-8 w-8",
  children,
}: {
  value: string;
  onChange: (hex: string) => void;
  title?: string;
  disabled?: boolean;
  className?: string;
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [custom, setCustom] = useState<string[]>([]);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [host, setHost] = useState<Element | null>(null); // gốc [data-theme] chứa ô bấm: popup nằm trong đó để thừa hưởng biến theme
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const { base: cur, alpha } = splitColor(value);

  const close = () => {
    setOpen(false);
    setEditing(false);
  };

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!popRef.current?.contains(t) && !btnRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  // đặt popup dưới ô bấm; hết chỗ thì lật lên trên, và luôn nằm trong cửa sổ
  useLayoutEffect(() => {
    if (!open || !btnRef.current || !popRef.current) return;
    const b = btnRef.current.getBoundingClientRect();
    const h = popRef.current.offsetHeight;
    const top = b.bottom + 4 + h > window.innerHeight - 8 ? Math.max(8, b.top - 4 - h) : b.bottom + 4;
    const left = Math.max(8, Math.min(b.left, window.innerWidth - POP_W - 8));
    setPos((p) => (p && p.left === left && p.top === top ? p : { left, top }));
  }, [open, editing, custom.length]);

  // chọn ô màu giữ nguyên opacity đang đặt; bảng màu không tự đóng để còn chỉnh Opacity (như TV)
  const pick = (hex: string) => onChange(joinColor(hex, alpha));
  const add = (hex: string) => {
    const next = [hex, ...custom.filter((c) => c !== hex)].slice(0, MAX_CUSTOM);
    setCustom(next);
    saveCustom(next);
    onChange(joinColor(hex, alpha));
    setEditing(false);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        title={title}
        disabled={disabled}
        onClick={() => {
          setPos(null);
          if (!open) {
            setCustom(loadCustom());
            setHost(btnRef.current?.closest("[data-theme]") ?? document.body);
          }
          setOpen((o) => !o);
        }}
        className={
          children
            ? className
            : `relative shrink-0 cursor-pointer rounded-md border border-[var(--border)] p-1 hover:border-[var(--muted)] disabled:pointer-events-none disabled:opacity-55 ${className}`
        }
      >
        {children ?? (
          <span
            className="block h-full w-full rounded-sm"
            style={{ background: alpha < 1 ? `linear-gradient(${value}, ${value}), ${CHECKER}` : value }}
          />
        )}
      </button>
      {open &&
        host &&
        createPortal(
          <div
            ref={popRef}
            className="fixed z-[1000] rounded-md border border-[var(--border)] bg-[var(--panel)] text-[var(--fg)] shadow-2xl"
            style={{ width: POP_W, left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
          >
            {editing ? (
              <Editor
                value={cur}
                alpha={alpha}
                onLive={(hex) => onChange(joinColor(hex, alpha))}
                onAlpha={(a) => onChange(joinColor(cur, a))}
                onAdd={add}
              />
            ) : (
              <div className="p-2.5">
                <div className="grid grid-cols-10 gap-[3px]">
                  {GRAYS.concat(BASE).map((c) => (
                    <Cell key={c} color={c} selected={c === cur} onPick={pick} />
                  ))}
                </div>
                <div className="mt-[9px] grid grid-cols-10 gap-[3px]">
                  {SHADES.flat().map((c) => (
                    <Cell key={c} color={c} selected={c === cur} onPick={pick} />
                  ))}
                </div>
                <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
                  <div className="flex flex-wrap gap-[3px]">
                    <button
                      type="button"
                      title="Custom color"
                      onClick={() => setEditing(true)}
                      className="flex h-5 w-5 items-center justify-center rounded-[3px] border border-[var(--border)] text-[var(--muted)] hover:border-[var(--muted)] hover:text-[var(--fg)]"
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
                        <path d="M5 1v8M1 5h8" />
                      </svg>
                    </button>
                    {custom.map((c) => (
                      <Cell key={c} color={c} selected={c === cur} onPick={pick} />
                    ))}
                  </div>
                </div>
                <div className="mt-2.5 border-t border-[var(--border)] pt-2.5">
                  <OpacityRow base={cur} alpha={alpha} onAlpha={(a) => onChange(joinColor(cur, a))} />
                </div>
              </div>
            )}
          </div>,
          host,
        )}
    </>
  );
}
