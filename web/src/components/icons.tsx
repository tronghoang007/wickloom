import type { ReactNode } from "react";

// Chuẩn icon dùng chung toàn app: viewBox 24, stroke 1.5, dot-marker 1.6 - khớp "trọng
// lượng" của icon TradingView. Mọi icon mới (generic hay tool) nên đi qua đây, không tự
// vẽ wrapper <svg> riêng ở từng component.
export function Svg({ children, size = 20 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export const DOT_R = 1.6;
export function Dot({ x, y }: { x: number; y: number }) {
  return <circle cx={x} cy={y} r={DOT_R} />;
}

export const Trend = () => (
  <Svg>
    <path d="M5 19L19 5" />
    <Dot x={5} y={19} />
    <Dot x={19} y={5} />
  </Svg>
);
export const Ray = () => (
  <Svg>
    <path d="M5 17L21 5" />
    <Dot x={5} y={17} />
  </Svg>
);
export const Arrow = () => (
  <Svg>
    <path d="M5 19L19 5M10 5h9v9" />
  </Svg>
);
export const Fib = () => (
  <Svg>
    <path d="M4 5h16M4 10h16M4 14h16M4 19h16" />
    <path d="M7 19L17 5" strokeDasharray="2 2" />
  </Svg>
);
export const Magnet = () => (
  <Svg>
    <path d="M6 4v8a6 6 0 0012 0V4h-4v8a2 2 0 01-4 0V4z" />
    <path d="M6 8h4M14 8h4" />
  </Svg>
);
export const Trash = () => (
  <Svg>
    <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />
  </Svg>
);
export const Undo = () => (
  <Svg size={20}>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h10a6 6 0 010 12h-3" />
  </Svg>
);
export const Redo = () => (
  <Svg size={20}>
    <path d="M15 14l5-5-5-5" />
    <path d="M20 9H10a6 6 0 000 12h3" />
  </Svg>
);
export const Search = () => (
  <Svg size={18}>
    <circle cx="11" cy="11" r="6" />
    <path d="M16 16l5 5" />
  </Svg>
);
export const Close = () => (
  <Svg size={20}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
);
export const ClearX = () => (
  <svg width={16} height={16} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="12" r="9" opacity=".5" />
    <path d="M9 9l6 6M15 9l-6 6" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const Chevron = () => (
  <Svg size={14}>
    <path d="M6 9l6 6 6-6" />
  </Svg>
);
export const Plus = () => (
  <Svg size={18}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);
export const PlusCircle = () => (
  <Svg size={22}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8v8M8 12h8" />
  </Svg>
);
export const Replay = () => (
  <Svg size={20}>
    <path d="M11 6l-7 6 7 6zM20 6l-7 6 7 6z" />
  </Svg>
);
export const Candles = () => (
  <Svg>
    <path d="M8 4v3M8 15v4M16 7v3M16 18v3" />
    <rect x="6" y="7" width="4" height="8" />
    <rect x="14" y="10" width="4" height="8" />
  </Svg>
);
export const BarsIcon = () => (
  <Svg>
    <path d="M8 4v16M5 8h3M16 4v16M16 15h3" />
  </Svg>
);
export const LineIcon = () => (
  <Svg>
    <path d="M3 17l5-6 4 4 8-9" />
  </Svg>
);
export const AreaIcon = () => (
  <Svg>
    <path d="M3 17l5-6 4 4 8-9v13H3z" />
  </Svg>
);
export const Heikin = () => (
  <Svg>
    <path d="M8 3v4M8 17v4M16 5v3M16 16v4" />
    <rect x="6" y="7" width="4" height="10" />
    <rect x="14" y="8" width="4" height="8" />
  </Svg>
);

// --- icon dùng trong Toolbar/DrawingToolbar/IndicatorsDialog, trước đây mỗi nơi tự vẽ
// 1 wrapper riêng (strokeWidth lệch nhau) - gộp về đây, dùng chung Svg chuẩn ở trên.
export const CompareI = () => (
  <Svg size={22}>
    <path d="M8 4v3M8 17v3M16 8v3M16 18v2" />
    <rect x="6" y="7" width="4" height="10" />
    <rect x="14" y="11" width="4" height="7" />
  </Svg>
);
export const IndicatorsI = () => (
  <Svg size={22}>
    <path d="M3 20h18M4 15l4-5 4 3 5-7" />
    <path d="M16 4h4v4" />
  </Svg>
);
export const TemplatesI = () => (
  <Svg size={22}>
    <rect x="4" y="4" width="6" height="6" />
    <rect x="14" y="4" width="6" height="6" />
    <rect x="4" y="14" width="6" height="6" />
    <path d="M17 14v6M14 17h6" />
  </Svg>
);
export const AlertI = () => (
  <Svg size={22}>
    <circle cx="12" cy="13" r="7" />
    <path d="M12 9v4l3 2M5 4L3 6M19 4l2 2" />
  </Svg>
);
export const LayoutI = () => (
  <Svg size={22}>
    <rect x="4" y="4" width="16" height="16" rx="2" />
  </Svg>
);
export const QuickSearchI = () => (
  <Svg size={22}>
    <circle cx="10" cy="10" r="6" />
    <path d="M15 15l5 5M9 7l-1 4h3l-1 3" />
  </Svg>
);
export const SettingsI = () => (
  <Svg size={22}>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
export const FullscreenI = () => (
  <Svg size={22}>
    <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
  </Svg>
);
export const CameraI = () => (
  <Svg size={22}>
    <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
    <circle cx="12" cy="13" r="3.5" />
  </Svg>
);
export const IdeaI = () => (
  <Svg size={22}>
    <path d="M9 18h6M10 21h4M12 3a6 6 0 00-3 11c.5.5 1 1.5 1 2h4c0-.5.5-1.5 1-2a6 6 0 00-3-11z" />
  </Svg>
);
export const SunI = () => (
  <Svg size={22}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
  </Svg>
);
export const MoonI = () => (
  <Svg size={22}>
    <path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" />
  </Svg>
);

export const Stay = () => (
  <Svg size={22}>
    <path d="M4 18l1-4L15 4l4 4L9 18z" />
    <rect x="14" y="14" width="7" height="6" rx="1" />
    <path d="M15.5 14v-1.5a2 2 0 014 0V14" />
  </Svg>
);
export const Lock = ({ open }: { open: boolean }) => (
  <Svg size={22}>
    <rect x="5" y="11" width="14" height="9" rx="1" />
    <path d={open ? "M8 11V8a4 4 0 017.5-2" : "M8 11V8a4 4 0 018 0v3"} />
  </Svg>
);
export const Eye = ({ off }: { off: boolean }) => (
  <Svg size={22}>
    <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M4 20L20 4" />}
  </Svg>
);
export const WatchlistI = () => (
  <Svg size={22}>
    <path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" />
  </Svg>
);
export const CalendarI = () => (
  <Svg size={22}>
    <rect x="4" y="5" width="16" height="15" rx="1" />
    <path d="M4 9h16M8 3v4M16 3v4" />
    <path d="M8 13h2M12 13h2M16 13h2M8 17h2M12 17h2" />
  </Svg>
);
export const SkipToLatest = () => (
  <Svg size={18}>
    <path d="m5 6 6 6-6 6M13 6l6 6-6 6" />
  </Svg>
);
export const StarI = ({ on, size = 16 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
    <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" />
  </svg>
);
