"use client";

// Avatar tròn: chữ cái đầu của tên, màu băm từ id (ổn định giữa các lần mở); khách = hình người xám.
const PALETTE = ["#2962ff", "#089981", "#f23645", "#9c27b0", "#d69a00", "#00897b", "#6d4c41", "#546e7a"];

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export default function Avatar({ name, id, size = 30 }: { name: string | null; id?: string | null; size?: number }) {
  if (!name) {
    return (
      <span
        className="flex shrink-0 items-center justify-center rounded-full bg-[var(--hover)] text-[var(--muted)]"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <svg width={size * 0.6} height={size * 0.6} viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="8" r="4.2" />
          <path d="M3.5 21c0-4.7 3.8-7.5 8.5-7.5s8.5 2.8 8.5 7.5z" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.45), background: PALETTE[hash(id ?? name) % PALETTE.length] }}
      aria-hidden
    >
      {[...name.trim()][0]?.toUpperCase() ?? "?"}
    </span>
  );
}
