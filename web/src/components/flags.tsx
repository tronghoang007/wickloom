import type { ReactNode } from "react";

// Cờ vẽ tay trên khung vuông 24×24 (người gọi cắt thành vòng tròn). Đơn giản hoá cho cỡ 16-40px: sọc, chữ thập, vài hình tượng trưng, không cố vẽ huy hiệu chi tiết.
const R = (x: number, y: number, w: number, h: number, fill: string, key?: string | number) => <rect key={key} x={x} y={y} width={w} height={h} fill={fill} />;
const H3 = (a: string, b: string, c: string) => (
  <>
    {R(0, 0, 24, 8.01, a)}
    {R(0, 8, 24, 8.01, b)}
    {R(0, 16, 24, 8, c)}
  </>
);
const V3 = (a: string, b: string, c: string) => (
  <>
    {R(0, 0, 8.01, 24, a)}
    {R(8, 0, 8.01, 24, b)}
    {R(16, 0, 8, 24, c)}
  </>
);
const H2 = (a: string, b: string) => (
  <>
    {R(0, 0, 24, 12.01, a)}
    {R(0, 12, 24, 12, b)}
  </>
);

/** Đa giác sao `n` cánh (R ngoài, r trong) tâm (cx, cy), một đỉnh hướng lên. */
export function starPoints(cx: number, cy: number, R_: number, r: number, n = 5): string {
  const pts: string[] = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n;
    const rad = i % 2 === 0 ? R_ : r;
    pts.push(`${(cx + rad * Math.sin(a)).toFixed(2)},${(cy - rad * Math.cos(a)).toFixed(2)}`);
  }
  return pts.join(" ");
}
const Star = ({ cx, cy, R: rr, r, fill, n = 5, stroke }: { cx: number; cy: number; R: number; r?: number; fill: string; n?: number; stroke?: string }) => (
  <polygon points={starPoints(cx, cy, rr, r ?? rr * 0.42, n)} fill={fill} stroke={stroke} strokeWidth={stroke ? 0.5 : undefined} />
);

const union = () => (
  <>
    {R(0, 0, 24, 24, "#012169")}
    <path d="M0 0L24 24M24 0L0 24" stroke="#fff" strokeWidth="4.8" />
    <path d="M0 0L24 24M24 0L0 24" stroke="#c8102e" strokeWidth="1.8" />
    <path d="M12 0V24M0 12H24" stroke="#fff" strokeWidth="7" />
    <path d="M12 0V24M0 12H24" stroke="#c8102e" strokeWidth="4" />
  </>
);

const FLAGS: Record<string, () => ReactNode> = {
  US: () => (
    <>
      {R(0, 0, 24, 24, "#fff")}
      {[0, 2, 4, 6].map((i) => R(0, (i * 24) / 7, 24, 24 / 7 + 0.01, "#b22234", i))}
      {R(0, 0, 11.5, 13.7, "#3c3b6e")}
      {[3, 6, 9].flatMap((x) => [3.2, 6.4, 9.6].map((y) => <circle key={`${x}${y}`} cx={x - (y === 6.4 ? 1.4 : 0)} cy={y} r="0.8" fill="#fff" />))}
    </>
  ),
  EU: () => (
    <>
      {R(0, 0, 24, 24, "#039")}
      {Array.from({ length: 12 }, (_, k) => (
        <circle key={k} cx={(12 + 6.3 * Math.sin((k * Math.PI) / 6)).toFixed(2)} cy={(12 - 6.3 * Math.cos((k * Math.PI) / 6)).toFixed(2)} r="1" fill="#fc0" />
      ))}
    </>
  ),
  GB: union,
  JP: () => (
    <>
      {R(0, 0, 24, 24, "#fff")}
      <circle cx="12" cy="12" r="6.4" fill="#bc002d" />
    </>
  ),
  AU: () => (
    <>
      {R(0, 0, 24, 24, "#012169")}
      <g transform="scale(.5)">{union()}</g>
      <Star cx={6} cy={18.5} R={3.2} fill="#fff" n={7} r={1.8} />
      {[[17.5, 5.5], [21, 11], [14.5, 12.5], [17.5, 19]].map(([x, y]) => (
        <Star key={`${x}${y}`} cx={x} cy={y} R={1.7} fill="#fff" />
      ))}
    </>
  ),
  NZ: () => (
    <>
      {R(0, 0, 24, 24, "#012169")}
      <g transform="scale(.5)">{union()}</g>
      {[[17.5, 6], [21, 12], [14.5, 13], [17.5, 19.5]].map(([x, y]) => (
        <Star key={`${x}${y}`} cx={x} cy={y} R={2} fill="#cc142b" stroke="#fff" />
      ))}
    </>
  ),
  CA: () => (
    <>
      {R(0, 0, 24, 24, "#fff")}
      {R(0, 0, 6, 24, "#d80621")}
      {R(18, 0, 6, 24, "#d80621")}
      <path d="M12 4.2l1.5 2.8 1.9-.9-.8 4.3 1.9-1.6.6 1.4 2.4-.4-.7 2.4 1 .7-4 3.3.4 1.2-3.2-.7.1 4.1h-1.4l.1-4.1-3.2.7.4-1.2-4-3.3 1-.7-.7-2.4 2.4.4.6-1.4 1.9 1.6-.8-4.3 1.9.9z" fill="#d80621" />
    </>
  ),
  CH: () => (
    <>
      {R(0, 0, 24, 24, "#d52b1e")}
      {R(10.2, 5, 3.6, 14, "#fff")}
      {R(5, 10.2, 14, 3.6, "#fff")}
    </>
  ),
  CN: () => (
    <>
      {R(0, 0, 24, 24, "#de2910")}
      <Star cx={7.5} cy={8} R={3.6} fill="#ffde00" />
      {[[12.8, 3.6], [15, 6.4], [15, 9.8], [12.8, 12.6]].map(([x, y]) => (
        <Star key={`${x}${y}`} cx={x} cy={y} R={1.1} fill="#ffde00" />
      ))}
    </>
  ),
  HK: () => (
    <>
      {R(0, 0, 24, 24, "#de2910")}
      {Array.from({ length: 5 }, (_, k) => (
        <ellipse key={k} cx={12} cy={7.8} rx="1.9" ry="3.1" fill="#fff" transform={`rotate(${k * 72} 12 12)`} />
      ))}
      <circle cx="12" cy="12" r="1" fill="#de2910" />
    </>
  ),
  SG: () => (
    <>
      {H2("#ed2939", "#fff")}
      <circle cx="7" cy="6" r="4" fill="#fff" />
      <circle cx="8.9" cy="6" r="3.6" fill="#ed2939" />
      {[[11.5, 3.2], [14, 5.2], [13.1, 8.2], [10, 8.2], [9.2, 5.2]].map(([x, y]) => (
        <Star key={`${x}${y}`} cx={x} cy={y} R={1.1} fill="#fff" />
      ))}
    </>
  ),
  SE: () => (
    <>
      {R(0, 0, 24, 24, "#006aa7")}
      {R(7, 0, 4, 24, "#fecc00")}
      {R(0, 10, 24, 4, "#fecc00")}
    </>
  ),
  NO: () => (
    <>
      {R(0, 0, 24, 24, "#ba0c2f")}
      {R(6, 0, 6, 24, "#fff")}
      {R(0, 9, 24, 6, "#fff")}
      {R(7.5, 0, 3, 24, "#00205b")}
      {R(0, 10.5, 24, 3, "#00205b")}
    </>
  ),
  DK: () => (
    <>
      {R(0, 0, 24, 24, "#c8102e")}
      {R(7, 0, 3.6, 24, "#fff")}
      {R(0, 10.2, 24, 3.6, "#fff")}
    </>
  ),
  IS: () => (
    <>
      {R(0, 0, 24, 24, "#02529c")}
      {R(6, 0, 5.4, 24, "#fff")}
      {R(0, 9.3, 24, 5.4, "#fff")}
      {R(7.4, 0, 2.6, 24, "#dc1e35")}
      {R(0, 10.7, 24, 2.6, "#dc1e35")}
    </>
  ),
  PL: () => H2("#fff", "#dc143c"),
  CZ: () => (
    <>
      {H2("#fff", "#d7141a")}
      <path d="M0 0L12.5 12L0 24Z" fill="#11457e" />
    </>
  ),
  HU: () => H3("#cd2a3e", "#fff", "#436f4d"),
  RU: () => H3("#fff", "#0039a6", "#d52b1e"),
  DE: () => H3("#000", "#dd0000", "#ffce00"),
  FR: () => V3("#0055a4", "#fff", "#ef4135"),
  IT: () => V3("#009246", "#fff", "#ce2b37"),
  ES: () => (
    <>
      {R(0, 0, 24, 24, "#aa151b")}
      {R(0, 6, 24, 12, "#f1bf00")}
    </>
  ),
  NL: () => H3("#ae1c28", "#fff", "#21468b"),
  RO: () => V3("#002b7f", "#fcd116", "#ce1126"),
  BG: () => H3("#fff", "#00966e", "#d62612"),
  NG: () => V3("#008751", "#fff", "#008751"),
  MX: () => (
    <>
      {V3("#006847", "#fff", "#ce1126")}
      <circle cx="12" cy="12" r="2.4" fill="#a47a3a" />
    </>
  ),
  TR: () => (
    <>
      {R(0, 0, 24, 24, "#e30a17")}
      <circle cx="9.5" cy="12" r="5.6" fill="#fff" />
      <circle cx="11" cy="12" r="4.5" fill="#e30a17" />
      <Star cx={15.6} cy={12} R={2.7} fill="#fff" />
    </>
  ),
  ZA: () => (
    <>
      {H2("#e03c31", "#001489")}
      <path d="M0 2.6L9.6 12L0 21.4M9.6 12H24" stroke="#fff" strokeWidth="8" fill="none" />
      <path d="M0 2.6L9.6 12L0 21.4M9.6 12H24" stroke="#007749" strokeWidth="4.6" fill="none" />
      <path d="M0 3.4L0 20.6L10.4 12Z" fill="#ffb81c" />
      <path d="M0 6L0 18L7.2 12Z" fill="#000" />
    </>
  ),
  IL: () => (
    <>
      {R(0, 0, 24, 24, "#fff")}
      {R(0, 3.5, 24, 3, "#0038b8")}
      {R(0, 17.5, 24, 3, "#0038b8")}
      <polygon points="12,7.4 16.3,14.9 7.7,14.9" fill="none" stroke="#0038b8" strokeWidth="1" />
      <polygon points="12,16.6 7.7,9.1 16.3,9.1" fill="none" stroke="#0038b8" strokeWidth="1" />
    </>
  ),
  IN: () => (
    <>
      {H3("#f93", "#fff", "#138808")}
      <circle cx="12" cy="12" r="2.6" fill="none" stroke="#000080" strokeWidth="0.9" />
    </>
  ),
  TH: () => (
    <>
      {R(0, 0, 24, 24, "#a51931")}
      {R(0, 4, 24, 4, "#f4f5f8")}
      {R(0, 8, 24, 8, "#2d2a4a")}
      {R(0, 16, 24, 4, "#f4f5f8")}
    </>
  ),
  BR: () => (
    <>
      {R(0, 0, 24, 24, "#009739")}
      <path d="M12 3.2L21.8 12L12 20.8L2.2 12Z" fill="#fedd00" />
      <circle cx="12" cy="12" r="4.4" fill="#002776" />
    </>
  ),
  KR: () => (
    <>
      {R(0, 0, 24, 24, "#fff")}
      <path d="M7.4 12a4.6 4.6 0 0 1 9.2 0z" fill="#cd2e3a" />
      <path d="M7.4 12a4.6 4.6 0 0 0 9.2 0z" fill="#0047a0" />
      {[[2.5, 3.5], [17.5, 3.5], [2.5, 19.5], [17.5, 19.5]].map(([x, y]) => R(x, y, 4, 1.2, "#000", `${x}${y}`))}
    </>
  ),
  TW: () => (
    <>
      {R(0, 0, 24, 24, "#fe0000")}
      {R(0, 0, 12, 12, "#000095")}
      <circle cx="6" cy="6" r="2.6" fill="#fff" />
    </>
  ),
  BW: () => (
    <>
      {R(0, 0, 24, 24, "#75aadb")}
      {R(0, 9, 24, 6, "#fff")}
      {R(0, 10, 24, 4, "#000")}
    </>
  ),
  ID: () => H2("#ce1126", "#fff"),
  AE: () => (
    <>
      {R(0, 0, 24, 8.01, "#00732f")}
      {R(0, 8, 24, 8.01, "#fff")}
      {R(0, 16, 24, 8, "#000")}
      {R(0, 0, 7, 24, "#f00")}
    </>
  ),
  EG: () => (
    <>
      {H3("#ce1126", "#fff", "#000")}
      <circle cx="12" cy="12" r="1.8" fill="#c09300" />
    </>
  ),
  AR: () => (
    <>
      {H3("#74acdf", "#fff", "#74acdf")}
      <circle cx="12" cy="12" r="2.2" fill="#f6b40e" />
    </>
  ),
  CO: () => (
    <>
      {R(0, 0, 24, 12, "#fcd116")}
      {R(0, 12, 24, 6, "#003893")}
      {R(0, 18, 24, 6, "#ce1126")}
    </>
  ),
  UA: () => H2("#0057b7", "#ffd700"),
  PH: () => (
    <>
      {H2("#0038a8", "#ce1126")}
      <path d="M0 0L13 12L0 24Z" fill="#fff" />
      <circle cx="3.8" cy="12" r="2" fill="#fcd116" />
    </>
  ),
  VN: () => (
    <>
      {R(0, 0, 24, 24, "#da251d")}
      <Star cx={12} cy={12.4} R={6.8} fill="#ff0" />
    </>
  ),
  MA: () => (
    <>
      {R(0, 0, 24, 24, "#c1272d")}
      <polygon points={starPoints(12, 12.4, 5.6, 2.2)} fill="none" stroke="#006233" strokeWidth="1" />
    </>
  ),
  TN: () => (
    <>
      {R(0, 0, 24, 24, "#e70013")}
      <circle cx="12" cy="12" r="6" fill="#fff" />
      <circle cx="13" cy="12" r="4.2" fill="#e70013" />
      <Star cx={12.8} cy={12} R={2} fill="#fff" />
    </>
  ),
};

export const FLAG_CODES = Object.keys(FLAGS);

/** Hình cờ của mã nước (khung 24×24); mã lạ → ô xám. */
export function FlagArt({ code }: { code: string }): ReactNode {
  const draw = FLAGS[code];
  return draw ? draw() : R(0, 0, 24, 24, "#787b86");
}
