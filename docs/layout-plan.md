# Kế hoạch: layout nhiều chart như TradingView + lưu layout (theo tài khoản Wickloom)

Ngày viết: 2026-10-22 (sau commit 8635bdd). CHỈ LÀ PLAN, chưa code gì cho layout. **Cập nhật cùng ngày:** `auth-plan` U1–U3 đã code
(đăng nhập, `/me/watchlist|drawings`, và `/me/layouts[/{id}]` ở backend đã sẵn dùng; web có `useAuthStore.requireLogin(reason)`, `memoryFetch` cho khách,
`DrawingSync.flush()` trả Promise + `abandon()`), nên bước tiếp theo của layout là **Phase 0–2** (không còn phụ thuộc gì). Mục tiêu: chia màn hình thành 1–8 chart
(2×2, 1 lớn + 2 nhỏ…), kéo splitter, đồng bộ symbol/khung/crosshair giữa các chart, và **lưu / mở / đổi tên / copy / xoá
layout** như menu layout của TV. Layout **lưu theo tài khoản Wickloom** (đăng ký/đăng nhập riêng của app, chốt 2026-10-22,
xem `docs/auth-plan.md`), **không** theo account MT5 (account MT5 chỉ để trade). Chưa login thì bấm Save sẽ bắt đăng nhập.

## 0. Trạng thái (cập nhật 2026-10-22)

**Phase 1 (tách state theo pane) đã code, chưa commit**; vẫn 1 ô, hành vi không đổi (190 test web xanh; kiểm tay trên Chrome: migrate localStorage,
đổi khung/symbol từ toolbar và watchlist, thêm indicator, vẽ + Cmd+Z, Replay chọn nến → chạy → thoát, reload khôi phục). Phase 0 (chụp tham chiếu TV) và
Phase 2 (lưới) chưa làm. Cách làm khác chút so với §5.1 để giảm số chỗ phải sửa (~100 điểm gọi store trong ~15 file):

- `store/paneStores.ts`: 5 store vanilla cho MỘT chart — `chart` (symbol/tf/chartType/scaleMode), `indicators` (list + legend thu gọn), `volume`, `replay`,
  `draw` (drawings, selectedId, editing, settingsOpen, api). `createPane(id, init)`, `snapshotPane`, `applyPaneInit`. Không import facade nào (tránh vòng phụ thuộc).
- `store/layout.ts`: `useLayoutStore` {order, panes, activeId, setActive/add/remove}; `getPane/activePane/allPanes/isActivePane/flushAllDrawings`. Pane chính `p1`.
- `store/compose.ts`: `composeStore` tạo **facade** giữ nguyên tên cũ `useChartStore/useIndicatorStore/useVolumeStore/useReplayStore/useDrawingStore`:
  state = phần chung (theme, favTfs, symbols, yêu thích indicator, công cụ vẽ...) + phần của **pane đang active**; `setState` chia patch theo khoá; hook
  `useSyncExternalStore` có cache theo (global, pane). Nhờ vậy UI ngoài chart (toolbar, tìm symbol, watchlist, thanh vẽ, dialog) **không phải sửa** và tự nhắm vào
  pane active như TV. Cạm bẫy đã gặp: store không có phần chung phải dùng cùng một `{}` hằng, nếu không cache không trúng → vòng lặp vô hạn.
- `Chart({paneId})` và `DrawingManager({pane,...})` gắn thẳng vào store của pane mình (`usePaneState(pane.xxx)`, `pane.xxx.getState()`), không qua facade.
  `pointerdown` (capture) trên chart → `setActive(paneId)` trước khi DrawingManager xử lý. Listener `window` đã lọc theo pane active: phím tắt của DrawingManager
  (Esc/Delete/Ctrl+Z/Y), Alt+R, `tv-screenshot`, tiêu đề tab. Đăng xuất/đăng nhập dùng `flushAllDrawings()` (mọi pane).
- Lưu tạm: `store/paneStorage.ts` — key `wickloom-pane1` {chart, indicators, legendCollapsed, volume}, debounce 300ms + flush `pagehide`; lần đầu migrate từ
  `invest-chart-prefs` + `tv-indicators` + `tv-volume` (đọc TRƯỚC khi các store chung rehydrate vì chúng ghi đè key cũ chỉ còn phần chung). Phase 3 thay bằng layout lưu server.

**Phase 2 (lưới nhiều chart) đã code, chưa commit** (228 test web xanh; kiểm tay trên Chrome: chọn 2×2 và 6 ô, mỗi ô symbol riêng, vẽ ở ô A hiện ở mọi ô cùng
symbol, Cmd+Z/Shift+Cmd+Z gỡ/khôi phục ở mọi ô, Maximize/Restore, kéo splitter độc lập từng nhóm, về lại 1 ô; không lỗi console):

- `store/layoutTree.ts` (thuần logic): `Node = {pane} | {dir, sizes, children}`; 22 mẫu 1–8 ô (`TEMPLATES`, theo trí nhớ về TV — **chưa đối chiếu**); `paneRects`, `gutters`,
  `dragSizes` (mỗi ô ≥ min, tổng không đổi), `withSizes`, `splitAt`, `retarget` (đổi số ô: giữ pane theo thứ tự, thêm pane mới, bỏ các ô cuối; id không tái dùng).
- `useLayoutStore` thêm `tree/order/templateId/maximized`, `setTemplate` (pane mới nhân bản symbol/khung/loại nến của pane ACTIVE, không kèm indicator), `resizeAt`,
  `setMaximized`; `setActive` thoát Replay của chart vừa rời (§3.4 đề xuất 4).
- `ChartGrid`: mọi pane render PHẲNG (absolute theo tỉ lệ, key theo id) nên đổi mẫu/phóng to không tạo lại Chart; pane ẩn khi Maximize vẫn mount với kích thước đầy đủ.
  Splitter 6px kéo bằng pointer capture (ô ≥ 160px), bấm đúp = chia đều. Viền accent cho pane active khi > 1 ô; nút Maximize ở góc trên phải mỗi ô (hiện khi rê chuột).
- `LayoutMenu`: nút Layout trên toolbar → popup chọn mẫu, icon vẽ tự động từ cây.
- Hộp thoại chỉ một bản: `SettingsDialog`, `VolumeSettingsDialog`, `DrawingSettings` chuyển lên `page.tsx`; `FavoritesBar`, `StylePanel`, `InlineTextEditor` chỉ render ở pane active.
- `drawings/doc.ts` — `DrawingDoc` (§5.3): sở hữu drawings, kept, undo/redo và ĐÚNG MỘT `DrawingSync` cho mỗi (layout, symbol), đếm tham chiếu theo view; `DrawingManager`
  chỉ giữ accessor trỏ vào doc + implement `DocView` (`docChanged/docLoaded/docReset`). Đăng nhập/đăng xuất → mọi doc `reload()`. `closeAllDocs()` cho khi đổi cả layout.

**Phase 3 (lưu/mở layout theo tài khoản) đã code, chưa commit** (287 test web xanh; kiểm tay trên Chrome với backend scratch: khách dựng 2×2 + Save → đăng nhập → layout `default`
lưu đúng; reload khôi phục; **tắt backend rồi reload vẫn thấy bố cục** (cache) và tự phục hồi khi backend lên; Make a copy kèm hình vẽ; Open layout (tìm kiếm, CURRENT);
xoá layout đang mở → mở layout còn lại, không tạo lại bản vừa xoá; đăng xuất về 1 chart từ prefs khách; khách Save khi user đã có layout → layout mới "Chart <ngày giờ>",
`default` giữ nguyên, hình vẽ của khách đi vào layout mới, toast "Mở layout của tôi"). Mô hình:

- `store/layoutDoc.ts`: `LayoutDoc` v1 {version, name, templateId, tree, active, panes{chart, indicators, legendCollapsed, volume}, updatedAt}; `parseLayoutDoc` (version lạ → `version`,
  hỏng → `invalid`: không dùng và KHÔNG ghi đè), `docKey` (bỏ `updatedAt` và `active`), `summarizeDoc` ("XAUUSDm 15 · BTCUSDm 1h").
- `store/layoutSync.ts` `LayoutSync`: autosave một layout theo khuôn DrawingSync — debounce 1s, chỉ PUT khi `docKey` đổi, lỗi → `error` + thử lại 5s, **401 → `expired`, không retry mù**,
  `resume()` sau đăng nhập lại, `flushOnUnload` (keepalive), `abandon()` (layout vừa xoá), version lạ → `readonly`.
- `store/layoutSession.ts` `createLayoutSession(kv)` (singleton `appSession()` trong `store/appSession.ts`): điều phối theo auth. **Khách**: layout trong bộ nhớ, pane chính nhớ prefs ở
  `wickloom-pane1` (chỉ khi là khách). **User**: đọc `/me/layouts`, mở layout đã nhớ (hoặc mới nhất), tạo `default` từ màn hình hiện tại nếu chưa có gì (id bị chiếm bởi bản không đọc được → uuid, không ghi đè),
  autosave, cache `{id, doc}` ở `wickloom-layout-current:<user_id>`. **Mở nhanh**: lúc mở trang, nếu có `wickloom-auth-hint` (nay kèm `id`) và cache → áp layout cache ngay (chưa cần backend);
  khi server trả lời: cùng bản → không dựng lại chart, máy này đã sửa lúc offline → bản trên máy thắng và được lưu lên, server khác mà máy này không sửa → lấy server; phiên đã hết → về khách.
  Lỗi tải danh sách = `error` + thử lại, **không bao giờ PUT bản mặc định đè lên layout có sẵn**.
- Hook của auth (`authHooks`): `beforeLogin` (quyết định layout sẽ mở TRƯỚC khi hình khách chuyển lên, để `adoptGuestDrawings(f, layoutId)` đổi `__default` → `__<layoutId>`; Save-intent → layout mới
  nếu đã có layout, ngược lại `default`) và `beforeLogout` (lưu nốt layout trước khi xoá cookie; chưa lưu được thì huỷ đăng xuất). Hết phiên → `LayoutSync` `expired` → popup đăng nhập → `resume`.
- Layout store: thêm `layoutId`, `name`, `revision` (đổi layout → `ChartGrid` key `<revision>:<paneId>` dựng lại mọi Chart), `applyLayout`, `setIdentity`, `snapshotLayout()`.
  `DrawingManager` lấy `layoutId` hiện tại cho `DrawingDoc` → hình vẽ `/me/drawings/<symbol>__<layoutId>`; copy/xoá layout đi kèm hình vẽ (`__<id>`).
- UI: `LayoutBar` (tên + trạng thái `Saved/Saving…/Save/Phiên hết hạn/Read-only`, menu Save · Rename… · Make a copy… · Create new layout… · Open layout… · Delete layout…, Ctrl/⌘+S),
  `OpenLayoutDialog` (tìm kiếm, tóm tắt, thời gian sửa, CURRENT, xoá có xác nhận; không xoá layout cuối), `PromptDialog`. Mọi thao tác qua `requireLogin`.

**Phase 4 (Sync in layout) đã code, chưa commit** (313 test web xanh, `tsc` + `next build` sạch, lint giữ 12 lỗi cũ; kiểm tay trên Chrome với backend scratch, 2 chart: **Crosshair** (khác khung, kể cả sau khi cuộn khi đang hover — nhãn giờ khớp, legend chart nhận đổi theo), **Time** (cuộn chart này thì chart kia theo mép phải), **Interval** (bật → chart khác lấy khung của chart active; đổi khung ở toolbar → cả hai đổi), **Date range** (hai chart cùng khoảng sau khi cuộn). **Symbol chỉ có unit test**: DB scratch chỉ có 1 symbol nên không đổi được qua UI. Chưa kiểm tay: lưu công tắc vào layout server (có unit test `parse/docKey/applyLayout`), Maximize, 3+ chart):

- `LayoutDoc.sync: {symbol, interval, crosshair, time, dateRange}` (boolean, thêm vào doc v1 mà không đổi `LAYOUT_VERSION`; doc cũ không có / hỏng → tắt hết, `parseSync`); `useLayoutStore.sync` + `setSync(patch)`; lưu cùng layout (nằm trong `docKey` nên đổi công tắc = autosave). Khách không lưu (như lưới).
- `store/paneSync.ts`: **Symbol/Interval** — `startPaneSync()` (gọi ở `ChartGrid`) nghe store `chart` của từng pane, đổi ở pane nào thì ghi vào các pane khác CHỈ khi đang khác giá trị (không vòng lặp); vừa bật công tắc thì các pane khác lấy ngay symbol/khung của pane ACTIVE (không áp khi mở layout khác: `revision` đổi).
  **Crosshair / Time / Date range** — mỗi `Chart` đăng ký một `PaneView` {getRange, setRange, setCrosshair, hovered}; thời gian (giây) là đơn vị chung giữa các khung (`timeAt`/`indexAt`: chỉ số logic ↔ thời gian, nội suy qua lỗ cuối tuần, ngoại suy theo độ dài 1 nến ngoài hai đầu).
  *Time* = dời mép phải của các chart khác về cùng thời gian, giữ số nến đang hiện (kéo/cuộn có tác dụng, zoom thì không — mép phải đứng yên); *Date range* = đặt cả hai mép (zoom cũng lan). Định nghĩa Time vs Date range là **đoán** (chưa đối chiếu TV, Phase 0).
- Chống vòng lặp: `applying` (sự kiện lồng nhau) + `echo` (góc nhìn do đồng bộ vừa đặt cho một chart thì sự kiện dội lại bị bỏ qua) + chỉ đặt khi khác > 1e-4 nến. Chart không có dữ liệu trong khoảng đó thì để trống: `isSyncedRange` cho handler "cuộn tới đầu dữ liệu" của Chart bỏ qua nên **không kích backfill hàng loạt**.
- Crosshair: chỉ pane có chuột (`hoverRef`) là nguồn và không nhận; `setCrosshairPosition` của LWC không bắn lại sự kiện (đã đọc mã nguồn) nên không vòng lặp. Chart nhận ẩn đường ngang (không có giá), cập nhật legend theo nến đó, **vẽ lại sau mỗi lần dời góc nhìn** (LWC giữ crosshair giả theo pixel) và **không vẽ khi nến nằm ngoài vùng đang hiện** (LWC kẹp vào mép với nhãn giờ sai). Khác khung: lấy nến chứa thời gian đó (`barIndexAt`).
- UI: khối "Sync in layout" (5 checkbox, mờ khi chỉ 1 chart) trong popup `LayoutMenu`. Mặc định tắt hết (TV có thể bật sẵn một vài mục — chưa đối chiếu).

**Chưa có / giới hạn đã biết:** layout không đọc được chỉ hiện trong danh sách, chưa mở/sửa được; hai tab cùng mở: last-write-wins; Chart không tự nạp lại dữ liệu
giá nếu backend tắt lúc mở trang (có sẵn từ trước: `load()` không retry lỗi mạng); Ctrl+S chưa thử trên trình duyệt thật (chỉ code review: `preventDefault` + `save()`);
vị trí nút Maximize và danh sách mẫu vẫn là đoán theo TV (Phase 0).

## 1. Hiện trạng (đọc từ code)

- Chỉ có **1 chart**: `app/page.tsx` → `<Chart/>` (`components/chart/Chart.tsx`, 1505 dòng).
- State của chart nằm trong **store toàn cục (singleton)**, không có khái niệm "chart số mấy":
  - `useChartStore`: `symbol`, `tf`, `chartType`, `scaleMode` (của chart) + `theme`, `favTfs`, `symbols` (dùng chung).
  - `useIndicatorStore.list` (indicator của chart), `useVolumeStore.s`, `useReplayStore` (selecting/active/playing…).
  - `useDrawingStore`: vừa là trạng thái **công cụ** (tool, cursor, magnet, stay, favorites, toolDefaults…) vừa là
    trạng thái **của 1 chart** (`drawings`, `selectedId`, `editing`, `api` = DrawingManager).
  - `useSettingsStore` (dialog Settings: màu nến, grid, scale…) — áp cho cả app.
- Mức dính: `Chart.tsx` ~54 dòng và `drawings/manager.ts` ~38 dòng gọi `getState()/setState()` các store này;
  thêm ~12 component (Toolbar, TimeframeBar, ReplayBar, SymbolSearchDialog, WatchlistPanel, IndicatorsDialog,
  DrawingToolbar, StylePanel, DrawingSettings, InlineTextEditor, VolumeLegend…) đọc/ghi symbol/tf/`api`.
- Listener cấp `window` (chỉ an toàn khi có 1 chart): `keydown` ×2 + `tv-screenshot` trong `Chart.tsx`
  (dòng ~807/892/902); `DrawingManager` gắn `pointerup`, `pointercancel`, `keydown` lên `window` (Ctrl+Z, Delete…);
  `document.title` do `Chart.tsx` đặt. `createChart({autoSize:true})` nên tự co giãn theo khung chứa — thuận lợi cho splitter.
- Lưu trữ hiện tại:
  - localStorage: `invest-chart-prefs` (symbol, tf, favTfs, chartType, scaleMode, theme), `tv-indicators`, `tv-volume`,
    `tv-chart-settings`, `tv-drawing-prefs`.
  - Backend: drawings tại `/drawings/<symbol>__default` (scope = symbol) qua `DrawingSync` (chỉ ghi sau khi đã đọc xong,
    có `version`, readonly nếu version lạ, retry). Hậu tố `__default` chính là chỗ chừa sẵn cho **id layout**.
  - Backend đã có bảng `layouts` (`store.py` `TABLES`, CRUD generic `GET/PUT/DELETE /layouts[/{id}]`, cột `scope`)
    nhưng **chưa ai dùng**. Khoá chính chỉ là `id` → id layout phải **duy nhất toàn cục** (không chỉ trong phạm vi một user) — xem §9.
- Realtime: mỗi `Chart` tự mở 1 WebSocket và `subscribe {symbol, tf}`. Backend `hub.clients[ws]` là tập cặp theo từng WS,
  và `_push_subscribe()` tính lại symbol cần stream → nhiều WS đồng thời ổn, đóng WS thì EA thôi stream symbol đó.
- Toolbar: nút `LayoutI` đang `disabled` và khối "Default / Save / chevron" chỉ là placeholder.

## 2. TV làm gì (đích parity) — **viết từ trí nhớ, chưa đối chiếu, xem Phase 0**

- Nút layout (góc phải toolbar) → popup lưới các mẫu: 1 chart; 2 (2 cột, 2 hàng); 3 (3 cột, 3 hàng, 1 trái + 2 phải,
  2 trái + 1 phải, 1 trên + 2 dưới, 2 trên + 1 dưới); 4 (2×2, 4 cột, 4 hàng, 1 + 3…); 5, 6, 8… (10/12/14/16 tuỳ gói).
- Kéo splitter giữa các chart để đổi kích thước; mỗi chart có trục giá + trục thời gian riêng.
- Có **1 chart đang active** (viền accent khi layout > 1 chart). Toolbar trên (symbol, khung, loại nến, indicator,
  replay…) và thanh vẽ bên trái luôn tác động lên chart active. Click vào chart nào thì chart đó active.
- Chart mới thêm khi tăng số ô lấy symbol/khung của chart đầu; giảm số ô thì bỏ các ô cuối.
- "Sync in layout": Symbol, Interval, Crosshair, Time, Date range (+ có thể Drawings). Bật thì đổi ở 1 chart,
  các chart còn lại đổi theo.
- Nút **Maximize chart** trong 1 ô (tạm phóng to 1 chart, bấm lại để về lưới).
- Layout lưu: tên layout cạnh icon, dòng nhỏ "Save"/trạng thái lưu; menu chevron: Save, Rename…, Make a copy…,
  Create new layout…, Open layout… (dialog danh sách có tìm kiếm, xoá, thời gian sửa), Ctrl+S.
- Drawing gắn với **layout + symbol** (copy layout = copy cả drawings).

## 3. Quyết định

**Đã chốt (2026-10-22)**
- Layout **lưu theo tài khoản Wickloom** (user đăng nhập vào app; `scope` của hàng trong bảng `layouts` = `user_id`, truy cập qua
  `/me/layouts`). Account MT5 **không** sở hữu layout: đổi account MT5 (dropdown avatar) không đổi layout. Hệ quả: drawings đi
  theo layout nên cũng thuộc user (mục 4.3). *(Trước đó cùng ngày từng chốt "theo account MT5"; đổi sang user Wickloom vì account MT5
  chỉ để trade — thay thế quyết định cũ.)*
- **Chưa login thì không lưu được**: Save / Ctrl+S / Rename / Make a copy / Create new / Open layout đều gọi `requireLogin`
  (popup đăng nhập/đăng ký). Khách vẫn dùng chart bình thường, chỉ không có gì được ghi lên server. Chi tiết: `docs/auth-plan.md` §6.5.

**Đề xuất — cần bạn xác nhận**
1. **Autosave** (debounce ~1s vào layout đang mở, như drawings hiện giờ) và chữ "Save" trên toolbar chuyển thành trạng
   thái `Saved / Saving… / Save (lỗi, bấm để thử lại)`. Ctrl+S vẫn là "lưu ngay". Ngược lại là lưu tay: có chấm "chưa lưu",
   hỏi khi chuyển layout. Khuyến nghị autosave vì trùng cách drawings đang chạy và không bao giờ mất bố cục khi reload.
2. **Drawings thuộc layout** (key `<symbol>__<layoutId>`, đúng TV): layout "scalp" và "swing" có drawings khác nhau.
   Layout đầu tiên mang id `default` → URL cũ `…__default` giữ nguyên, **không cần migrate drawings**. Các layout sau dùng uuid.
   Phương án còn lại (drawings chung theo symbol cho mọi layout) đơn giản hơn nhưng không giống TV.
3. **Chart Settings (màu, grid, scale…) và theme vẫn là toàn cục** ở đợt này; chưa đưa vào layout. Có thể làm sau (Phase 5).
4. **Replay đợt đầu chỉ chạy trên chart active, không đồng bộ sang ô khác**; đổi layout / đổi chart active khi đang
   Replay thì thoát Replay chart đó. Replay đồng bộ nhiều chart là việc khác, để sau.
5. **Tối đa 8 ô** lúc đầu (mẫu 1–8). 10/12/16 chỉ thêm template, không đổi kiến trúc.

## 4. Dữ liệu

### 4.1 Layout document (bảng `layouts`, `id` = uuid hoặc `default`, `scope` = user_id; server lưu `id` dạng `<user_id>:<id>`)

```
{
  version: 1,
  name: "Default",
  tree: Node,                     // cây chia ô, xem 5.2
  active: "p1",                   // chart đang active
  sync: { symbol, interval, crosshair, time, dateRange }   // boolean
  panes: {
    p1: { symbol, tf, chartType, scaleMode,
          indicators: IndicatorInstance[],   // list hiện ở useIndicatorStore
          volume: VolumeSettings }           // hiện ở useVolumeStore
  },
  updatedAt: number
}
```
- Không lưu: bars, drawings (nằm riêng), visible range (v1 luôn về `defaultRange`; có thể thêm sau), tool/cursor,
  Replay, `theme`, `favTfs`, `ChartSettings` (toàn cục).
- `version` + chặn ghi khi `version` lạ hoặc dữ liệu hỏng (readonly) — đúng bài học `DrawingSync`.
- "Layout đang mở" nhớ **theo user**: `localStorage["wickloom-layout-current:<user_id>"]`; kèm bản cache doc cuối để
  mở nhanh / khi backend chưa lên. Khách không có khoá này (dùng prefs như hiện nay).

### 4.2 Scope theo user Wickloom (không theo account MT5)
- Chưa có layout nào trong DB (plan này chưa code) và auth làm **trước** Phase 3 (`auth-plan` U1–U3) → layout sinh ra đã gắn user,
  **không** cần scope `"default"` và không cần bước "nhận layout cũ". Dữ liệu cũ duy nhất là drawings `*__default` +
  watchlist, đã được chuyển cho tài khoản đầu tiên (`auth-plan` §5.5).
- User mới chưa có layout → tạo "Default" 1 chart (symbol đầu tiên / `XAUUSD*`).
- **Khách → đăng nhập qua nút Save**: nếu user chưa có layout thì lưu chart hiện tại thành `default`; nếu đã có thì lưu thành layout
  **mới** "Chart <ngày giờ>" (không ghi đè) + toast "Mở layout của tôi". Đăng nhập từ chỗ khác (avatar/watchlist) thì mở layout gần nhất.
- **Đổi user** (Sign out / Sign in): flush layout đang mở → đóng → mở layout cuối của user mới (hoặc Default); sign out về khách =
  layout 1 ô dựng từ prefs localStorage.
- **Đổi account MT5** (dropdown avatar): **không** đổi layout/watchlist/drawings. Chỉ đổi nguồn giá/symbols; pane có symbol không
  tồn tại trên account MT5 mới thì Chart hiện sẵn dòng "không có trên account MT5 hiện tại" (không tự đổi symbol đã lưu).
- Xoá/copy layout chỉ trong phạm vi user đó (server kiểm `scope`, user khác nhận 404).

### 4.3 Drawings theo layout
- Key: `/me/drawings/<symbol>__<layoutId>` (đổi hàm `url` ở `manager.ts:73` thành nhận `layoutId`; `auth-plan` U3 đã đổi
  prefix sang `/me/drawings`). Khách: `DrawingSync` dùng `memoryFetch` (không gọi server).
- **Make a copy**: liệt kê `GET /me/drawings` rồi lọc id kết thúc `__<idCũ>` → PUT sang `__<idMới>`.
  **Xoá layout**: xoá luôn các drawings có hậu tố đó (có xác nhận).
- Migration: **không có** (layout `default` giữ `__default`).

### 4.4 Migration state cũ → pane đầu tiên
Lần đầu chạy bản mới (chưa có layout nào): tạo layout `default` 1 pane từ `invest-chart-prefs` (symbol/tf/chartType/
scaleMode), `tv-indicators.list`, `tv-volume.s`. Các key cũ vẫn giữ nguyên (chỉ không còn ghi các field của chart) để
quay lại bản trước được. `favTfs`, `theme`, `symbols` ở lại `useChartStore`.

## 5. Kiến trúc

### 5.1 Tách state theo pane — phần khó nhất, làm trước
Không làm được bằng cách "thêm layout lên trên" vì mọi thứ của chart đang là singleton.
- **Pane store**: `createPaneStore()` (zustand vanilla) mỗi chart 1 cái, giữ: `symbol, tf, chartType, scaleMode`,
  `indicators`, `volume`, `replay`, và phần trạng thái drawings của chart (`drawings, selectedId, editing, api`).
  Cấp cho cây React qua `PaneProvider`; hook `usePane(selector)` và `usePaneApi()` (lấy `getState/setState`).
- **Giữ toàn cục**: `useChartStore` còn `theme, favTfs, symbols`; `useDrawingStore` còn trạng thái công cụ
  (`tool, cursor, magnet, magnetMode, stay, lockAll, hideAll, favorites, toolDefaults, lastTool`); `useSettingsStore`.
- **Chart có `paneId`**: `Chart({paneId})` đổi các chỗ đọc symbol/tf/chartType/… sang pane store; `DrawingManager`
  nhận `pane` trong `Opts` và đổi các `useDrawingStore.setState({drawings|selectedId|editing|api})` (~25 chỗ) sang
  `pane.setState`; tool/cursor/magnet vẫn lấy từ `useDrawingStore` như cũ.
- **Active pane**: layout store giữ `activeId`. Mọi nơi đang dùng `useChartStore.symbol/tf` ở ngoài Chart
  (Toolbar, TimeframeBar, SymbolSearchDialog, WatchlistPanel, IndicatorsDialog, ReplayBar, DrawingToolbar Undo/Redo,
  StylePanel, DrawingSettings…) đổi sang `useActivePane()`. `pointerdown` (capture) trên 1 ô → đặt active **trước** khi
  DrawingManager xử lý, để tool đang chọn vẽ đúng ô vừa bấm.
- **Listener `window`** phải lọc theo pane active: `keydown` (Ctrl+Z, Delete, Esc…), `tv-screenshot` (chụp chart active),
  `document.title` (theo chart active). Cần rà từng listener — đây là nguồn bug "bấm Delete xoá ở 2 chart".
- **WebSocket**: giữ **1 WS / pane** như hiện tại (ít rủi ro nhất; backend đã chịu được). Gộp thành 1 WS có đếm tham chiếu
  chỉ làm nếu thấy nặng, vì bài học: 2 pane cùng `(symbol, tf)` mà unsubscribe sai sẽ ngắt cả hai.
- Hoàn thành bước này **khi vẫn chỉ có 1 pane** và hành vi không đổi (Phase 1) → mới thêm lưới.

### 5.2 Cây chia ô + splitter
- `Node = { pane: id } | { dir: "row"|"col", sizes: number[] (tỉ lệ, tổng 1), children: Node[] }`.
  Cây (không phải CSS grid cố định) để mỗi nhóm kéo độc lập: "1 trái + 2 phải" = `row[pane, col[pane, pane]]`
  — kéo ngang ở giữa không dính chuyện chia dọc bên phải.
- Template = hàm sinh cây từ số ô; icon trong popup **vẽ tự động từ cây** (không cần vẽ tay từng icon).
- Render bằng flex + gutter 4–6px kéo được, ô tối thiểu ~160px; `sizes` đổi → lưu layout (debounce).
- Tăng số ô: giữ pane cũ theo thứ tự, ô mới nhân bản `symbol/tf/chartType` của pane active (không kèm indicator);
  giảm: bỏ các ô cuối (hỏi nếu ô bị bỏ có indicator?). Đổi mẫu cùng số ô: giữ nguyên pane, chỉ đổi cây.
- Maximize: `maximized: paneId|null` (trạng thái UI, không lưu); ô còn lại vẫn mount (giữ WS/state) nhưng ẩn.

### 5.3 Drawings dùng chung giữa các ô cùng symbol
Hai ô cùng symbol → hai `DrawingManager` cùng sửa 1 danh sách, mỗi cái có `DrawingSync` riêng → **ghi đè nhau, mất hình**.
Cách xử lý: `DrawingDoc` theo khoá `(layoutId, symbol)` có đếm tham chiếu, sở hữu `drawings[]`, `undoStack/redoStack`
(chỉ là mảng chuỗi snapshot, di chuyển dễ) và **một** `DrawingSync`; mỗi `DrawingManager` đăng ký vào doc, sửa xong gọi
doc để báo các manager còn lại vẽ lại (bỏ chọn nếu hình bị xoá). Undo/redo là của doc (như TV: undo theo layout).
Giữ nguyên `sync.test.ts`; thêm test cho doc.

### 5.4 Đồng bộ giữa các chart (Phase 4)
- **Symbol / Interval**: action `setSymbol(paneId, s)` / `setTf` trong layout store; nếu cờ sync bật thì áp cho mọi pane.
- **Crosshair**: `subscribeCrosshairMove` của pane A → `setCrosshairPosition(…)` ở pane khác (quy về thời gian nến gần nhất
  của pane đó; khác khung thì snap), `clearCrosshairPosition()` khi rời chart.
- **Time / Date range**: `subscribeVisibleTimeRangeChange` → `setVisibleRange` ở pane khác, có cờ chống vòng lặp.
  Chi tiết "Time" khác "Date range" ra sao phải đối chiếu TV ở Phase 0.
- Chart không có dữ liệu trong khoảng đó thì để yên (không kích backfill hàng loạt).

### 5.5 Lưu / mở layout
- `store/layout.ts` (zustand): `id, name, tree, sync, activeId, panes: Record<id, PaneStoreApi>, maximized, saveState`,
  cộng `list` (tóm tắt layout của user) cho dialog Open.
- `snapshot()` dựng doc từ các pane store; `open(doc)` huỷ pane cũ (unmount Chart → `DrawingManager.destroy` flush
  drawings) rồi tạo pane store mới. Subscribe mọi pane store + layout store → so JSON với bản đã lưu → dirty → autosave.
- `LayoutSync` theo khuôn `DrawingSync`: không PUT trước khi đã đọc xong, không PUT khi nội dung không đổi, `version`
  lạ → readonly, lỗi → retry, flush khi đóng tab (`fetch keepalive`). Tách phần chung ra một lớp dùng chung chỉ khi
  `sync.test.ts` vẫn xanh; nếu không thì copy khuôn và viết test tương tự. Thêm: **chỉ chạy khi `auth.status === "user"`**;
  PUT trả **401** → trạng thái "Phiên hết hạn", mở popup đăng nhập, giữ layout trong bộ nhớ và flush sau khi đăng nhập lại
  (không retry mù, không đè).
- Khởi động: rehydrate prefs → `GET /auth/me` → (nếu là user) đọc layout hiện tại (timeout ngắn) → rơi về cache localStorage →
  rơi về layout 1 pane dựng từ prefs cũ. Khách: bỏ qua bước đọc layout. **Không bao giờ PUT bản mặc định đè lên layout đã có khi load lỗi.**
- Menu chevron: Save (Ctrl+S), Rename…, Make a copy…, Create new layout…, Open layout…, Delete — **mọi mục đều qua `requireLogin`**.
  Dialog Open: tìm kiếm, tên, tóm tắt (vd "XAUUSDm 5 · BTCUSDm 1h"), thời gian sửa, nút xoá có xác nhận; không xoá layout cuối cùng của user.

## 6. UI

- Nút `LayoutI` → popup "Select layout" (lưới mẫu theo số ô, mẫu đang dùng được tô) + khối "Sync in layout" (5 công tắc).
- Khối tên layout bên cạnh: tên (bấm để đổi tên) + dòng trạng thái `Saved / Saving… / Save`; chevron mở menu.
  **Khách**: dòng trạng thái luôn là `Save` (màu accent); bấm Save / tên / chevron → popup đăng nhập với banner "Đăng nhập để lưu layout".
  Phiên hết hạn: `Phiên hết hạn` (bấm để đăng nhập lại).
- Pane active có viền accent khi layout > 1 ô; nút Maximize hiện khi rê chuột vào ô; legend/trục giá giữ nguyên từng ô.
- Đối chiếu pixel/màu viền/vị trí với TV ở Phase 0 (cách đo: `docs`/memory `tv-reference-capture`, `chart-ui-parity-round2`).

## 7. Backend

Không cần bảng mới, nhưng **không dùng CRUD generic `/layouts`** nữa (không có xác thực, khoá chính `id` toàn cục):
- Dùng `GET/PUT/DELETE /me/layouts[/{id}]` của `auth-plan` §5.3 (chủ sở hữu lấy từ session; lưu `id=<user_id>:<id>`, `scope=user_id`).
  CRUD generic của `layouts` bị đóng ở `auth-plan` U4.
- Thêm test trong `backend/tests`: PUT/GET/list/DELETE `/me/layouts`; user B không đọc/ghi/xoá được layout của A (404); khách 401;
  id chứa ký tự lạ (dùng uuid nên không cần).
- Tuỳ chọn: endpoint copy/xoá layout kèm drawings phía server để tránh N request từ web. Chưa cần ở đợt đầu.

## 8. Các phase

| Phase | Việc | Xong khi |
|---|---|---|
| 0 | Chụp tham chiếu TV: popup layout (danh sách mẫu, nhãn sync), menu Save/Rename/Copy/Open, dialog Open, viền active, Maximize, hành vi Time vs Date range. Ghi `docs/tv-layout-reference.md` | Có tài liệu số đo + nhãn thật, các mục "chưa đối chiếu" ở §2 được xác nhận hoặc sửa |
| 1 ✅ | Tách state theo pane (§5.1), vẫn 1 ô + migration state cũ (§4.4) | Hành vi y hệt trước: vẽ/undo/indicator/volume/replay/đổi symbol-khung chạy như cũ; `tsc`, lint, vitest xanh |
| 2 ✅ | Cây chia ô + template + popup chọn + splitter + active pane + Maximize + `DrawingDoc` dùng chung (§5.2–5.3) | 2×2 mỗi ô symbol/khung riêng; vẽ ở ô A hiện ở ô B cùng symbol, undo chung, không mất hình; phím tắt/chụp ảnh chỉ tác động ô active |
| 3 ✅ | Lưu/mở layout: `store/layout.ts`, `LayoutSync`, menu + dialog Open, autosave, Ctrl+S, khôi phục khi mở app, drawings theo layout (§4.3, §5.5), scope = user qua `/me/layouts`, chặn khách bằng `requireLogin` (= `auth-plan` U4). **Cần `auth-plan` U1–U3 xong trước** | Reload giữ nguyên bố cục + indicator; copy/xoá layout kèm drawings; tắt backend rồi reload không mất layout; khách bấm Save → popup → lưu đúng tài khoản; user B không thấy layout của A |
| 4 ✅ | Sync in layout: symbol, interval, crosshair, time, date range (§5.4) | Mỗi công tắc chạy đúng và lưu theo layout; không vòng lặp, không kích backfill hàng loạt |
| 5 | Tuỳ chọn: Settings theo layout, Replay đa ô, kéo symbol từ watchlist vào ô, mẫu 10/12/16, visible range trong layout | Theo nhu cầu |
| ~~A~~ | ~~Nối account MT5~~ — **bỏ**: layout theo user Wickloom, không còn phụ thuộc multi-account | — |

Phase 1–2 là phần nguy hiểm nhất (đụng `Chart.tsx` + `manager.ts`); nên commit nhỏ, mỗi commit giữ app chạy được.
Phase 3 phụ thuộc **`auth-plan` U1–U3** (không phụ thuộc multi-account MT5). Thứ tự gợi ý: auth U1–U3 → layout 0–2 → (layout 3 + auth U4).

## 9. Rủi ro / câu hỏi mở

- Refactor `Chart.tsx` (1505 dòng, nhiều ref/effect gắn vào store) dễ vỡ chi tiết nhỏ (legend, replay, backfill khi scroll,
  countdown label). Cần checklist kiểm tay mỗi commit, đặc biệt: đổi symbol/khung, replay, vẽ/undo, volume settings, đổi theme.
- Drawings trùng symbol giữa các ô (mục 5.3) — nếu bỏ sót sẽ mất dữ liệu người dùng.
- Mất layout do ghi đè: autosave chỉ bật sau khi đã đọc được bản trên server; lỗi load → trạng thái `error`, retry, không ghi.
- Hai tab trình duyệt cùng mở: last-write-wins (backend PUT là upsert). Chấp nhận ở đợt này; nếu cần thì thêm `updatedAt` kiểm tra.
- Hiệu năng 8 ô × (WS + indicator + tick realtime): theo dõi CPU (từng có sự cố 94% CPU do tick history, xem `tvbridge-socket-gotchas`).
- `layouts.id` là khoá chính toàn cục ở DB — route `/me/layouts` tự thêm tiền tố `<user_id>:`, nên client vẫn dùng uuid (hoặc `default`)
  mà hai user không đè nhau.
- Chi tiết TV chưa kiểm chứng: danh sách mẫu chính xác, "Time" vs "Date range", có "Drawings" trong Sync không, autosave hay lưu tay,
  vị trí nút Maximize. TV lại có thể bị chặn CDN bởi DNS (xem `tv-reference-capture`) → có thể phải nhờ bạn xử lý DNS.
- Câu hỏi cho bạn: (1) autosave hay lưu tay? (2) drawings theo layout (khuyến nghị) hay chung theo symbol? (3) 8 ô tối đa đủ chưa?
  (4) Replay đợt đầu chỉ ô active — ổn không? Câu hỏi về đăng nhập (email/mật khẩu, khách mất hình khi reload…): `auth-plan` §9.

## 10. Kiểm thử

- vitest (thuần logic, theo khuôn `sync.test.ts`): tạo cây từ template, resize `sizes` (tổng 1, tối thiểu), tăng/giảm số ô,
  `snapshot()`↔`open()` round-trip, migration state cũ → layout, `LayoutSync` (không PUT trước khi load, không PUT khi không
  đổi, version lạ → readonly, retry), `DrawingDoc` (2 manager cùng doc, undo chung, 1 PUT).
- backend pytest: CRUD `/me/layouts`, cô lập giữa 2 user, khách 401.
- Kiểm tay trên trình duyệt: checklist theo Phase 1–4 (nhất là phím tắt chỉ tác động ô active, reload khôi phục đúng,
  tắt backend → reload vẫn mở được từ cache).
