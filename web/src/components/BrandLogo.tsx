"use client";

import { useId } from "react";

const PETALS = [-68, -34, 0, 34, 68];

/** Dấu hiệu Wickloom (wick + bloom): nến xanh, râu nến nở thành bông sen. Cùng nét vẽ với app/icon.svg nhưng không có nền ô vuông,
 *  viền cánh lấy màu nền (var(--bg)) để các cánh tách nhau trên cả chart tối lẫn sáng. */
export function BrandMark({ height = 20 }: { height?: number }) {
  const uid = useId().replace(/:/g, ""); // id gradient riêng cho từng chỗ dùng (nhiều pane cùng hiện logo)
  const petal = `${uid}p`;
  const body = `${uid}b`;
  return (
    <svg width={(height * 18) / 27} height={height} viewBox="7 3 18 27" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={petal} x1="0" y1="1" x2="0" y2="0">
          <stop offset="0" stopColor="#ff4f8b" />
          <stop offset="1" stopColor="#ffd54a" />
        </linearGradient>
        <linearGradient id={body} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3df0c0" />
          <stop offset="1" stopColor="#0c9a80" />
        </linearGradient>
      </defs>
      <path d="M16 13v5M16 25.400v3.400" stroke="#19d3a2" strokeWidth="1.600" strokeLinecap="round" />
      <rect x="12.400" y="17.400" width="7.200" height="8.600" rx="2.200" fill={`url(#${body})`} />
      <g transform="translate(16 13.400)">
        {PETALS.map((deg) => (
          <path
            key={deg}
            transform={`rotate(${deg})`}
            d="M0 0C-3.400-2.400-3.600-6.600 0-9.200 3.600-6.600 3.400-2.400 0 0Z"
            fill={`url(#${petal})`}
            stroke="var(--bg)"
            strokeWidth=".4"
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}

/** Logo có chữ: dấu hiệu + "Wick" đậm + "loom" mảnh phủ gradient vàng→hồng như bông hoa. `watermark` = bản mờ, không chắn chuột, đặt góc trái-dưới chart như logo TV. */
export default function BrandLogo({ size = 20, watermark = false }: { size?: number; watermark?: boolean }) {
  return (
    <span
      role="img"
      aria-label="Wickloom"
      className={`inline-flex select-none items-center gap-1.5 ${watermark ? "pointer-events-none opacity-70" : ""}`}
    >
      <BrandMark height={size} />
      <span aria-hidden="true" className="leading-none tracking-[-0.02em]" style={{ fontSize: size * 0.72 }}>
        <span className="font-bold text-[var(--fg)]">Wick</span>
        <span className="bg-gradient-to-r from-[#ffd54a] to-[#ff4f8b] bg-clip-text font-medium text-transparent">loom</span>
      </span>
    </span>
  );
}
