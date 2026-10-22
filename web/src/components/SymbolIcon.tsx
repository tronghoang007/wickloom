"use client";

import { COINS, hashColor, iconSpec, type Glyph } from "@/lib/symbolIcon";
import { useId, type ReactNode } from "react";
import { FlagArt } from "./flags";

// Màu thỏi theo kim loại (vàng #d69a00 như logo vàng của TV)
const METAL_COLOR: Record<string, string> = {
  XAU: "#d69a00", XAG: "#9aa5b1", XPT: "#8e9bab", XPD: "#7a8a99", XCU: "#c26a3b", XAL: "#8fa4b5", XNI: "#7d8a8f", XPB: "#6f7378", XZN: "#8a9bb0",
};

const Bar = ({ x, y }: { x: number; y: number }) => <path d={`M${x + 1.3} ${y}h5.4l1.3 5.3H${x}z`} fill="#fff" />;
const Disc = ({ fill }: { fill: string }) => <rect width="24" height="24" fill={fill} />;

/** Ký hiệu trong khung vuông 24×24 (người gọi cắt thành vòng tròn). */
function GlyphArt({ g }: { g: Glyph }): ReactNode {
  switch (g.t) {
    case "flag":
      return <FlagArt code={g.code} />;
    case "metal":
      return (
        <>
          <Disc fill={METAL_COLOR[g.m] ?? "#9aa5b1"} />
          <Bar x={3.5} y={12.4} />
          <Bar x={12.5} y={12.4} />
          <Bar x={8} y={6.6} />
        </>
      );
    case "coin": {
      const c = COINS[g.sym];
      const text = c ? c.glyph : g.sym.slice(0, 2);
      return (
        <>
          <Disc fill={c?.color ?? hashColor(g.sym)} />
          <text x="12" y="12.2" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize={text.length > 1 ? 10 : 15}>
            {text}
          </text>
        </>
      );
    }
    case "oil":
      return (
        <>
          <Disc fill={g.brent ? "#0f172a" : "#27272a"} />
          <path d="M12 4.3C12 4.3 6.6 10.2 6.6 14.3a5.4 5.4 0 0 0 10.8 0C17.4 10.2 12 4.3 12 4.3z" fill="#fff" />
          <path d="M9.4 14.6a2.7 2.7 0 0 0 2.2 2.6" fill="none" stroke="#27272a" strokeWidth="1.2" strokeLinecap="round" />
        </>
      );
    case "gas":
      return (
        <>
          <Disc fill="#1d6fd6" />
          <path d="M12 3.8c.6 3.2-3.8 5.2-3.8 9.3a3.8 3.8 0 0 0 7.6 0c0-1.9-1.1-3-1.9-4.1-.8-1.1-1.5-2.2-1.9-5.2z" fill="#fff" />
          <path d="M12 19c-1.3 0-2.2-1-2.2-2.2 0-1.5 1.5-2.2 2.2-3.7.7 1.5 2.2 2.2 2.2 3.7 0 1.2-.9 2.2-2.2 2.2z" fill="#1d6fd6" />
        </>
      );
    case "dxy":
      return (
        <>
          <Disc fill="#1c4e8f" />
          <text x="12" y="12.4" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize="15">
            $
          </text>
        </>
      );
    case "text":
      return (
        <>
          <Disc fill={g.color} />
          <text x="12" y="12.4" textAnchor="middle" dominantBaseline="central" fill="#fff" fontFamily="Arial, Helvetica, sans-serif" fontWeight="700" fontSize={g.text.length >= 3 ? 8.5 : g.text.length === 2 ? 11 : 14}>
            {g.text}
          </text>
        </>
      );
  }
}

/** Icon symbol dùng chung (hộp tìm kiếm, watchlist, nút symbol ở thanh trên): cặp tiền = hai lá cờ tròn chồng nhau (base trên trái), crypto = đồng coin, kim loại = thỏi,
 *  dầu / khí / chỉ số đô la có biểu tượng riêng, chỉ số = cờ nước, cổ phiếu = chữ đầu của mã. Phân loại ở `lib/symbolIcon.ts`. */
export function SymbolBadge({ name, type, size = 24 }: { name: string; type?: string; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const { base, quote } = iconSpec(name, type);
  if (!quote) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0" role="img" aria-label={name}>
        <defs>
          <clipPath id={`c${uid}`}>
            <circle cx="12" cy="12" r="12" />
          </clipPath>
        </defs>
        <g clipPath={`url(#c${uid})`}>
          <GlyphArt g={base} />
        </g>
      </svg>
    );
  }
  // hai vòng nhỏ chồng nhau: quote vẽ trước (dưới), base đè lên; viền cùng màu nền để tách hai vòng
  const r = 8;
  const place = (id: string, c: number, g: Glyph) => (
    <>
      <clipPath id={id}>
        <circle cx={c} cy={c} r={r} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <g transform={`translate(${c - r} ${c - r}) scale(${(2 * r) / 24})`}>
          <GlyphArt g={g} />
        </g>
      </g>
      <circle cx={c} cy={c} r={r} fill="none" style={{ stroke: "var(--bg)" }} strokeWidth="1.1" />
    </>
  );
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0" role="img" aria-label={name}>
      {place(`q${uid}`, 15.8, quote)}
      {place(`b${uid}`, 8.2, base)}
    </svg>
  );
}

/** Lá cờ tròn đơn lẻ (lịch kinh tế, chú giải...): `code` là mã nước như trong `components/flags.tsx` (US, EU, GB...). */
export function FlagBadge({ code, size = 18 }: { code: string; size?: number }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0" aria-hidden>
      <defs>
        <clipPath id={`f${uid}`}>
          <circle cx="12" cy="12" r="12" />
        </clipPath>
      </defs>
      <g clipPath={`url(#f${uid})`}>
        <FlagArt code={code} />
      </g>
    </svg>
  );
}
