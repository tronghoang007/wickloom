# Plan: Wickloom dùng được trên điện thoại (responsive)

Ngày lập: 2026-10-29. Trạng thái: **M0 + M1 xong** (2026-10-29); user chọn theo khuyến nghị ở mục 9, câu 4 còn mở.

## 1. Hiện trạng (đã đọc code)

- Toàn bộ UI là một trang (`web/src/app/page.tsx`) dựng cho desktop: `Toolbar` cao 38px chứa ~20 nút → hàng giữa có
  `DrawingToolbar` (cột 52px) + `ChartGrid` + `RightRail` (cột 48px, panel mở ra rộng cố định **384px**) → `TradingPanel`
  ở đáy (bảng lệnh cao 180px).
- **Không có một `@media` / `matchMedia` nào** để đổi bố cục (chỉ có `prefers-color-scheme` trong `globals.css`).
  Trên màn 390px: toolbar tràn, rail 384px chiếm gần hết màn, chart gần như không còn chỗ.
- Dùng `h-screen` (100vh): trên iOS Safari thanh địa chỉ làm đáy trang bị che.
- Chưa khai báo `viewport` (Next 16 tự thêm `width=device-width, initial-scale=1`), chưa có safe-area cho tai thỏ / thanh home.
- Phần tương tác chart đã có nền cho cảm ứng:
  - `DrawingManager` và `trading/lineDrag.ts` dùng pointer event và **đã tắt pan/zoom của LWC trong lúc kéo bằng tay**
    (`lockChart()`), nên vẽ / kéo SL-TP bằng ngón tay về nguyên tắc chạy được.
  - LWC tự hỗ trợ kéo và pinch-zoom bằng cảm ứng.
- Phần **phụ thuộc chuột** (trên điện thoại sẽ không dùng được):
  - Nút hiện khi hover: nút Maximize của từng ô (`ChartGrid.tsx:74`, `opacity-0 group-hover`), nút trên legend pane
    (`PaneChrome.tsx`), hover drawing để chọn.
  - Menu chuột phải (`onContextMenu` → `ChartContextMenu`), double-click reset (`dblclick`), lăn chuột trên trục giá (`wheel`).
  - Phím tắt (`keydown`: ⌥A tạo alert, Delete xoá drawing, Esc…).
  - Flyout của thanh vẽ đặt theo `rect.right` của cột trái (`DrawingToolbar.tsx:47`), rộng 200–340px.
- Dialog: các hộp nhỏ (`AuthDialog`, `ConfirmHost`, `PromptDialog`, `AlertDialog`) đã có `max-w-[94vw]` nên tạm ổn;
  hộp lớn (`SettingsDialog` 827 dòng, `IndicatorSettingsDialog`, `DrawingSettings`, `LayoutMenu` 428px) chưa.
- `useLayoutStore.maximized` đã có sẵn và **không được lưu vào layout** (chỉ là trạng thái UI) → dùng lại được để
  “mobile chỉ hiện 1 chart” mà không làm hỏng layout đã lưu. Nhưng các ô bị ẩn vẫn mount (`invisible`), vẫn vẽ canvas.
- API gọi `location.hostname:8000` (`lib/api.ts:20`), backend và web bind `127.0.0.1` trong `dev.sh` / `prod.sh`;
  `prod.sh` ghi “hợp khi vào bằng 4G” → user đã có đường vào từ điện thoại, nhưng plan chưa biết đường đó là gì (xem 9.4).

## 2. Mục tiêu và nguyên tắc

- Trên điện thoại (dọc), làm được trọn vòng: **nhận alert → mở app → xem chart + orderflow → đặt / sửa SL-TP / đóng lệnh**.
  Đây là cách user trade (vàng intraday, tự vào lệnh khi alert nổ).
- **Desktop không đổi gì** (không lệch pixel so với TV-parity đã làm). Mọi thay đổi chỉ bật theo breakpoint / loại con trỏ.
- Không làm route riêng `/m`: cùng một trang, cùng store, chỉ đổi cách ghép component.
- Không đổi dữ liệu đã lưu (layout, prefs, drawings) vì đang ở mobile.

## 3. Breakpoint và cách phát hiện

| Chế độ | Điều kiện | Bố cục |
|---|---|---|
| `phone` | rộng < 768px | khung mobile (mục 4) |
| `tablet` | 768–1279px | khung desktop rút gọn (mục 8) |
| `desktop` | ≥ 1280px | giữ nguyên như hiện tại |

- Hook `useLayoutMode()` (matchMedia, cập nhật khi xoay máy) cho phần cần đổi cấu trúc component; CSS thuần thì dùng
  prefix Tailwind (`md:`, `xl:`).
- Tách riêng `(pointer: coarse)` → cờ `touch` để phóng to vùng chạm, không gắn với độ rộng (iPad + bút / laptop cảm ứng).

## 4. Khung mobile (màn dọc)

```
┌───────────────────────────────┐
│ ☰  XAUUSDm ▾  M5 ▾  ƒx   ⋯    │  thanh trên 44px
├───────────────────────────────┤
│ legend (thu gọn)              │
│                               │
│            CHART              │  1 chart, chiếm hết chỗ còn lại
│                         [✎]   │  nút vẽ nổi
│ [ SELL 2650.10 | BUY 2650.30 ]│  TradeWidget dính đáy chart
├───────────────────────────────┤
│ Chart  Watchlist  Alerts  Lịch  Lệnh │  tab bar đáy (thay RightRail + TradingPanel)
└───────────────────────────────┘
```

- **Thanh trên**: Avatar (menu tài khoản), Symbol, Timeframe, Indicators; còn lại (Alert, Replay, Undo/Redo, Layout,
  Settings, Theme, Screenshot, Fullscreen) gom vào menu `⋯`.
- **Tab bar đáy**: tab `Chart` là màn chính; `Watchlist`, `Alerts`, `Lịch kinh tế`, `Lệnh` mở toàn màn (sheet) và
  dùng lại nguyên các panel đang có (`WatchlistPanel`, `AlertsPanel`, `EconomicCalendarPanel`, nội dung `TradingPanel`).
  Bỏ cột `DrawingToolbar` và `RightRail` khỏi khung mobile.
- **Một chart**: layout nhiều ô → chỉ hiện ô active (đặt `maximized` lúc vào chế độ phone, trả về `null` khi rời),
  thêm nút chọn ô (1/2/3…) trên thanh trên. Các ô ẩn **unmount hoặc dừng vẽ** trên phone để đỡ CPU / pin.
- `h-screen` → `h-dvh`; thêm padding `env(safe-area-inset-*)` cho thanh trên và tab bar.

## 5. Chart bằng ngón tay

| Desktop | Phone |
|---|---|
| Hover hiện crosshair + giá trị legend | Nhấn giữ để bật crosshair, kéo để dò, chạm lần nữa để tắt (`trackingMode` của LWC) |
| Chuột phải → `ChartContextMenu` | Nút `⋯` trên chart; nhấn giữ lên drawing / đường lệnh thì mở menu của chính nó |
| Double-click reset scale | Double-tap trục giá / thời gian |
| Lăn chuột trên trục giá | Kéo dọc trên trục giá (đã có `onPriceDragDown`, cần thử với touch) |
| Nút hiện khi hover (maximize, nút pane, nút legend) | Luôn hiện khi `touch`, hoặc hiện sau khi chạm vào pane |
| Phím tắt | Đã có nút tương ứng; Delete drawing → nút thùng rác trên thanh style |

- Vùng bắt chạm (hit tolerance) của drawing, tay nắm anchor, đường SL/TP/lệnh chờ: tăng khi `touch` (mục tiêu ≥ 24px vùng
  bắt, tay nắm vẽ to hơn). Thử nghiệm trên LWC xem `lockChart()` có còn kịp chặn pan khi bắt đầu kéo bằng tay.
- Hiệu năng: điện thoại DPR 3 + Big Trades / Footprint / SVP nặng → đo FPS khi pan; nếu chậm thì giới hạn số bar vẽ
  hoặc giảm độ chi tiết trên phone (không đổi kết quả tính).

## 6. Giao dịch trên điện thoại (ưu tiên cao)

- `TradeWidget` (Sell/Buy) dính đáy chart, nút cao ≥ 44px.
- `OrderTicket` mở thành bottom sheet toàn chiều ngang; ô số dùng `inputMode="decimal"`, chữ ≥ 16px (iOS không tự zoom khi focus).
- Tab `Lệnh`: vị thế / lệnh chờ hiện dạng thẻ (symbol, chiều, lot, giá, P/L, nút Đóng) thay cho bảng 180px; giữ luồng
  xác nhận đóng lệnh đang có.
- Kéo SL/TP trên chart bằng tay: dùng `lineDrag` sẵn có + vùng bắt lớn hơn; có thêm cách sửa bằng số trong thẻ lệnh
  (kéo bằng ngón tay khó chính xác).
- **One-click trading**: đề xuất luôn hỏi xác nhận trên phone dù desktop bật one-click (dễ chạm nhầm) — chờ user chốt.

## 7. Dialog, menu, thanh vẽ

- Component chung `Sheet` (bottom sheet, kéo xuống để đóng, có nút Đóng). Trên phone:
  - Dialog lớn (`SettingsDialog`, `IndicatorSettingsDialog`, `DrawingSettings`, `VolumeSettingsDialog`, `AlertDialog`)
    → toàn màn, tab trái chuyển thành tab ngang cuộn được ở trên.
  - Menu thả xuống (`Toolbar` chart type, `TimeframeBar`, `LayoutMenu`, `LayoutBar`, `TimezoneMenu`, `ChartContextMenu`)
    → sheet danh sách.
  - `SymbolSearchDialog`, `IndicatorsDialog` → toàn màn, ô tìm kiếm tự focus.
- **Thanh vẽ**: nút nổi `✎` mở sheet lưới công cụ theo nhóm + mục Yêu thích (dữ liệu favorites đã đồng bộ theo tài khoản).
  Đặt điểm bằng chạm (chạm 1 = điểm 1, chạm 2 = điểm 2) như TV mobile. `StylePanel` nổi → thanh gọn ở đáy khi đang chọn drawing.
  Đợt đầu chỉ cần chắc chắn chạy: Horizontal line, Trend line, Rectangle, FRVP, Long/Short position; các công cụ khác
  để chạy “được thì dùng”, sửa dần.
- `InlineTextEditor`: thử với bàn phím ảo (bàn phím đẩy viewport, `dvh` thay đổi).

## 8. Tablet và màn ngang

- Tablet: giữ khung desktop; panel của `RightRail` mở **đè lên chart** (overlay) thay vì đẩy chart hẹp lại; toolbar
  gom bớt nút vào `⋯` khi thiếu chỗ.
- Phone xoay ngang: ẩn tab bar + thu thanh trên thành 1 nút nổi, chart toàn màn.

## 9. Quyết định (user chốt 2026-10-29: “theo khuyên của bạn hết”)

1. **Phạm vi trên phone**: xem chart + alert + đặt / đóng lệnh là chính; vẽ chỉ chắc chắn vài công cụ cơ bản (mục 7).
2. **One-click trading trên phone**: luôn hỏi xác nhận, dù desktop bật one-click.
3. **Layout nhiều chart**: phone chỉ hiện chart active + nút chuyển ô.
4. **Đường vào từ điện thoại**: *còn mở* (không có khuyến nghị để chọn). Cần hỏi lại trước M3 / khi test trên máy thật:
   API gọi `cùng-host:8000`, nếu tunnel chỉ mở cổng 3000 thì backend không tới được.
5. **PWA**: không có khuyến nghị → để M7 tuỳ chọn, làm sau cùng nếu user muốn.

## 10. Các phase

| Phase | Nội dung | Phụ thuộc |
|---|---|---|
| **M0** Nền ✅ | `useLayoutMode` + cờ `touch`, `viewport` export (đọc `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md` trước), `h-dvh`, safe-area, công thức test headless theo kích thước máy | — |
| **M1** Khung phone ✅ | Thanh trên gọn + menu `⋯`, tab bar đáy, panel thành sheet, 1 chart (`maximized`) + unmount ô ẩn | M0 |
| **M2** Chart cảm ứng | Crosshair nhấn giữ, menu `⋯` thay chuột phải, double-tap, nút luôn hiện khi touch, vùng bắt lớn, đo FPS | M1 |
| **M3** Giao dịch | TradeWidget đáy, OrderTicket sheet, thẻ vị thế, kéo SL/TP bằng tay, xác nhận trên phone | M1, M2 |
| **M4** Dialog & menu | Component `Sheet`, chuyển dialog lớn + menu thả xuống, input số | M1 |
| **M5** Vẽ | Sheet công cụ + favorites, đặt điểm bằng chạm, thanh style gọn, text editor với bàn phím ảo | M2, M4 |
| **M6** Tablet & ngang | Overlay rail, toolbar co giãn, màn ngang toàn chart | M1 |
| **M7** PWA *(tuỳ chọn)* | manifest, icon, `display: standalone` | M0 |

Thứ tự đề xuất: M0 → M1 → M2 → M3 (đến đây là dùng được để trade) → M4 → M5 → M6 → M7. Mỗi phase commit riêng.

### M0 đã làm (2026-10-29)

- `web/src/lib/layoutMode.ts`: `layoutModeFor(width)` + hook `useLayoutMode()` (chỉ báo khi qua mốc 768 / 1280, server
  = desktop) và `useTouch()` (`(pointer: coarse)`); test `layoutMode.test.ts`. Chưa component nào dùng — M1 dùng.
- `app/layout.tsx`: `export const viewport` với `viewportFit: "cover"` → meta `width=device-width, initial-scale=1, viewport-fit=cover`.
  Chưa đặt `interactiveWidget` (để M4/M5 quyết sau khi thử bàn phím ảo).
- `app/page.tsx`: `h-screen` → `h-dvh`, padding `env(safe-area-inset-*)` ở khung gốc.
- `globals.css`: `@media (pointer: coarse)` → `overscroll-behavior: none` cho html/body (chặn nảy / kéo-để-tải-lại khi kéo chart).
  Tap-highlight không cần: preflight Tailwind đã tắt.
- Đo headless: desktop 1440×900 khung gốc vẫn 1440×900, padding 0, overscroll `auto` (không đổi). Phone 390×844
  overscroll `none`; trang **vẫn tràn ngang** (scrollWidth 1184px) — đúng như dự kiến, M1 mới sửa bố cục.

### M1 đã làm (2026-10-29)

- `components/chart/MobileChrome.tsx`: `MobileTopBar` (Avatar, Symbol, khung `5m ⌄`, Indicators chỉ icon, nút chọn chart `1/2`
  khi layout nhiều chart, menu `⋯`: Layout + Save, loại chart, Create alert, Replay, Undo/Redo, Settings, Snapshot, Theme,
  Fullscreen nếu trình duyệt cho), `MobileTabBar` (Chart / Watchlist / Alerts / Calendar / Order khi đang soạn lệnh /
  Trading), `MobilePanel` (panel phủ lên chart, chart vẫn mount bên dưới). Chọn symbol ở Watchlist thì tự về Chart.
- `page.tsx`: phone dùng 3 phần trên thay `Toolbar` / `DrawingToolbar` / `RightRail` / `TradingPanel`; tablet / desktop không đổi.
- `ChartGrid`: **khác plan ban đầu** — không dùng `maximized` mà phone chỉ mount chart active (key giữ nguyên nên chart
  active không bị tạo lại khi đổi phone ↔ desktop); không đụng layout đã lưu.
- Tách phần dùng chung: `useSymbolsPolling`, `toggleFullscreen`, `SymbolSearch`, `CHART_TYPES` (Toolbar);
  `useTradePolling` (TradingPanel, tab bar gọi để thẻ lệnh / đường SL-TP trên chart vẫn có dữ liệu khi tab Trading đóng);
  `ticketBusy` (trading/ticket.ts, dùng chung với RightRail); rail store thêm panel `"trading"` (chỉ phone).
- `TradingPanel fill`: chiếm cả panel, tóm tắt account xuống dòng, chưa đăng nhập / chưa có account thì hiện lời nhắc.
- `TimeframeBar compact`, `IndicatorsDialog iconOnly` + dialog Indicators toàn màn trên phone (`max-md:`; nhóm thành hàng tab,
  bỏ cột AUTHOR, sao yêu thích luôn hiện khi `pointer-coarse`) — làm sớm phần này của M4 vì mở từ thanh trên.
- `FavoritesBar` ẩn trên phone (chưa có thanh vẽ, M5). Thanh dưới của Chart: dải 1D/5D/… cuộn ngang khi hẹp.
- Đo headless phone 390×844: không còn tràn ngang ở mọi tab / menu / popup Layout; layout 2 chart chỉ mount 1 chart, đổi
  `1/2` → `2/2` đúng; Replay + đặt lệnh BUY giả lập: bảng đặt lệnh toàn panel, tab Trading hiện vị thế. Desktop 1440×900:
  không có tab bar / menu ⋯, toolbar vẫn 38px, ảnh chụp như cũ.

**Ghi lại cho các phase sau** (thấy khi test M1):
- M2: chọn nến Replay bằng cảm ứng phải **chạm 2 lần** (lần 1 chỉ đặt vị trí hover, lần 2 mới chọn).
- M3: bảng Positions trên phone cuộn ngang, cột nút Close nằm ngoài màn → cần thẻ lệnh như plan.
- M4: dialog khác (Settings, Indicator settings, Drawing settings, Alert) chưa sửa.

## 11. Kiểm thử

- **Desktop không đổi**: chụp màn hình headless 1440×900 trước / sau mỗi phase, so khác biệt.
- **Công thức headless đã dùng ở M0**: `playwright-core` + `chrome-headless-shell` có sẵn trong cache Playwright, mở
  `http://127.0.0.1:3000` chế độ khách (chỉ đọc), 2 context: desktop `{1440×900}` và phone
  `{390×844, deviceScaleFactor 3, isMobile, hasTouch}`; đọc meta viewport, `innerWidth`, `scrollWidth`, kích thước khung
  `[data-theme]`, style tính được. Dev server Turbopack hay trả CSS chậm một lần sửa → kiểm CSS cuối bằng `next build` trên bản sao `web`.
- **Phone headless** (Playwright, theo công thức scratch backend trên **bản sao** data — không bao giờ đăng ký user test
  trên `backend/data`): iPhone 14 (390×844, DPR 3), Pixel 7 (412×915), cả dọc và ngang, `hasTouch: true`; thử kéo /
  pinch / nhấn giữ bằng `page.touchscreen` và sự kiện touch.
- **Unit (vitest)**: logic thuần — chọn chế độ theo kích thước, vùng bắt theo `touch`, vào / rời phone thì `maximized` đúng
  và không ghi vào layout đã lưu.
- **Máy thật**: user thử trên điện thoại qua đường vào thật (9.4); riêng iOS Safari cần thử bàn phím ảo, thanh địa chỉ,
  safe-area — headless không giả lập được hết.
- Không đặt lệnh thật khi test; luồng lệnh thử trên tài khoản demo như các review trước.

## 12. Ngoài phạm vi

- App native / React Native.
- Đổi giao diện desktop.
- Web push riêng (đã có Telegram + MT5 push cho alert).
