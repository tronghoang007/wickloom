# TradingView: layout nhiều chart + menu layout — số đo thật (Phase 0 của `layout-plan.md`)

Chụp 2026-10-22 từ tab TradingView của người dùng (layout `BTISRWLF` "Unicorn", gói Free, viewport 1440×749, theme tối), chỉ **đọc** (mở popup/menu/dialog rồi đóng), không đổi gì trong tài khoản.
Cách đo: DOM của popup (`aria-label` của nút mẫu, `getComputedStyle`), rasterize path SVG của icon để lấy ô, zoom ảnh. Xem `memory/tv-reference-capture`.

**Không đo được trên tài khoản này:** gói **Basic chỉ cho 1 chart mỗi tab** — chọn mẫu ≥ 2 ô chỉ mở hộp thoại nâng cấp "Several charts per tab" ("Your plan has 1 chart per tab limit... up to 16 linked charts"; gói gợi ý Essential = 2 chart). Nên viền chart active, vị trí nút Maximize, splitter và hành vi sync thật **không chụp được**; phần đó lấy từ tài liệu công khai (§6) hoặc cần ảnh chụp từ tài khoản trả phí. Layout Unicorn **không bị đổi** (đã thử và kiểm lại: vẫn 1 chart, chỉ Crosshair bật).

## 1. Nút Layout trên toolbar trên

- Khối ở giữa-phải toolbar: icon ô vuông (`~24px`, x≈916) **tách riêng** khỏi khối tên layout: emoji + tên ("Unicorn") + chevron `⌄` (x≈1031). Không có chữ "Save"/trạng thái dưới tên khi Autosave bật.
- Bấm icon ô vuông → popup chọn mẫu (§2). Bấm tên/chevron → menu layout (§3).

## 2. Popup chọn mẫu ("layout selector")

- Không có tiêu đề "Select layout"; bắt đầu thẳng từ hàng "1". Container `position: fixed`, x=898 (mép trái), y=2, **w=428**, cao tới sát đáy viewport (747, tự cuộn nếu thấp hơn); nền `#1f1f1f`, bo **6px**, bóng `0 2px 4px rgba(0,0,0,.4)`; đệm trên 13px, trái ~30px.
- Mỗi hàng = số ô (chữ xám ở cột trái) + các nút mẫu; ngăn cách giữa các hàng bằng đường 1px. **Bước hàng 41px.** Nút mẫu **29×27px**, icon SVG **21×19**; mẫu đang dùng: nền `#f2f2f2`, bo 4px, icon đen. Mẫu không chọn: icon viền xám, hover sáng lên. Icon là **khung bo góc + đường chia** (không tô đặc từng ô như app đang làm).
- Danh sách thật: **55 mẫu**, số ô 1·2·3·4·5·6·7·8·9·10·12·14·16 (id nội bộ = `aria-label` của nút):

| Số ô | Mẫu (id TV → cấu trúc) |
|---|---|
| 1 | `s` |
| 2 | `2h` 2 cột · `2v` 2 hàng |
| 3 (6) | `3h` 3 cột · `3v` 3 hàng · `3s` 1 trái + 2 xếp dọc phải · `3r` 2 xếp dọc trái + 1 phải · `2-1` 2 trên + 1 dưới · `1-2` 1 trên + 2 dưới |
| 4 (10) | `4` lưới 2×2 · `4v` 4 hàng · `4h` 4 cột · `4s` 1 trái + 3 xếp dọc phải · `4s-l` 3 xếp dọc trái + 1 phải · `1-3` 1 trên + 3 cột dưới · `3-1` 3 cột trên + 1 dưới · `2-2-l` 2 cột + 1 cột chia đôi (phải) · `2-2-r` 1 cột chia đôi (trái) + 2 cột · `2-2` 2 cột trên + 2 hàng dưới |
| 5 (10) | `1-4` 1 trên + 4 cột dưới · `5h` 5 cột · `5v` 5 hàng · `5s` 1 trái + 4 dọc phải · `5s-l` 4 dọc trái + 1 phải · `2-3` 2 trên + 3 dưới · `3-2` 3 trên + 2 dưới · `4-1` 4 trên + 1 dưới · `2-3-l` 2 cột + 1 cột chia 3 (phải) · `2-3-r` 1 cột chia 3 (trái) + 2 cột |
| 6 (6) | `6` 3 cột × 2 hàng · `6h` 6 cột · `6v` 6 hàng · `6c` 2 cột × 3 hàng · `2-4` 2 trên + 4 dưới · `4-2` 4 trên + 2 dưới |
| 7 (3) | `4-3` 4 trên + 3 dưới · `7h` 7 cột · `7s` 1 trái + 6 dọc phải |
| 8 (4) | `8` 4 cột × 2 hàng · `8c` 2 cột × 4 hàng · `8h` 8 cột · `8v` 8 hàng |
| 9 (4) | `9s` 3×3 · `5-4` 5 trên + 4 dưới · `9h` 9 cột · `9v` 9 hàng |
| 10 (3) | `10c5` 5 cột × 2 hàng · `10h` · `10v` |
| 12 (3) | `12c6` 6 cột × 2 hàng · `12c4` 4 cột × 3 hàng · `12h` |
| 14 (1) | `14c7` 7 cột × 2 hàng |
| 16 (2) | `16c8` 8 cột × 2 hàng · `16c4` 4×4 |

  Các mẫu 1–3 ô **khớp đúng** 9 mẫu app đã đoán; từ 4 ô trở lên TV có nhiều hơn (4 ô: 10 mẫu so với 7; 5 ô: 10 so với 2; 6 ô: 6 so với 2; 7 ô: 3 so với 1; 8 ô: 4 so với 2). (Cặp `1-3`/`3-1`, `1-4`/`4-1` đọc từ ảnh zoom; dữ liệu rasterize của từng cặp trùng nhau nên ghi theo ảnh.)
- Dưới các hàng mẫu: nhãn **"SYNC IN LAYOUT"** (chữ hoa nhỏ, xám) rồi 5 hàng công tắc, mỗi hàng: tên + icon `ⓘ` (tooltip) + **toggle switch** ở mép phải (không phải checkbox). Thứ tự: **Symbol, Interval, Crosshair, Time, Date range**. Trạng thái đọc được: Crosshair **bật**, còn lại tắt (layout của người dùng; đây rất có thể là mặc định của TV).
- Tooltip (nguyên văn):
  - Symbol — "Symbol changes on all charts within the layout"
  - Interval — "Interval changes on all charts within the layout"
  - Crosshair — "Crosshair is synced across all charts within the layout"
  - **Time — "When a chart is clicked, all charts within the layout display the same point of time"**
  - Date range — "Date range changes on all charts within the layout"

  ⇒ **"Time" của TV là đồng bộ khi BẤM**: bấm vào một chart thì mọi chart cuộn tới cùng một thời điểm; khác với bản app (Phase 4) đang làm Time = đồng bộ mép phải khi cuộn. "Date range" = đổi khoảng thời gian hiển thị (cuộn/zoom) thì cả layout đổi theo — gần với "Time" của app.

## 3. Menu layout (chevron cạnh tên)

Menu thả xuống, rộng ≈ **200px** (x 1019–1219), bước mục **32px**, có icon trái:

1. **Save layout** `⌘S` — xám (vô hiệu) khi Autosave bật.
2. **Autosave** — toggle (đang bật).
3. **Share layout** `ⓘ` — toggle (tắt).
4. **Make a copy…**
5. **Rename…**
6. **Download chart data…**
   — đường kẻ —
7. **Create new layout…**
   — đường kẻ —
8. Nhãn **RECENTLY USED**, rồi danh sách layout gần đây: mỗi mục 2 dòng — emoji + tên / "SYMBOL, khung" (vd "XAUUSD, 15"); mục đang mở nền `#f2f2f2`.
   — đường kẻ —
9. **Open layout…** (phím tắt hiện chữ "Dot" = phím `.`).

⇒ TV có **toggle Autosave** (app hiện luôn autosave, không có toggle: ổn, ghi nhận là khác biệt). TV không có "Delete layout" trong menu này (xoá nằm trong dialog Layouts).

## 4. Dialog "Layouts" (Open layout…)

- Hộp giữa màn hình, x=480, y=105, **w=480, cao 540**; tiêu đề **"Layouts"** (to, trái), nút **✕** góc phải.
- Ô tìm kiếm có icon kính lúp, placeholder "Search", tự focus.
- Hàng tiêu đề cột: "LAYOUT NAME" (chữ hoa nhỏ xám) + nút sắp xếp (icon `↓≡`) bên phải: menu 4 mục — tên ↑/↓, ngày ↑/↓ (mặc định: **ngày ↓**).
- Mỗi layout: hàng cao ≈48px, bo 4px; dòng 1 emoji + **tên**; dòng 2 `SYMBOL, khung (Oct 21, 2026, 23:55)` = symbol + khung của chart đầu + **giờ sửa cuối** (định dạng ngày giờ). Layout đang mở nền `#f2f2f2`.
- Rê chuột vào hàng: hiện **ngôi sao** (yêu thích) bên trái và **thùng rác** (xoá) bên phải. Bấm hàng = mở layout.
- Khác app hiện tại: TV có sao yêu thích, sắp xếp 4 kiểu, hiện giờ sửa kiểu "Oct 21, 2026, 23:55"; app dòng 2 đang là "XAUUSDm 15 · BTCUSDm 1h" (tóm tắt mọi chart — hợp lý hơn khi nhiều chart, giữ).

## 5. Việc cần làm trong app theo kết quả — **đã làm 2026-10-22** (xem `layout-plan.md` §0)

1. ✅ Danh sách mẫu: 42 mẫu 1–8 ô với id TV (+ alias id cũ). Còn lại: 9–16 ô khi nâng `MAX_PANES` (Phase 5).
2. ✅ Popup: bỏ tiêu đề, hàng 41px, icon khung + đường chia, toggle switch, nhãn "SYNC IN LAYOUT".
3. ✅ Sync "Time" = đồng bộ khi BẤM (căn cùng vị trí ngang, chưa đo được TV căn thế nào — §7); "Date range" = cuộn + zoom cả hai mép.
4. ✅ Mặc định sync: chỉ Crosshair bật.
5. ✅ Menu layout: thêm RECENTLY USED, đổi thứ tự mục như §3 (giữ Delete layout, không có toggle Autosave).
6. ✅ Dialog Open: tiêu đề "Layouts", sắp xếp 4 kiểu, thùng rác khi rê chuột. ❌ ngôi sao yêu thích (chưa).
7. ❌ Alt+Enter / Alt+Click Maximize, Tab đổi chart active (§6) — chưa làm.

## 6. Từ tài liệu công khai của TV (không phải đo trực tiếp)

Nguồn: [How to sync the charts of my layout](https://www.tradingview.com/support/solutions/43000629992-how-to-sync-the-charts-of-my-layout/), [Synchronize the Date Range on multichart](https://www.tradingview.com/support/solutions/43000670346-how-to-synchronize-the-date-range-on-multichart/), [Date Range Synchronization (blog)](https://www.tradingview.com/blog/en/date-range-synchronization-31642/), [Leveraging multi-chart layouts](https://www.tradingview.com/support/solutions/43000629990-leveraging-multi-chart-layouts-in-your-analysis/), [Charting Library: Multiple-chart layout](https://www.tradingview.com/charting-library-docs/latest/trading_terminal/multiple-chart-layout/).

- **Date range**: "cuộn và đổi khoảng thời gian đang xem ở một chart thì các chart khác hiện cùng khoảng ngày"; chỉ chạy với loại chart theo thời gian (Bars, Candles, Hollow candles, Line, Area, Baseline, Heikin Ashi). ⇒ đúng với "Date range" của app (cả hai mép, zoom cũng lan). Tài liệu không nói đổi khung có kéo theo không.
- **Time**: tài liệu công khai không mô tả; tooltip thật (§2) là "bấm vào chart thì mọi chart hiện cùng một thời điểm" ⇒ bản app Phase 4 (Time = mép phải đi theo khi cuộn) **sai nghĩa**, cần làm lại thành "bấm vào chart → các chart khác cuộn tới thời điểm đó".
- **Drawings** sync có (nút riêng ở thanh trái khi bật multichart), chỉ giữa các chart cùng symbol — **không** nằm trong khối "Sync in layout" của popup (5 công tắc, đã xác nhận). Ngoài ra còn **nhóm biểu tượng emoji** (nút "Symbol/interval chart syncing" ở status line / menu Series): các chart cùng emoji đồng bộ symbol/interval với nhau — tính năng riêng, chưa có ở app.
- **Maximize chart**: mỗi chart có nút "Maximize chart" (vị trí chưa rõ), phím tắt **Alt+Enter** hoặc **Alt+Click** trên chart; **Tab** chuyển chart active. App chưa có phím tắt nào trong số này.
- Chart mới thêm: tài liệu nói indicator/strategy của chart đầu **áp cho các chart thêm vào**, còn *chart settings* của chart đầu không chuyển sang; symbol/interval do công tắc sync (hoặc nhóm emoji) quyết định. (App hiện: chart mới nhân bản symbol/khung/loại nến của chart active, KHÔNG kèm indicator.)
- Charting Library: layout tối đa **8 chart**, splitter mặc định chia đều (`resetLayoutSizes`); id mẫu: `<n>h` n cột, `<n>v` n hàng, `<a>-<b>` a chart hàng trên + b chart hàng dưới, `<n>s` 1 chart cao hết + 1 cột n−1 chart, `<n>` / `<n>c` lưới — khớp bảng §2.

## 7. Chưa đối chiếu (cần tài khoản có ≥ 2 chart/tab)

- Viền chart active (màu, độ dày, có hay không), vị trí/icon nút Maximize và khi nào hiện, độ rộng/màu splitter, kích thước tối thiểu của ô.
- Hành vi thật của Time (bấm cuộn tới đâu: căn giữa hay mép?), Crosshair (có đường ngang không), Date range khi đổi khung; chart mới lấy symbol/khung của chart nào.
- Số ô mà từng gói cho phép (Basic 1, Essential 2, ... tối đa 16); app không cần giới hạn theo gói.
