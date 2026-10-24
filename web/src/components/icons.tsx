import type { ReactNode } from "react";

// Chuẩn icon toàn app theo TradingView: vẽ trên lưới 28, hiển thị 28px, nét 1px.
// viewBox cắt 2 đơn vị viền mỗi bên (VIEW) để hình chiếm khung nhiều như icon TV (đo
// getBBox: TV ~18-24px trong khung 28); strokeWidth = VIEW/size nên ở cỡ nào cũng đúng 1px.
// Icon mới nên đi qua đây, không tự vẽ wrapper <svg> riêng ở từng component.
const VIEW = 24;
export function Svg({ children, size = 28 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={`2 2 ${VIEW} ${VIEW}`}
      overflow="visible"
      fill="none"
      stroke="currentColor"
      strokeWidth={VIEW / size}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Như `Svg` nhưng cho path vẽ trên lưới 24 (icon công cụ vẽ, panel cũ): hiển thị 28px,
 *  nét 1px, cắt viền 2 đơn vị để hình to ngang icon TV. */
export function Svg24({ children, size = 28 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="2 2 20 20"
      overflow="visible"
      fill="none"
      stroke="currentColor"
      strokeWidth={20 / size}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

/** Như `Svg` nhưng toạ độ = pixel trên lưới 28 của TradingView (nét 1px): icon nào cần khớp
 *  đúng kích thước từng icon của TV (đo getBBox trên TV) thì vẽ bằng cái này, không bị
 *  phóng 1.17 lần như `Svg`. */
export function Tv({ children, size = 28 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 28 28"
      overflow="visible"
      fill="none"
      stroke="currentColor"
      strokeWidth={28 / size}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

// strong: thêm 1 tia ở giữa để phân biệt Strong / Weak magnet
export const Magnet = ({ strong = false }: { strong?: boolean }) => (
  <Tv>
    <path d="M6.5 5.5h5v8.5a2.5 2.5 0 0 0 5 0V5.5h5v8.5a7.5 7.5 0 0 1-15 0z" />
    <path d="M6.5 9.5h5M16.5 9.5h5" />
    <path d="M9.5 23l-1.5 2h3L9.5 27.3M18.5 23l-1.5 2h3L18.5 27.3" />
    {strong && <path d="M14 23l-1.5 2h3L14 27.3" />}
  </Tv>
);
export const Trash = () => (
  <Svg>
    <path d="M6.5 8.5h15M11.5 8.5v-2h5v2" />
    <path d="M8.5 8.5l1 14h9l1-14" />
  </Svg>
);
// Undo/Redo/Replay trên TV nhỏ (~13x10, 14x11px): vẽ theo toạ độ px của TV.
export const Undo = ({ size = 28 }: { size?: number }) => (
  <Tv size={size}>
    <path d="M11.5 9L7 13.5l4.5 4.5M7.5 13.5H15a5 5 0 0 1 5 5" />
  </Tv>
);
export const Redo = ({ size = 28 }: { size?: number }) => (
  <Tv size={size}>
    <path d="M16.5 9L21 13.5 16.5 18M20.5 13.5H13a5 5 0 0 0-5 5" />
  </Tv>
);
export const Search = ({ size = 28 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12.5" cy="12.5" r="6.5" />
    <path d="M17.5 17.5l5 5" />
  </Svg>
);
export const Close = ({ size = 28 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M8.5 8.5l11 11M19.5 8.5l-11 11" />
  </Svg>
);
export const ClearX = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 28 28" fill="currentColor">
    <circle cx="14" cy="14" r="10" opacity=".85" />
    <path d="M10.5 10.5l7 7M17.5 10.5l-7 7" stroke="var(--bg)" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
export const Chevron = ({ size = 16 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M8 11.5l6 6 6-6" />
  </Svg>
);
export const Plus = ({ size = 28 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M14 6.5v15M6.5 14h15" />
  </Svg>
);
export const PlusCircle = () => (
  <Svg>
    <circle cx="14" cy="14" r="8.5" />
    <path d="M14 9.5v9M9.5 14h9" />
  </Svg>
);
export const Replay = () => (
  <Tv>
    <path d="M14.5 9v11L7.5 14.5zM21.5 9v11l-7-5.5z" />
  </Tv>
);
// Kiểu chart
export const Candles = () => (
  <Svg>
    <path d="M10.5 5.5v3M10.5 19.5v3M17.5 8.5v3M17.5 21.5v1.5" />
    <rect x="8.5" y="8.5" width="4" height="11" rx="1" />
    <rect x="15.5" y="11.5" width="4" height="10" rx="1" />
  </Svg>
);
export const BarsIcon = () => (
  <Svg>
    <path d="M10.5 5.5v17M7.5 9.5h3M10.5 18.5h3M17.5 5.5v17M14.5 15.5h3M17.5 9.5h3" />
  </Svg>
);
export const LineIcon = () => (
  <Svg>
    <path d="M4.5 19.5l6-7 4 4 8.5-9.5" />
  </Svg>
);
export const AreaIcon = () => (
  <Svg>
    <path d="M4.5 19.5l6-7 4 4 8.5-9.5V22.5h-18.5z" />
  </Svg>
);
export const Heikin = () => (
  <Svg>
    <path d="M10.5 4.5v4M10.5 19.5v4M17.5 6.5v4M17.5 18.5v4" />
    <rect x="8.5" y="8.5" width="4" height="11" />
    <rect x="15.5" y="10.5" width="4" height="8" />
  </Svg>
);

// --- toolbar trên ------------------------------------------------------------
export const CompareI = PlusCircle;
export const IndicatorsI = () => (
  <Tv>
    <path d="M6.5 12l4.5-4.5 3 3 8.5-5" />
    <rect x="7.5" y="19" width="3" height="3" rx="0.5" />
    <rect x="11.5" y="16" width="3" height="6" rx="0.5" />
    <rect x="15.5" y="18" width="3" height="4" rx="0.5" />
    <rect x="19.5" y="13" width="3" height="9" rx="0.5" />
  </Tv>
);
export const TemplatesI = () => (
  <Tv>
    <rect x="6.5" y="6.5" width="6" height="6" rx="2" />
    <rect x="15.5" y="6.5" width="6" height="6" rx="2" />
    <rect x="6.5" y="15.5" width="6" height="6" rx="2" />
    <rect x="15.5" y="15.5" width="6" height="6" rx="2" />
  </Tv>
);
export const AlertI = () => (
  <Tv>
    <path d="M4.5 9.5L9 5M18 5l4.5 4.5" />
    <path d="M20.7 12.3A8 8 0 1 0 13.5 23" />
    <path d="M13.5 10.5v5h3.5" />
    <path d="M17 21h7M20.5 17.5v7" />
  </Tv>
);
export const LayoutI = () => (
  <Tv>
    <rect x="4.5" y="5.5" width="19" height="17" rx="3.5" />
  </Tv>
);
export const SettingsI = () => (
  <Svg>
    <path d="M4.5 14l4.75-8.25h9.5L23.5 14l-4.75 8.25h-9.5z" />
    <circle cx="14" cy="14" r="3.5" />
  </Svg>
);
export const FullscreenI = () => (
  <Tv>
    <path d="M6.5 11.5v-3a2 2 0 0 1 2-2h3M16.5 6.5h3a2 2 0 0 1 2 2v3M21.5 16.5v3a2 2 0 0 1-2 2h-3M11.5 21.5h-3a2 2 0 0 1-2-2v-3" />
  </Tv>
);
export const CameraI = () => (
  <Svg>
    <path d="M5.5 10.5a2 2 0 0 1 2-2h2.5l1.5-2.5h5l1.5 2.5h2.5a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" />
    <circle cx="14" cy="15" r="3.5" />
  </Svg>
);
export const SunI = () => (
  <Svg>
    <circle cx="14" cy="14" r="4.5" />
    <path d="M14 4.5v2M14 21.5v2M4.5 14h2M21.5 14h2M7.3 7.3l1.4 1.4M19.3 19.3l1.4 1.4M7.3 20.7l1.4-1.4M19.3 8.7l1.4-1.4" />
  </Svg>
);
export const MoonI = () => (
  <Svg>
    <path d="M21.5 16.5A8.5 8.5 0 0 1 11.5 6.5a8.5 8.5 0 1 0 10 10z" />
  </Svg>
);

// --- toolbar trái ----------------------------------------------------------------
/** Mũi tên mở flyout ở mép phải nút nhóm công cụ (vùng 11px như TV), chỉ sang phải. */
export const FlyoutArrowI = () => (
  <svg width="6" height="10" viewBox="0 0 6 10" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
    <path d="M1.5 1.5L5 5 1.5 8.5" />
  </svg>
);
export const Stay = () => (
  <Svg>
    <path d="M6.5 21.5l1-4.5 10-10 3.5 3.5-10 10z" />
    <path d="M15 9.5l3.5 3.5" />
    <rect x="17.5" y="19.5" width="6" height="5" rx="1" />
    <path d="M18.75 19.5V18a1.75 1.75 0 0 1 3.5 0v1.5" />
  </Svg>
);
export const Lock = ({ open }: { open: boolean }) => (
  <Tv>
    <rect x="6.5" y="11.5" width="15" height="11" rx="2.5" />
    <path d={open ? "M10.5 11.5v-4a3.5 3.5 0 0 1 6.8-1.2" : "M10.5 11.5v-4a3.5 3.5 0 0 1 7 0v4"} />
    <path d="M14 15.5v3" />
  </Tv>
);
export const Eye = ({ off }: { off: boolean }) => (
  <Svg>
    <path d="M4.5 14s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6z" />
    <circle cx="14" cy="14" r="3" />
    {off && <path d="M6.5 21.5l15-15" />}
  </Svg>
);
export const StarI = ({ on, size = 28 }: { on: boolean; size?: number }) => (
  <svg width={size} height={size} viewBox={`2 2 ${VIEW} ${VIEW}`} overflow="visible" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth={VIEW / size} strokeLinejoin="round">
    <path d="M14 4.5l2.53 6.02 6.51.54-4.95 4.27 1.49 6.36L14 18.3l-5.58 3.39 1.49-6.36-4.95-4.27 6.51-.54z" />
  </svg>
);

// --- rail phải + linh tinh ----------------------------------------------------
// Rail phải: hình lớn như TV (~20x23px hiển thị)
export const WatchlistI = () => (
  <Svg>
    <path d="M5.5 4.5h17v20l-8.5-5-8.5 5z" />
    <path d="M9.5 10h9M9.5 14h9" />
  </Svg>
);
export const CalendarI = () => (
  <Svg>
    <rect x="4.5" y="6.5" width="19" height="17" rx="2.5" />
    <path d="M4.5 11.5h19M9.5 4.5v4M18.5 4.5v4" />
  </Svg>
);
export const SkipToLatest = ({ size = 28 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M8.5 8.5l5.5 5.5-5.5 5.5M14.5 8.5l5.5 5.5-5.5 5.5" />
  </Svg>
);

// --- context menu chart ------------------------------------------------------
export const ResetViewI = () => (
  <Svg>
    <path d="M7.5 10.5a8 8 0 1 1-1 4" />
    <path d="M6.5 6.5v4.5H11" />
  </Svg>
);
export const SellI = () => (
  <Svg>
    <path d="M8.5 10.5l5.5 4.5 5.5-4.5M8.5 15l5.5 4.5 5.5-4.5" />
  </Svg>
);
export const BuyI = () => (
  <Svg>
    <path d="M8.5 17.5l5.5-4.5 5.5 4.5M8.5 13l5.5-4.5 5.5 4.5" />
  </Svg>
);
export const AddOrderI = () => (
  <Svg>
    <path d="M17.5 5.5h-11v17h17v-11" />
    <path d="M9.5 18.5l4-4 3 2 4-5" />
    <path d="M21.5 3.5v6M18.5 6.5h6" />
  </Svg>
);

// --- tab trái dialog Settings -------------------------------------------------
export const StatusLineI = () => (
  <Svg>
    <path d="M6.5 8.5h15M6.5 13.5h10M6.5 18.5h13" />
  </Svg>
);
export const ScalesI = () => (
  <Svg>
    <path d="M7.5 5.5v15h15" />
    <path d="M5.5 7.5l2-2 2 2M20.5 18.5l2 2-2 2" />
  </Svg>
);
export const CanvasI = () => (
  <Svg>
    <path d="M17.5 6.5l4 4-11 11h-4v-4z" />
    <path d="M15 9l4 4" />
  </Svg>
);
export const TradingI = () => (
  <Svg>
    <path d="M5.5 17.5l5-5 4 3 8-8" />
    <path d="M5.5 22.5l5-5 4 3 8-8" opacity=".5" />
  </Svg>
);

// --- thanh nổi của hình đang chọn (StylePanel); chừa đáy khung cho vạch màu ----------------
export const PenI = () => (
  <Svg>
    <g transform="rotate(45 14 13)">
      <path d="M12.2 5.5h3.6v11L14 20l-1.8-3.5z" />
      <path d="M12.2 8.8h3.6" />
    </g>
  </Svg>
);
export const BucketI = () => (
  <Svg>
    <path d="M13.5 5.5L21 13l-5.8 5.8a1.6 1.6 0 0 1-2.3 0l-5.2-5.2a1.6 1.6 0 0 1 0-2.3z" />
    <path d="M7.8 12.5h12.6" />
    <path d="M22 16.5c-.8 1.2-1.4 2-1.4 2.8a1.4 1.4 0 0 0 2.8 0c0-.8-.6-1.6-1.4-2.8z" />
  </Svg>
);
export const TextColorI = () => (
  <Svg>
    <path d="M8 20.5l6-14 6 14M10.3 15.5h7.4" />
  </Svg>
);
export const DotsI = () => (
  <Svg>
    <g fill="currentColor" stroke="none">
      <circle cx="8.5" cy="14" r="1.5" />
      <circle cx="14" cy="14" r="1.5" />
      <circle cx="19.5" cy="14" r="1.5" />
    </g>
  </Svg>
);
export const AnchorI = () => (
  <Svg>
    <circle cx="14" cy="7.5" r="2" />
    <path d="M14 9.5v12M10.5 12.5h7M6.5 15.5c0 3.6 3.4 6 7.5 6s7.5-2.4 7.5-6" />
  </Svg>
);

// --- icon của trạng thái rỗng (EmptyState): vẽ trên lưới 28 như các icon khác, hiện to hơn (size) ----------
export const EmptyPositionsI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="5.5" y="10.5" width="17" height="12" rx="2" />
    <path d="M10.5 10.5v-2a1.5 1.5 0 0 1 1.5-1.5h4a1.5 1.5 0 0 1 1.5 1.5v2M5.5 15.5h17M12.5 15.5v2h3v-2" />
  </Svg>
);
export const EmptyOrdersI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="7.5" y="6.5" width="13" height="16" rx="2" />
    <path d="M11.5 5.5h5v2h-5zM10.5 12.5h7M10.5 16h7M10.5 19.5h4" />
  </Svg>
);
export const EmptyHistoryI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M5.5 14a8.5 8.5 0 1 0 2.5-6M5.5 6.5v4h4M14 9.5v5l3 2" />
  </Svg>
);
export const EmptyWatchlistI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M7.5 5.5h13v18l-6.5-4-6.5 4zM11 10.5h6M11 14h6" />
  </Svg>
);
export const EmptySearchI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <circle cx="12.5" cy="12.5" r="6.5" />
    <path d="M17.5 17.5l5 5M10 12.5h5" />
  </Svg>
);
export const EmptyCalendarI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="4.5" y="6.5" width="19" height="17" rx="2.5" />
    <path d="M4.5 11.5h19M9.5 4.5v4M18.5 4.5v4M10 16h8" />
  </Svg>
);
export const EmptyLayoutI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <rect x="4.5" y="5.5" width="19" height="17" rx="3.5" />
    <path d="M4.5 12h19M12 12v10.5" />
  </Svg>
);
export const EmptyPlugI = ({ size = 32 }: { size?: number }) => (
  <Svg size={size}>
    <path d="M10.5 5.5v4M17.5 5.5v4M7.5 9.5h13v4a6.5 6.5 0 0 1-13 0zM14 20v3.5" />
  </Svg>
);
