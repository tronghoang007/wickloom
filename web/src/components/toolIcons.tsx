import type { ReactNode } from "react";
import { Svg24 } from "./icons";

// Icon công cụ vẽ: lưới 24, hiển thị 28px như TradingView, nét 1px (Svg24). Chấm điều
// khiển là vòng tròn rỗng như TV.
function Dot({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={1.6} />;
}

const dot = (x: number, y: number) => <Dot key={`${x}-${y}`} x={x} y={y} />;
const zig = (pts: [number, number][]) => (
  <>
    <path d={`M${pts.map((p) => p.join(" ")).join("L")}`} />
    {pts.map(([x, y]) => dot(x, y))}
  </>
);

const ICONS: Record<string, ReactNode> = {
  // lines
  trendline: (
    <>
      <path d="M6.6 17.4L17.4 6.6" />
      {dot(5.5, 18.5)}
      {dot(18.5, 5.5)}
    </>
  ),
  ray: (
    <>
      <path d="M5 17L22 5" />
      {dot(5, 17)}
    </>
  ),
  infoline: (
    <>
      <path d="M4 18L15 7" />
      {dot(4, 18)}
      {dot(15, 7)}
      <rect x="14" y="13" width="7" height="6" />
    </>
  ),
  extended: (
    <>
      <path d="M2 21L22 3" />
      {dot(8, 15.5)}
      {dot(16, 8.5)}
    </>
  ),
  trendangle: (
    <>
      <path d="M4 19L19 7M4 19h16" />
      {dot(4, 19)}
      {dot(19, 7)}
      <path d="M11 19a7 7 0 00-2-5" />
    </>
  ),
  hline: (
    <>
      <path d="M3 12h18" />
      {dot(12, 12)}
    </>
  ),
  hray: (
    <>
      <path d="M6 12h16" />
      {dot(5, 12)}
    </>
  ),
  vline: (
    <>
      <path d="M12 3v18" />
      {dot(12, 12)}
    </>
  ),
  crossline: (
    <>
      <path d="M12 3v18M3 12h18" />
      {dot(12, 12)}
    </>
  ),
  channel: (
    <>
      <path d="M4 16L18 6M6 20L20 10" strokeDasharray="0" />
      <path d="M5 18L19 8" strokeDasharray="2 2" />
    </>
  ),
  regression: (
    <>
      <path d="M4 17L20 8M4 12L20 3M4 22L20 13" />
    </>
  ),
  flat: (
    <>
      <path d="M4 18L19 8M5 5h15" />
      {dot(4, 18)}
      {dot(19, 8)}
    </>
  ),
  disjoint: (
    <>
      <path d="M3 12L13 5M11 20L21 13" />
      {dot(3, 12)}
      {dot(13, 5)}
    </>
  ),
  pitchfork: (
    <>
      <path d="M4 18L20 6M8 6l12 0M4 18l4-12M4 18l12 4M9 4l13 14" />
    </>
  ),
  schiff: (
    <>
      <path d="M5 17L21 6M8 5l14 8M5 17l3-12M12 4l9 12" />
    </>
  ),
  mschiff: (
    <>
      <path d="M5 18L21 8M8 5l14 9M5 18l3-13M11 4l10 14" />
    </>
  ),
  insidefork: (
    <>
      <path d="M4 18L21 5M8 5l13 10M4 18l4-13M12 4l9 11M6 12l15-7" />
    </>
  ),
  // fib & gann
  fib: (
    <>
      <path d="M3.5 5.5h14.4M3.5 9.5h17M3.5 13.5h17M6.1 18.5h14.4" />
      {dot(19.5, 5.5)}
      {dot(4.5, 18.5)}
    </>
  ),
  fibext: (
    <>
      <path d="M4 7h16M4 12h16M4 17h16M3 20L9 6M9 6l5 12" strokeDasharray="0" />
    </>
  ),
  fibchannel: (
    <>
      <path d="M3 18L21 8M3 14L21 4M3 22L21 12" />
    </>
  ),
  fibtimezone: (
    <>
      <path d="M5 3v18M9 3v18M14 3v18M20 3v18M3 12h6" />
    </>
  ),
  fibfan: (
    <>
      <path d="M4 20L21 5M4 20L21 10M4 20L21 15M4 20L21 20" />
    </>
  ),
  fibtimeext: (
    <>
      <path d="M4 4v16M8 8v12M12 4v16M17 4v16M4 20L8 8" />
    </>
  ),
  fibcircles: (
    <>
      <circle cx="12" cy="12" r="3" />
      <circle cx="12" cy="12" r="6" />
      <circle cx="12" cy="12" r="9" />
    </>
  ),
  fibspiral: (
    <path d="M12 12a1.5 1.5 0 013 0 3 3 0 01-6 0 5 5 0 0110 0 8 8 0 01-16 0" />
  ),
  fibarcs: (
    <>
      <path d="M20 4a10 10 0 010 16M17 7a6 6 0 010 10M14 10a2 2 0 010 4" />
    </>
  ),
  fibwedge: (
    <>
      <path d="M4 20L20 5M4 20L20 16M12 14a9 9 0 019 3M9 16a6 6 0 016 0" />
    </>
  ),
  pitchfan: (
    <>
      <path d="M4 18L20 4M4 18L20 9M4 18L20 14M4 18L20 19" />
      {dot(4, 18)}
    </>
  ),
  gannbox: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 4l16 16M4 12h16M12 4v16" />
    </>
  ),
  gannsqfixed: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M4 20L20 4M9 4v16M15 4v16M4 9h16M4 15h16" />
    </>
  ),
  gannsquare: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M3 19L21 5M3 5l18 14M12 5v14M3 12h18" />
    </>
  ),
  gannfan: (
    <>
      <path d="M4 20L20 4M4 20L20 8M4 20L20 12M4 20L12 4M4 20L8 4" />
    </>
  ),
  // patterns
  xabcd: zig([
    [4, 18],
    [8, 6],
    [13, 14],
    [17, 4],
    [21, 16],
  ]),
  cypher: zig([
    [4, 18],
    [8, 6],
    [13, 14],
    [17, 4],
    [21, 16],
  ]),
  headshoulders: zig([
    [2, 17],
    [5, 11],
    [8, 15],
    [12, 5],
    [16, 15],
    [19, 11],
    [22, 17],
  ]),
  abcd: zig([
    [4, 18],
    [9, 6],
    [15, 16],
    [20, 5],
  ]),
  trianglepattern: zig([
    [4, 18],
    [9, 5],
    [14, 15],
    [19, 9],
  ]),
  threedrives: zig([
    [2, 18],
    [5, 10],
    [8, 14],
    [11, 6],
    [14, 11],
    [17, 3],
    [21, 9],
  ]),
  elliottimpulse: zig([
    [3, 19],
    [7, 10],
    [10, 14],
    [15, 4],
    [18, 9],
    [22, 6],
  ]),
  elliottcorrection: zig([
    [3, 6],
    [9, 16],
    [14, 10],
    [21, 20],
  ]),
  elliotttriangle: zig([
    [3, 15],
    [7, 5],
    [10, 17],
    [14, 8],
    [17, 15],
    [21, 11],
  ]),
  elliottdouble: zig([
    [3, 18],
    [8, 6],
    [13, 14],
    [20, 5],
  ]),
  elliotttriple: zig([
    [3, 18],
    [7, 8],
    [11, 15],
    [15, 6],
    [18, 13],
    [22, 4],
  ]),
  cyclic: (
    <>
      <path d="M5 3v18M10 3v18M15 3v18M20 3v18" />
    </>
  ),
  timecycles: (
    <>
      <path d="M2 16a5 6 0 0110 0 5 6 0 0110 0" />
    </>
  ),
  sine: <path d="M2 12c3-9 6-9 10 0s7 9 10 0" />,
  // forecasting
  longpos: (
    <>
      <rect x="4" y="4" width="16" height="7" />
      <rect x="4" y="11" width="16" height="8" strokeDasharray="2 2" />
      <path d="M4 11h16" />
    </>
  ),
  shortpos: (
    <>
      <rect x="4" y="13" width="16" height="7" />
      <rect x="4" y="5" width="16" height="8" strokeDasharray="2 2" />
      <path d="M4 13h16" />
    </>
  ),
  forecast: (
    <>
      <path d="M5 5v14M10 8v10M15 6v12M20 4v14" />
    </>
  ),
  barspattern: (
    <>
      <path d="M5 6v13M5 10h3M5 15h-2M12 4v10M12 8h3M12 13h-2M19 8v11" />
    </>
  ),
  ghost: (
    <>
      <path d="M3 15l4-4 3 3 4-6 3 4 4-5" strokeDasharray="2 2" />
    </>
  ),
  sector: (
    <>
      <path d="M4 18L20 18M4 18L17 6" />
      <path d="M14 18a10 10 0 00-3-9" />
      {dot(4, 18)}
    </>
  ),
  avwap: (
    <>
      <path d="M5 6v13M9 4v11M14 8v10M3 14c4-4 8-1 18-8" />
    </>
  ),
  frvp: (
    <>
      <path d="M5 4v16M5 6h8M5 10h12M5 14h6M5 18h9" />
    </>
  ),
  avp: (
    <>
      <path d="M3 4v16M3 6h6M3 10h11M3 14h8M3 18h5" />
      {dot(3, 4)}
    </>
  ),
  pricerange: (
    <>
      <path d="M12 4v16M9 7l3-3 3 3M9 17l3 3 3-3M5 4h14M5 20h14" />
    </>
  ),
  daterange: (
    <>
      <path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3M4 5v14M20 5v14" />
    </>
  ),
  daterangeprice: (
    <>
      <rect x="4" y="4" width="16" height="16" />
      <path d="M12 4v16M4 12h16" />
    </>
  ),
  measure: (
    <>
      <rect x="3" y="9" width="18" height="7" transform="rotate(-35 12 12)" />
      <path d="M8 14l1-1M11 12l1-1M14 10l1-1" />
    </>
  ),
  zoom: (
    <>
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16l5 5M11 8v6M8 11h6" />
    </>
  ),
  // brushes / shapes
  brush: (
    <>
      <path d="M4 20c4 0 6-3 6-5l9-9-3-3-9 9c-2 0-3 4-3 8z" />
    </>
  ),
  highlighter: (
    <>
      <path d="M5 19l3-1 10-10-3-3L5 15zM4 21h8" />
    </>
  ),
  arrowmarker: (
    <>
      <path d="M5 19L18 6M12 5l7 0 0 7" />
    </>
  ),
  arrow: (
    <>
      <path d="M5 19L19 5M10 5h9v9" />
    </>
  ),
  arrowup: <path d="M12 4l7 8h-4v8H9v-8H5z" />,
  arrowdown: <path d="M12 20l7-8h-4V4H9v8H5z" />,
  rect: <rect x="5" y="6" width="14" height="12" />,
  rotrect: <path d="M4 12L12 4l8 8-8 8z" />,
  path: (
    <>
      <path d="M4 18c3-8 7-2 10-8l6-3" />
      {dot(4, 18)}
      {dot(20, 7)}
    </>
  ),
  circle: <circle cx="12" cy="12" r="8" />,
  ellipse: <ellipse cx="12" cy="12" rx="9" ry="6" />,
  polyline: zig([
    [4, 17],
    [8, 6],
    [16, 9],
    [20, 18],
  ]),
  triangle: <path d="M4 19L12 5l8 14z" />,
  arc: (
    <>
      <path d="M4 18A12 12 0 0120 18" />
      {dot(4, 18)}
      {dot(20, 18)}
    </>
  ),
  curve: (
    <>
      <path d="M4 19C10 19 20 15 20 5" />
      {dot(4, 19)}
      {dot(20, 5)}
    </>
  ),
  doublecurve: (
    <>
      <path d="M4 19C12 19 12 5 20 5" />
      {dot(4, 19)}
      {dot(20, 5)}
    </>
  ),
  // text
  text: <path d="M6 7V5.5h12V7M12 5.5v13M9.5 18.5h5" />,
  note: (
    <>
      <rect x="4" y="3" width="16" height="12" />
      <path d="M9 7h6M12 7v5M12 15v4" />
      {dot(12, 20)}
    </>
  ),
  pricenote: (
    <>
      <rect x="4" y="3" width="16" height="12" />
      <path d="M12 6v6M10 8h3a1.5 1.5 0 010 3h-3M12 15v4" />
      {dot(12, 20)}
    </>
  ),
  pin: (
    <>
      <path d="M12 21s-6-6-6-11a6 6 0 0112 0c0 5-6 11-6 11z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  table: (
    <>
      <rect x="4" y="5" width="16" height="14" />
      <path d="M4 10h16M4 14h16M10 5v14" />
    </>
  ),
  callout: <path d="M4 5h16v11h-8l-4 4v-4H4z" />,
  comment: (
    <path d="M5 5h14a2 2 0 012 2v7a2 2 0 01-2 2H9l-5 4V7a2 2 0 011-2z" />
  ),
  pricelabel: <path d="M3 12l5-5h13v10H8z" />,
  signpost: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="M12 15v6M12 6l1 2 2 .3-1.5 1.4.4 2.1L12 10.8 10.100 11.800l.4-2.100L9 8.300 11 8z" />
    </>
  ),
  flag: (
    <>
      <path d="M6 21V4M6 5h13l-3 4 3 4H6" />
    </>
  ),
  image: (
    <>
      <rect x="4" y="5" width="16" height="14" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4 17l5-4 4 3 3-2 4 3" />
    </>
  ),
  post: <path d="M5 5l14 14M19 5L5 19" />,
  idea: (
    <>
      <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3 11c.5.5 1 1.500 1 2h4c0-.5.5-1.500 1-2a6 6 0 00-3-11z" />
    </>
  ),
  emoji: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="9" cy="10" r="1" />
      <circle cx="15" cy="10" r="1" />
      <path d="M8 14c1 2 7 2 8 0" />
    </>
  ),
  eraser: (
    <>
      <path d="M4 16l9-9 6 6-6 6H8z" />
      <path d="M9 21h11" />
    </>
  ),
  cross: <path d="M12 4v6M12 14v6M4 12h6M14 12h6" />,
  dotc: (
    <>
      <circle cx="12" cy="12" r="1.500" fill="currentColor" />
    </>
  ),
  arrowc: <path d="M5 3l14 8-6 2-2 6z" />,
};

export function ToolIcon({ id, size = 28 }: { id: string; size?: number }) {
  return <Svg24 size={size}>{ICONS[id] ?? <circle cx="12" cy="12" r="6" />}</Svg24>;
}
