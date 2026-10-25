"use client";

import { fmtLotValue, lotMarks, normalizeLot, type LotSpec } from "@/trading/lot";

/** Thanh kéo đóng một phần (như MT5): từ 0 tới cả vị thế, mốc là chấm tròn có nhãn LOT (`lotMarks`: chia theo lot của vị thế, mốc cuối là cả vị thế), đường kẻ 1px, đoạn đã chọn tô đỏ, núm tròn.
 *  Giá trị ra là lot đã chuẩn hoá theo step. Input range thật nằm đè lên để kéo / dùng phím. `className` đặt bề rộng (bảng Positions dùng cố định, bảng Modify ở thanh phải thì full). */
export default function LotSlider({ spec, value, onChange, className = "w-56" }: { spec: LotSpec; value: number; onChange: (lot: number) => void; className?: string }) {
  const pct = Math.min(100, Math.max(0, (value / spec.max) * 100));
  const marks = lotMarks(spec);
  return (
    <span className={`relative mx-1 flex h-5 items-center ${className}`}>
      <span className="pointer-events-none absolute inset-x-2 inset-y-0 flex items-center">
        <span className="absolute inset-x-0 h-px bg-[var(--border)]" />
        <span className="absolute left-0 h-px bg-[#f23645]" style={{ width: `${pct}%` }} />
        {marks.map((m) => (
          <span key={m} className="absolute flex -translate-x-1/2 flex-col items-center" style={{ left: `${(m / spec.max) * 100}%` }}>
            <span className={`h-2 w-2 rounded-full ${m <= value + 1e-9 ? "bg-[#f23645]" : "bg-[var(--muted)]"}`} />
            <span className="absolute top-3.5 text-[10px] leading-none text-[var(--muted)]">{fmtLotValue(m, spec)}</span>
          </span>
        ))}
      </span>
      <input
        type="range"
        aria-label="Close lot slider"
        min={0}
        max={spec.max}
        step={spec.step}
        value={Math.min(spec.max, value)}
        onChange={(e) => onChange(normalizeLot(parseFloat(e.target.value), spec))}
        className="absolute inset-0 m-0 h-full w-full cursor-pointer appearance-none bg-transparent focus:outline-none [&::-webkit-slider-runnable-track]:h-full [&::-webkit-slider-runnable-track]:bg-transparent [&::-moz-range-track]:bg-transparent [&::-webkit-slider-thumb]:mt-0.5 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#f23645] [&::-webkit-slider-thumb]:bg-[var(--bg)] [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-solid [&::-moz-range-thumb]:border-[#f23645] [&::-moz-range-thumb]:bg-[var(--bg)]"
      />
    </span>
  );
}
