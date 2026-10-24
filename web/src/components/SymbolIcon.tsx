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

// Logo coin vẽ lại bằng path (không dựa vào font: ₿ Ξ Ł Ð ₳ ₮ không có trong mọi font) trong khung 24×24, nền là màu thương hiệu của COINS. Coin không có ở đây vẽ chữ đầu của mã.
const W = { fill: "none", stroke: "#fff", strokeLinecap: "round", strokeLinejoin: "round" } as const;
const polar = (r: number, deg: number): [number, number] => [12 + r * Math.cos((deg * Math.PI) / 180), 12 + r * Math.sin((deg * Math.PI) / 180)];
const BtcMark = () => (
  <g transform="rotate(14 12 12)" {...W} strokeWidth="1.9">
    <path d="M9.600 6.400h3.900a2.350 2.350 0 0 1 0 4.700H9.600zM9.600 11.100h4.500a2.700 2.700 0 0 1 0 5.400H9.600zM11.300 4.600v1.800M13.500 4.600v1.800M11.300 16.500v1.900M13.500 16.500v1.900" />
  </g>
);
const COIN_ART: Record<string, ReactNode> = {
  BTC: <BtcMark />,
  BCH: <BtcMark />,
  ETH: (
    <>
      <path d="M12 4.200L6.800 12.300 12 15.200z" fill="#fff" fillOpacity=".6" />
      <path d="M12 4.200l5.200 8.100-5.200 2.900z" fill="#fff" />
      <path d="M12 16.200l-5.200-3 5.200 7.200z" fill="#fff" fillOpacity=".6" />
      <path d="M12 16.200l5.200-3-5.200 7.200z" fill="#fff" />
    </>
  ),
  XRP: <path d="M6.800 6.800L12 11.800l5.200-5M6.800 17.200l5.200-5 5.200 5" {...W} strokeWidth="1.9" />,
  LTC: <path d="M11.300 5.800L9.200 15.700h6.400M7.400 12.600l6.800-2.600" {...W} strokeWidth="1.9" />,
  DOGE: <path d="M9.200 6.600h2.900a5.400 5.400 0 0 1 0 10.800H9.200zM6.800 12h7.400" {...W} strokeWidth="1.8" />,
  ADA: (
    <>
      <circle cx="12" cy="12" r="1.5" fill="#fff" />
      {[0, 60, 120, 180, 240, 300].map((d) => <circle key={d} cx={polar(4.300, d)[0]} cy={polar(4.300, d)[1]} r="0.95" fill="#fff" />)}
      {[30, 90, 150, 210, 270, 330].map((d) => <circle key={d} cx={polar(7.300, d)[0]} cy={polar(7.300, d)[1]} r="0.8" fill="#fff" />)}
    </>
  ),
  DOT: (
    <g fill="#fff">
      <ellipse cx="12" cy="6.600" rx="1.900" ry="2.700" />
      <ellipse cx="12" cy="17.400" rx="1.900" ry="2.700" />
      <circle cx="7" cy="9.200" r="1.900" />
      <circle cx="17" cy="9.200" r="1.900" />
      <circle cx="7" cy="14.800" r="1.900" />
      <circle cx="17" cy="14.800" r="1.900" />
    </g>
  ),
  SOL: (
    <>
      <defs>
        <linearGradient id="coin-sol" x1="5" y1="19" x2="19" y2="5" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#14f195" />
          <stop offset="1" stopColor="#9945ff" />
        </linearGradient>
      </defs>
      <g fill="url(#coin-sol)">
        <path d="M8 6.400h10.200l-2.200 2.600H5.800z" />
        <path d="M5.800 10.700H16l2.200 2.600H8z" />
        <path d="M8 15h10.200l-2.200 2.600H5.800z" />
      </g>
    </>
  ),
  LINK: <path d="M12 5.200l5.900 3.400v6.800L12 18.800l-5.900-3.400V8.600z" {...W} strokeWidth="2.200" />,
  BNB: (
    <g fill="#fff">
      <path d="M12 9.700l2.300 2.300-2.300 2.300-2.300-2.300z" />
      <path d="M12 4.800l2.400 2.400-1.400 1.400-1-1-1 1-1.400-1.400zM12 19.200l-2.400-2.400 1.400-1.400 1 1 1-1 1.400 1.400zM4.800 12l2.400-2.400 1.400 1.400-1 1 1 1-1.400 1.400zM19.200 12l-2.400 2.400-1.400-1.400 1-1-1-1 1.400-1.400z" />
    </g>
  ),
  USDT: <path d="M7.200 7.400h9.600M12 7.400v10.200M8.400 11.800h7.200" {...W} strokeWidth="1.9" />,
  XTZ: <path d="M8.600 7h6.800M12 7v8.400a2.200 2.200 0 0 0 4 1.200M8.800 11.200l6.400-1.800" {...W} strokeWidth="1.8" />,
  THETA: <path d="M12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM8.800 12h6.400" {...W} strokeWidth="1.8" />,
  HBAR: <path d="M8.200 6.400v11.200M15.800 6.400v11.200M8.200 9.800h7.600M8.200 14.200h7.600" {...W} strokeWidth="1.8" />,
};

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
      if (COIN_ART[g.sym])
        return (
          <>
            <Disc fill={c?.color ?? hashColor(g.sym)} />
            {COIN_ART[g.sym]}
          </>
        );
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
