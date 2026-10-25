import type { ReactNode } from "react";
import { Svg24 } from "./icons";

// Icon công cụ vẽ: lưới 24, hiển thị 28px như TradingView, nét 1px (Svg24). Theo ngôn ngữ
// hình của TV (vẽ lại, không chép SVG của TV): điểm neo là vòng tròn rỗng, nét nối dừng ở
// mép vòng tròn; hình có đỉnh (chữ nhật, tam giác, ellipse...) có chấm neo ở đỉnh/cạnh.

type P = [number, number];
const R = 1.6; // bán kính chấm neo
const f = (n: number) => +n.toFixed(2);
let k = 0; // key cho phần tử con (icon tĩnh, chỉ cần duy nhất trong 1 icon)

const node = ([x, y]: P) => <circle key={`n${k++}`} cx={x} cy={y} r={R} />;
/** Đoạn a→b, cắt bớt R ở đầu có chấm neo để nét dừng ở mép vòng tròn. */
const link = (a: P, b: P, ta = true, tb = true) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l = Math.hypot(dx, dy) || 1;
  const p = [a[0] + (ta ? (dx / l) * R : 0), a[1] + (ta ? (dy / l) * R : 0)];
  const q = [b[0] - (tb ? (dx / l) * R : 0), b[1] - (tb ? (dy / l) * R : 0)];
  return <path key={`l${k++}`} d={`M${f(p[0])} ${f(p[1])}L${f(q[0])} ${f(q[1])}`} />;
};
/** Chuỗi điểm neo nối liền (closed: nối điểm cuối về điểm đầu). */
const chain = (pts: P[], closed = false) => (
  <>
    {pts.slice(1).map((p, i) => link(pts[i], p))}
    {closed && link(pts[pts.length - 1], pts[0])}
    {pts.map(node)}
  </>
);
/** Chữ nhỏ trên icon (sóng Elliott, Long/Short...). */
const label = (x: number, y: number, s: string) => (
  <text
    key={`t${k++}`}
    x={x}
    y={y}
    fontSize="5.2"
    fontWeight="600"
    fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
    textAnchor="middle"
    fill="currentColor"
    stroke="none"
  >
    {s}
  </text>
);
const elliott = (a: string, b: string) => (
  <>
    {chain([
      [4.5, 17.5],
      [8.5, 13],
      [12, 16.5],
      [16, 11],
      [19.5, 14.5],
    ])}
    {label(8.5, 8.5, a)}
    {label(16, 8.5, b)}
  </>
);
const fork = (handle: P, mid: P, a: P, b: P, extra?: ReactNode) => (
  <>
    {link(handle, mid, true, false)}
    {link(a, b)}
    <path d={`M${mid[0]} ${mid[1]}L${mid[0] + 7} ${mid[1] - 7}`} />
    {link(a, [a[0] + 7, a[1] - 7], true, false)}
    {link(b, [b[0] + 7, b[1] - 7], true, false)}
    {node(handle)}
    {node(a)}
    {node(b)}
    {extra}
  </>
);


// Long/Short position: toạ độ đo trên icon của TV (lưới 28px, nét 1px) đổi sang lưới 24 của Svg24: u = 2 + px / 1.4.
// Vùng lời (target) có chữ L / S, entry là đường không chấm, target và stop có vòng tròn neo ở mép trái.
const u = (px: number) => f(2 + px / 1.4);
const tvPath = (d: string) => <path key={`p${k++}`} d={d.replace(/-?\d*\.?\d+/g, (n) => String(u(+n)))} />;
const posIcon = (long: boolean) => {
  const entry = long ? 17.5 : 11.5;
  const anchor = (y: number) => (
    <>
      <circle key={`c${k++}`} cx={u(5.5)} cy={u(y)} r={f(2 / 1.4)} />
      {tvPath(`M7.5 ${y}H25`)}
    </>
  );
  return (
    <>
      {anchor(6.5)}
      {tvPath(`M5 ${entry}H25`)}
      {anchor(22.5)}
      {long
        ? tvPath("M13.5 9V14.5H17")
        : tvPath("M17.1 14.6C16.7 13.8 16 13.5 15.4 13.5C14.4 13.5 13.7 14.1 13.7 14.9C13.7 16.9 17.3 16.1 17.3 18.5C17.3 19.5 16.5 20.5 15.4 20.5C14.5 20.5 13.8 20.1 13.5 19.3")}
    </>
  );
};

const ICONS: Record<string, ReactNode> = {
  // --- lines -------------------------------------------------------------------
  trendline: chain([
    [5.5, 18.5],
    [18.5, 5.5],
  ]),
  ray: (
    <>
      {link([5.5, 18.5], [11.5, 12.5])}
      {link([11.5, 12.5], [19.5, 4.5], true, false)}
      {node([5.5, 18.5])}
      {node([11.5, 12.5])}
    </>
  ),
  infoline: (
    <>
      {chain([
        [5, 17],
        [15.5, 6.5],
      ])}
      <rect x="14" y="14" width="6.5" height="5" rx="1.5" />
    </>
  ),
  extended: (
    <>
      {link([3.5, 20.5], [9, 15], false, true)}
      {link([9, 15], [15, 9])}
      {link([15, 9], [20.5, 3.5], true, false)}
      {node([9, 15])}
      {node([15, 9])}
    </>
  ),
  trendangle: (
    <>
      {chain([
        [5.5, 18.5],
        [17.5, 7.5],
      ])}
      {link([5.5, 18.5], [19.5, 18.5], true, false)}
      <path d="M11.5 18.5a6 6 0 0 0-1.6-4.1" />
    </>
  ),
  hline: (
    <>
      {link([3.5, 12], [12, 12], false, true)}
      {link([12, 12], [20.5, 12], true, false)}
      {node([12, 12])}
    </>
  ),
  hray: (
    <>
      {link([5.5, 12], [20.5, 12], true, false)}
      {node([5.5, 12])}
    </>
  ),
  vline: (
    <>
      {link([12, 3.5], [12, 12], false, true)}
      {link([12, 12], [12, 20.5], true, false)}
      {node([12, 12])}
    </>
  ),
  crossline: (
    <>
      {link([3.5, 12], [12, 12], false, true)}
      {link([12, 12], [20.5, 12], true, false)}
      {link([12, 3.5], [12, 12], false, true)}
      {link([12, 12], [12, 20.5], true, false)}
      {node([12, 12])}
    </>
  ),
  // channels
  channel: (
    <>
      {chain([
        [4.5, 12.5],
        [12.5, 4.5],
      ])}
      {chain([
        [11.5, 19.5],
        [19.5, 11.5],
      ])}
    </>
  ),
  regression: (
    <>
      <path d="M4.5 11l15-5.5v5L4.5 16z" />
      <path d="M4.5 13.5l15-5.5" />
      {link([4.5, 19.5], [19.5, 14], false, false)}
    </>
  ),
  flat: (
    <>
      {chain([
        [5.5, 11.5],
        [18.5, 5.5],
      ])}
      {chain([
        [5.5, 17.5],
        [18.5, 17.5],
      ])}
    </>
  ),
  disjoint: (
    <>
      {chain([
        [5.5, 11.5],
        [18.5, 5.5],
      ])}
      {chain([
        [5.5, 14],
        [18.5, 18.5],
      ])}
    </>
  ),
  // pitchforks
  pitchfork: fork([5.5, 18.5], [10.5, 13.5], [7.5, 10.5], [13.5, 16.5]),
  schiff: fork([7.5, 19.5], [11.5, 14.5], [8.5, 11.5], [14.5, 17.5], <path d="M3.5 19.5h2.4" />),
  mschiff: fork([6.5, 19.5], [11, 14], [8, 11], [14, 17], <path d="M3.5 19.5h1.4M3.5 17.5h4" />),
  insidefork: (
    <>
      {link([5.5, 19], [9, 12.5])}
      {link([9, 12.5], [13.5, 15.5])}
      <path d="M11.2 14l4.5-9.5" />
      {link([9, 12.5], [12.5, 4.5], true, false)}
      {link([13.5, 15.5], [18, 6.5], true, false)}
      {node([5.5, 19])}
      {node([9, 12.5])}
      {node([13.5, 15.5])}
    </>
  ),

  // --- fib & gann --------------------------------------------------------------
  fib: (
    <>
      <path d="M3.5 5.5h14.4M3.5 9.5h17M3.5 13.5h17M6.1 18.5h14.4" />
      {node([19.5, 5.5])}
      {node([4.5, 18.5])}
    </>
  ),
  fibext: (
    <>
      {chain([
        [5, 9],
        [14.5, 4.5],
      ])}
      <path d="M3.5 13h17M3.5 16h17M3.5 19h17" />
    </>
  ),
  fibchannel: (
    <>
      {chain([
        [4.5, 11.5],
        [12.5, 4.5],
      ])}
      <path d="M5 16.5l13-11M8 19.5l13-11" />
    </>
  ),
  fibtimezone: (
    <>
      {chain([
        [5.5, 7],
        [9.5, 17],
      ])}
      {link([5.5, 7], [5.5, 20.5], true, false)}
      {link([9.5, 17], [9.5, 3.5], true, false)}
      <path d="M14 3.5v17M19.5 3.5v17" />
    </>
  ),
  fibfan: (
    <>
      {link([5.5, 18.5], [19.5, 4.5], true, false)}
      {link([5.5, 18.5], [20, 10], true, false)}
      {link([5.5, 18.5], [20, 15], true, false)}
      {link([5.5, 18.5], [10, 4], true, false)}
      {link([5.5, 18.5], [15, 4], true, false)}
      <path d="M5.5 4v12.9M7.1 18.5H20" opacity=".6" />
      {node([5.5, 18.5])}
    </>
  ),
  fibtimeext: (
    <>
      {chain([
        [4.5, 9],
        [7.5, 18.5],
      ])}
      <path d="M12 3.5v17M15.5 3.5v17M19.5 3.5v17" />
    </>
  ),
  fibcircles: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="5.8" />
      <circle cx="12" cy="12" r="3.3" />
      {node([12, 12])}
    </>
  ),
  fibspiral: (
    <>
      <path d="M13.6 12a1.6 1.6 0 1 1 1.4 2.5 3.8 3.8 0 0 1-5.3-1.3 6 6 0 0 1 3-8.2 8 8 0 0 1 7.5 1.5" />
      {node([12, 12])}
    </>
  ),
  fibarcs: (
    <>
      <path d="M3.5 16.5a8.5 8.5 0 0 1 17 0M6.5 16.5a5.5 5.5 0 0 1 11 0M9.5 16.5a2.5 2.5 0 0 1 2.5-2.5" />
      {link([12, 18], [17.5, 5.5], true, false)}
      {node([12, 18])}
    </>
  ),
  fibwedge: (
    <>
      {link([5.5, 18.5], [5.5, 4.5], true, true)}
      {link([5.5, 18.5], [19.5, 18.5], true, true)}
      <path d="M5.5 11.5a7 7 0 0 1 7 7M5.5 8a10.5 10.5 0 0 1 10.5 10.5" />
      {node([5.5, 18.5])}
      {node([5.5, 4.5])}
      {node([19.5, 18.5])}
    </>
  ),
  pitchfan: (
    <>
      {link([5.5, 18.5], [12, 3.5], true, false)}
      {link([5.5, 18.5], [17, 5], true, false)}
      {link([5.5, 18.5], [20.5, 10], true, false)}
      {link([10.5, 9], [16.5, 15], true, true)}
      {node([5.5, 18.5])}
      {node([10.5, 9])}
      {node([16.5, 15])}
    </>
  ),
  gannbox: (
    <>
      <path d="M5.5 7.1V18.5h11.4M7.1 5.5H18.5v11.4" />
      <path d="M5.5 9.8h13M5.5 14.2h13M9.8 5.5v13M14.2 5.5v13" />
      {node([5.5, 5.5])}
      {node([18.5, 18.5])}
    </>
  ),
  gannsqfixed: (
    <>
      <rect x="5.5" y="5.5" width="13" height="13" />
      <path d="M5.5 12h13M12 5.5v13M5.5 18.5L18.5 5.5M5.5 18.5L18.5 12M5.5 18.5L12 5.5" />
      {node([5.5, 18.5])}
    </>
  ),
  gannsquare: (
    <>
      <rect x="5.5" y="5.5" width="13" height="13" />
      <path d="M5.5 12h13M12 5.5v13M5.5 18.5L18.5 5.5M5.5 5.5l13 13M5.5 18.5L18.5 12M5.5 18.5L12 5.5" />
      {node([5.5, 18.5])}
      {node([18.5, 5.5])}
    </>
  ),
  gannfan: (
    <>
      {link([5.5, 18.5], [19.5, 4.5], true, true)}
      {link([5.5, 18.5], [20, 11], true, false)}
      {link([5.5, 18.5], [20, 15.5], true, false)}
      {link([5.5, 18.5], [12, 3.5], true, false)}
      {link([5.5, 18.5], [8.5, 3.5], true, false)}
      {node([5.5, 18.5])}
      {node([19.5, 4.5])}
    </>
  ),

  // --- patterns ----------------------------------------------------------------
  xabcd: (
    <>
      {chain([
        [4.5, 18.5],
        [8, 5.5],
        [12, 13],
        [16, 5.5],
        [19.5, 18.5],
      ])}
      {link([4.5, 18.5], [12, 13])}
      {link([12, 13], [19.5, 18.5])}
    </>
  ),
  cypher: (
    <>
      {chain([
        [4.5, 18.5],
        [8, 5.5],
        [12, 11.5],
        [16, 5.5],
        [19.5, 15],
      ])}
      {link([4.5, 18.5], [12, 11.5])}
      {label(12.5, 21, "c")}
    </>
  ),
  headshoulders: chain([
    [3.5, 17.5],
    [6.5, 11],
    [9, 15],
    [12, 5.5],
    [15, 15],
    [17.5, 11],
    [20.5, 17.5],
  ]),
  abcd: (
    <>
      {chain([
        [5, 17.5],
        [9, 5.5],
        [15, 12],
        [19, 4.5],
      ])}
      {link([5, 17.5], [15, 12])}
    </>
  ),
  trianglepattern: (
    <>
      {chain([
        [4.5, 5.5],
        [19.5, 11.5],
        [4.5, 18.5],
      ])}
      {link([4.5, 5.5], [11.5, 15.5])}
      {link([11.5, 15.5], [15, 9.5])}
      {node([11.5, 15.5])}
      {node([15, 9.5])}
    </>
  ),
  threedrives: chain([
    [3.5, 19],
    [6, 13.5],
    [8.5, 16.5],
    [11.5, 9.5],
    [14, 12.5],
    [17, 5],
    [20.5, 8],
  ]),
  elliottimpulse: elliott("1", "5"),
  elliottcorrection: elliott("A", "C"),
  elliotttriangle: elliott("A", "E"),
  elliottdouble: elliott("W", "Y"),
  elliotttriple: elliott("W", "Z"),
  // cycles
  cyclic: (
    <>
      {chain([
        [5, 8],
        [9, 16],
      ])}
      {link([5, 8], [5, 20.5], true, false)}
      {link([5, 8], [5, 3.5], true, false)}
      {link([9, 16], [9, 3.5], true, false)}
      {link([9, 16], [9, 20.5], true, false)}
      <path d="M13.5 3.5v17M18 3.5v17" />
    </>
  ),
  timecycles: (
    <>
      <path d="M5.1 13.5a3.5 3.5 0 0 0 6.9 0M12 13.5a3.5 3.5 0 0 0 6.9 0" />
      {node([3.5, 13.5])}
      {node([12, 13.5])}
      {node([20.5, 13.5])}
    </>
  ),
  sine: (
    <>
      <path d="M5.1 13.2C6.5 6 9 6 11 12s4.5 6 6.5-1" />
      {node([4.5, 14.5])}
    </>
  ),

  // --- forecasting & measurement -------------------------------------------------
  longpos: posIcon(true),
  shortpos: posIcon(false),
  forecast: (
    <>
      <path d="M6 4.5v15M10.5 6v12" />
      <rect x="4.5" y="8" width="3" height="7" rx=".5" />
      <rect x="9" y="9" width="3" height="5" rx=".5" />
      <path d="M16.5 5v2.5M16.5 10v2.5M14.5 15.5l2 2 2-2" />
    </>
  ),
  barspattern: (
    <>
      <path d="M5.5 4.5v15M11 6v12.5M16.5 5v14" />
      <rect x="4" y="8" width="3" height="7" rx=".5" />
      <rect x="9.5" y="9" width="3" height="6" rx=".5" />
      <rect x="15" y="8.5" width="3" height="7" rx=".5" />
    </>
  ),
  ghost: (
    <>
      {link([4, 14.5], [7.5, 14.5], true, false)}
      {node([4, 14.5])}
      <path d="M9.5 6v13M14 4.5v13" />
      <rect x="8" y="9" width="3" height="6" rx=".5" />
      <rect x="12.5" y="7.5" width="3" height="6" rx=".5" />
      {node([19, 7.5])}
    </>
  ),
  sector: (
    <>
      {link([5.5, 5.5], [5.5, 18.5])}
      {link([5.5, 18.5], [18.5, 18.5])}
      <path d="M7.1 5.6A13 13 0 0 1 18.4 16.9" />
      {node([5.5, 5.5])}
      {node([5.5, 18.5])}
      {node([18.5, 18.5])}
    </>
  ),
  avwap: (
    <>
      {link([4, 14], [20, 7], true, false)}
      {node([4, 14])}
      <path d="M10 5.5v13M15 4.5v13" />
      <rect x="8.5" y="8.5" width="3" height="6" rx=".5" />
      <rect x="13.5" y="7" width="3" height="7" rx=".5" />
    </>
  ),
  frvp: (
    <>
      <path d="M4.5 4.5v15M4.5 6.5h5M4.5 9.5h7M4.5 12.5h4M4.5 15.5h6" />
      {link([17.5, 5], [17.5, 20], true, false)}
      {node([17.5, 5])}
    </>
  ),
  avp: (
    <>
      {link([4.5, 12], [10, 12], true, false)}
      {node([4.5, 12])}
      <path d="M19.5 4.5v15M19.5 6.5h-5M19.5 9.5h-7M19.5 12.5h-4M19.5 15.5h-6M19.5 18h-3" />
    </>
  ),
  pricerange: (
    <>
      {link([4.5, 5.5], [18.5, 5.5], false, true)}
      {node([18.5, 5.5])}
      {link([5.5, 18.5], [19.5, 18.5], true, false)}
      {node([5.5, 18.5])}
      <path d="M12 16.5v-9M10 9.5l2-2 2 2" />
    </>
  ),
  daterange: (
    <>
      {link([5.5, 18.5], [5.5, 4.5], true, false)}
      {node([5.5, 18.5])}
      {link([18.5, 5.5], [18.5, 19.5], true, false)}
      {node([18.5, 5.5])}
      <path d="M7.5 12h9M14.5 10l2 2-2 2" />
    </>
  ),
  daterangeprice: (
    <>
      <path d="M7.1 18.5H18.5V7.1M16.9 5.5H5.5v11.4" />
      <path d="M12 16v-8M10 10l2-2 2 2M8 12h8M14 10l2 2-2 2" />
      {node([5.5, 18.5])}
      {node([18.5, 5.5])}
    </>
  ),
  measure: (
    <>
      <rect x="3" y="9" width="18" height="6" rx=".5" transform="rotate(-40 12 12)" />
      <path d="M8.6 13.4l1.4 1.4M11 11l1.4 1.4M13.3 8.7l1.4 1.4" />
    </>
  ),
  zoom: (
    <>
      <circle cx="9.5" cy="9.5" r="5" />
      <path d="M13.2 13.2l4.8 4.8M9.5 7.3v4.4M7.3 9.5h4.4" />
    </>
  ),

  // --- brushes / arrows / shapes ---------------------------------------------------
  brush: (
    <>
      <path d="M4 19.5c2.5.5 5-.5 5.5-3.5l1.5-1.5 2.5 2.5-1.5 1.5c-2.5.5-4.5 2-8 1z" />
      <path d="M12 15l7-8.5" />
      <path d="M17.5 4.5l2 2" />
    </>
  ),
  highlighter: (
    <>
      <path d="M6.5 15.5l9-9 3 3-9 9-4 1z" />
      <path d="M14 8l3 3M4.5 20h6" />
    </>
  ),
  arrowmarker: <path d="M5.5 18.5l9-9-2.5-2.5h7.5v7.5l-2.5-2.5-9 9z" />,
  arrow: (
    <>
      {link([5.5, 18.5], [17.5, 6.5], true, false)}
      {node([5.5, 18.5])}
      <path d="M12.5 6.5h5v5" />
    </>
  ),
  arrowup: <path d="M12 4.5l6.5 7H15v8H9v-8H5.5z" />,
  arrowdown: <path d="M12 19.5l6.5-7H15v-8H9v8H5.5z" />,
  rect: chain(
    [
      [5.5, 6.5],
      [18.5, 6.5],
      [18.5, 17.5],
      [5.5, 17.5],
    ],
    true,
  ),
  rotrect: chain(
    [
      [4, 13],
      [10.5, 5.5],
      [20, 11],
      [13.5, 18.5],
    ],
    true,
  ),
  path: (
    <>
      {chain([
        [4, 15],
        [8, 11],
        [12, 15],
      ])}
      {link([12, 15], [19, 8], true, false)}
      <path d="M15.5 8h3.5v3.5" />
    </>
  ),
  circle: (
    <>
      <circle cx="12" cy="12" r="7.5" />
      {node([12, 12])}
    </>
  ),
  ellipse: (
    <>
      <path d="M5.6 12.6C7 15.5 9.6 16.9 12 16.9s5-1.4 6.4-4.3M18.4 11.4C17 8.5 14.4 7.1 12 7.1S7 8.5 5.6 11.4" />
      {node([4, 12])}
      {node([20, 12])}
    </>
  ),
  polyline: chain(
    [
      [6, 6],
      [12, 4.5],
      [17.5, 8.5],
      [13.5, 12.5],
      [18, 18],
      [8, 19],
      [4.5, 12.5],
    ],
    true,
  ),
  triangle: chain(
    [
      [5.5, 5.5],
      [5.5, 18.5],
      [18.5, 18.5],
    ],
    true,
  ),
  arc: (
    <>
      <path d="M6.3 17.4A11 11 0 0 0 17.4 6.3" />
      {link([5.5, 18.5], [18.5, 5.5])}
      {node([5.5, 18.5])}
      {node([18.5, 5.5])}
    </>
  ),
  curve: (
    <>
      <path d="M5.7 16.9C7 10 11 6 16.9 5.7" />
      {node([5.5, 18.5])}
      {node([18.5, 5.5])}
    </>
  ),
  doublecurve: (
    <>
      <path d="M7 18.5c5 0 5-6.5 5-6.5s0-6.5 5-6.5" />
      {node([5.5, 18.5])}
      {node([18.5, 5.5])}
    </>
  ),

  // --- text & notes ------------------------------------------------------------------
  text: <path d="M6 7V5.5h12V7M12 5.5v13M9.5 18.5h5" />,
  note: (
    <>
      <rect x="5.5" y="4.5" width="13" height="10" rx="1" />
      <path d="M9.5 7.5h5M12 7.5v4.5M12 14.5v3.4" />
      {node([12, 19.5])}
    </>
  ),
  pricenote: (
    <>
      <rect x="5.5" y="4.5" width="13" height="10" rx="1" />
      <path d="M13.5 7.5H11a1.25 1.25 0 0 0 0 2.5h2a1.25 1.25 0 0 1 0 2.5h-2.5M12 6.5v1M12 12.5v1M12 14.5v3.4" />
      {node([12, 19.5])}
    </>
  ),
  pin: (
    <>
      <path d="M12 20s-6-5.5-6-10.5a6 6 0 0 1 12 0c0 5-6 10.5-6 10.5z" />
      <circle cx="12" cy="9.5" r="2.2" />
    </>
  ),
  table: (
    <>
      <rect x="4.5" y="5.5" width="15" height="13" rx="1" />
      <path d="M4.5 9.5h15M4.5 14h15M10 5.5v13" />
    </>
  ),
  callout: <path d="M5.5 5.5h13v10H9.5l-4 3.5z" />,
  comment: <path d="M9.5 6.5h5a5 5 0 0 1 0 10h-9v-5a5 5 0 0 1 5-5z" />,
  pricelabel: (
    <>
      <path d="M8 5.5h11.5v9H11l-2.5 2.6" />
      <path d="M8 5.5v7" />
      {node([6.8, 18.8])}
    </>
  ),
  signpost: (
    <>
      <circle cx="12" cy="9.5" r="6" />
      <path d="M12 6.6l.9 1.9 2.1.3-1.5 1.4.4 2.1-1.9-1-1.9 1 .4-2.1-1.5-1.4 2.1-.3z" />
      <path d="M12 15.5v5" />
    </>
  ),
  flag: <path d="M6.5 20.5v-15M6.5 5.5h12l-3 4 3 4h-12" />,
  image: (
    <>
      <rect x="4.5" y="5.5" width="15" height="13" rx="1.5" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="M4.5 16.5l4.5-4 3.5 3 2.5-2 4.5 4" />
    </>
  ),
  post: <path d="M5.5 5.5l13 13M18.5 5.5l-13 13" />,
  idea: (
    <>
      <path d="M12 4a5.5 5.5 0 0 0-3.2 10V16h6.4v-2A5.5 5.5 0 0 0 12 4z" />
      <path d="M9.5 18.5h5M10.5 20.5h3" />
    </>
  ),
  emoji: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8.5 14c1.5 2.5 5.5 2.5 7 0" />
      <circle cx="9.5" cy="10" r=".6" fill="currentColor" />
      <circle cx="14.5" cy="10" r=".6" fill="currentColor" />
    </>
  ),

  // --- cursors ---------------------------------------------------------------------
  cross: <path d="M12 4v6M12 14v6M4 12h6M14 12h6" />,
  dotc: <circle cx="12" cy="12" r="1.8" fill="currentColor" />,
  arrowc: <path d="M7.5 4.5v14l3.7-3.5 2.6 5.5 2.2-1-2.6-5.4h5.1z" />,
  demo: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9.5 7.5v9l2.3-2.2 1.6 3.4 1.4-.6-1.6-3.3h3.1z" />
    </>
  ),
  magic: (
    <>
      <path d="M5 19L15.5 8.5" />
      <path d="M17.5 3.5v3M16 5h3M19.5 8.5v2M18.5 9.5h2M13 4v1.5M12.25 4.75h1.5" />
    </>
  ),
  eraser: (
    <>
      <path d="M5.5 15.5l8.5-8.5 5 5-6 6H8z" />
      <path d="M10.5 10.5l5 5M9 20h10" />
    </>
  ),
};

export function ToolIcon({ id, size = 28 }: { id: string; size?: number }) {
  return <Svg24 size={size}>{ICONS[id] ?? <circle cx="12" cy="12" r="6" />}</Svg24>;
}
