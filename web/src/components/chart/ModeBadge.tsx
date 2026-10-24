import { MODE_COLOR, MODE_LABEL } from "@/lib/mt5Format";
import type { Mt5Mode } from "@/lib/mt5Api";

/** Nhãn DEMO / REAL / CONTEST của account MT5: nền và viền là màu chế độ ở độ đục thấp, chữ pha về phía --fg để đọc rõ (chữ trắng trên #089981 chỉ đạt 3.6:1). */
export default function ModeBadge({ mode, className = "" }: { mode: Mt5Mode; className?: string }) {
  if (!MODE_LABEL[mode]) return null;
  const c = MODE_COLOR[mode];
  return (
    <span
      className={`inline-flex h-[18px] shrink-0 items-center rounded border px-1.5 text-[10px] font-semibold leading-none tracking-wider ${className}`}
      style={{
        color: `color-mix(in srgb, ${c}, var(--fg) 30%)`,
        borderColor: `color-mix(in srgb, ${c} 55%, transparent)`,
        background: `color-mix(in srgb, ${c} 16%, transparent)`,
      }}
    >
      {MODE_LABEL[mode]}
    </span>
  );
}
