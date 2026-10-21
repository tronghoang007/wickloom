# TradingView: settings popup + floating toolbar của drawings (tài liệu đối chiếu)

Thu thập 2026-10-21 từ tab TradingView của user (OANDA:XAUUSD), qua `TradingViewApi.activeChart()`:
`createMultipointShape` → `getShapeById(id).getProperties()` → `showPropertiesDialog(id)` → đọc DOM `[data-name="source-properties-editor"]`.
Defaults bên dưới là default **trong tài khoản user** (có thể đã chỉnh), không phải default gốc của TV.

**Giới hạn:** DNS của mạng (Viettel) trả `tradingview-static.b-cdn.net` → 127.0.0.1, nên TV không tải được code của tool chưa có trong cache.
Lần đầu chỉ lấy được 18 tool + FRVP (chụp tay). Lần 2 (Phase 4) lấy thêm Position, Fib retracement, Gann square/fixed, Shift. Còn lại (pitchfork, channel, pattern, elliott, measure, brush…) chưa có dữ liệu thật.

## 1. Khung dialog (chung cho mọi tool)

- Rộng 380px, nền `#1f1f1f`, bo 6px, shadow `0 2px 4px rgba(0,0,0,.4)`, chữ `#dbdbdb` 14px, font `-apple-system, system-ui, "Trebuchet MS", Roboto, Ubuntu, sans-serif`.
- Header: tên tool 20px/600 (tên ngắn: "Trendline", "FRVP", "Pin" cho note) + **icon bút để đổi tên** + nút X.
- Tabs gạch chân 16px/600: tuỳ tool trong `Inputs | Style | Text | Coordinates | Visibility`.
- Nhãn mục (vd "INFO") 11px, `#8c8c8c`, viết hoa.
- Checkbox nằm **bên trái** nhãn (`[x] Middle point`), không phải bên phải.
- Dropdown là nút tùy biến (không dùng `<select>` của OS).
- Footer: `Template ▾` (trái) · `Cancel` (viền) · `Ok` (nền trắng chữ đen).
- Đổi giá trị là **xem trước trực tiếp** trên chart; Cancel thì trả lại như cũ.

### Ô "Line" (màu + nét)
Nút gộp `[ô màu | mẫu nét]`, bấm mở popover: bảng màu · `+` (màu tùy chọn) · Opacity (thanh trượt + ô %) · **Thickness** (4 nút) · **Line style** (liền / đứt / chấm).
Trend line có thêm 2 nút đầu mút trái / phải (thường / mũi tên).

### Bảng màu (đúng thứ tự TV)
```
#ffffff #dbdbdb #b8b8b8 #9c9c9c #808080 #636363 #4a4a4a #2e2e2e #0f0f0f #000000
#f23645 #ff9800 #ffeb3b #4caf50 #089981 #00bcd4 #2962ff #673ab7 #9c27b0 #e91e63
#fccbcd #ffe0b2 #fff9c4 #c8e6c9 #ace5dc #b2ebf2 #bbd9fb #d1c4e9 #e1bee7 #f8bbd0
#faa1a4 #ffcc80 #fff59d #a5d6a7 #70ccbd #80deea #90bff9 #b39ddb #ce93d8 #f48fb1
#f77c80 #ffb74d #fff176 #81c784 #42bda8 #4dd0e1 #5b9cf6 #9575cd #ba68c8 #f06292
#f7525f #ffa726 #ffee58 #66bb6a #22ab94 #26c6da #3179f5 #7e57c2 #ab47bc #ec407a
#b22833 #f57c00 #fbc02d #388e3c #056656 #0097a7 #1848cc #512da8 #7b1fa2 #c2185b
#801922 #e65100 #f57f17 #1b5e20 #00332a #006064 #0c3299 #311b92 #4a148c #880e4f
```
(hàng 1 xám, hàng 2 màu chính, cách 1 khoảng rồi 6 hàng sắc độ)

### Tab Text (tool có chữ)
`[màu chữ] [cỡ ▾] [B] [I]`, ô textarea "Add text", `Text alignment [Top▾] [Center▾]` (rectangle: `Inside▾`).

### Tab Coordinates
Mỗi điểm 1 hàng: `#1 (price, bar)  [giá có nút tăng/giảm, format theo tick]  [chỉ số nến]`.
Horizontal ray: chỉ `#1`. FRVP: `#1 (bar)`, `#2 (bar)` (không có giá). Signpost: `#1 (vertical position %, bar)`.
Ellipse và Text **không có** tab Coordinates.

### Tab Visibility (giống nhau mọi tool)
`[x] Ticks` · `[x] Seconds 1–59` · `[x] Minutes 1–59` · `[x] Hours 1–24` · `[x] Days 1–366` · `[x] Weeks 1–52` · `[x] Months 1–12` · `[x] Ranges`.
Mỗi hàng: checkbox, ô số từ, thanh trượt 2 đầu, ô số đến.

## 2. Thanh nổi (floating toolbar)

Thứ tự nút (theo `data-name`): `templates · line-tool-color · background-color · text-color · font-size · line-tool-width · style · settings · add-alert · lock · toggle-anchor · remove · more` — mỗi tool chỉ hiện một phần (xem mục 3).

- **Màu** (line/background/text): popover bảng màu + `+` + Opacity. **Không** có thickness/style (khác ô Line trong dialog).
- **Width**: nút `— 2px`, menu `1px / 2px / 3px / 4px` (mỗi dòng có vạch dày tương ứng; dòng đang chọn nền trắng chữ đen).
- **Style**: menu `Line / Dashed line / Dotted line` (có mẫu nét).
- **Templates**: `Save Drawing Template As…` · `Apply Default Drawing Template` · gạch ngang · danh sách template đã lưu.
- **More**: `Visual order ›` · `Visibility on intervals ›` · gạch · `Clone ⌘+Drag` · `Copy ⌘+C` · gạch · `Hide`.
- Menu chuột phải trên hình: `Add alert…` · Visual order › · Visibility on intervals › · Object tree · Clone · Copy · Lock · Hide · Remove · Settings…

## 3. Từng tool (đã lấy được)

Ký hiệu: `[x]`/`[ ]` checkbox, `<…▾>` dropdown, `(màu)` nút màu, `{…}` ô nhập.

### Nhóm đường: trendline · ray · extended · infoline · arrow
- Tabs: Style, Text, Coordinates, Visibility
- Toolbar: templates, line-tool-color, text-color, line-tool-width, style, settings, add-alert, lock, remove, more
- Style: `Line (màu+nét) <đầu trái> <đầu phải>` · `Extend <Don't extend / Extend left line / Extend right line / cả hai ▾>` · `[ ] Middle point` · `[ ] Price labels` · **INFO**: `Stats <Hidden ▾>` (chọn nhiều: Price range, percent change, change in pips, bars range, date/time range, distance, angle) · `Stats position <Left/Center/Right ▾>` · `[ ] Always show stats`
- Text: màu, cỡ 14, B, I, textarea, alignment `Top / Center`
- Khác nhau chỉ ở default: ray `extendRight=true`; extended `extendLeft=extendRight=true`; arrow `rightEnd=1` (mũi tên); infoline: Stats = tất cả, position Center, Always show stats bật.
- Props: `linecolor textcolor linewidth linestyle extendLeft extendRight leftEnd rightEnd horzLabelsAlign vertLabelsAlign fontsize bold italic alwaysShowStats showMiddlePoint showPriceLabels showPriceRange showPercentPriceRange showPipsPriceRange showBarsRange showDateTimeRange showDistance showAngle statsPosition`

### hray (Horizontal ray)
- Toolbar như nhóm đường. Style: `Line (màu+nét)` · `[x] Price label`. Text: cỡ 12, alignment `Bottom / Center`. Coordinates: chỉ #1.
- Props: `linecolor textcolor linewidth linestyle showPrice fontsize bold italic horzLabelsAlign vertLabelsAlign`

### rect (Rectangle)
- Toolbar: templates, line-tool-color, **background-color**, text-color, line-tool-width, style, settings, add-alert, lock, remove, more
- Style: `Extend <▾>` · `Border (màu+nét)` · `[ ] Middle line (màu+nét)` · `[x] Background (màu)`
- Text: alignment `Inside / Center`
- Props: `color fillBackground backgroundColor linewidth linestyle transparency horzLabelsAlign vertLabelsAlign textColor fontSize bold italic extendLeft extendRight middleLine{showLine,lineWidth,lineColor,lineStyle}`

### circle · ellipse
- Toolbar: templates, line-tool-color, background-color, text-color, line-tool-width, settings, lock, remove, more (không có style, không alert)
- Style: `Border (màu+nét)` · `[x] Background (màu)`. Text: màu, cỡ, B, I, textarea (không alignment). Ellipse không có Coordinates.

### arrowmarker (Arrow marker)
- Toolbar: templates, background-color, text-color, settings, lock, remove, more
- Style: `Color (màu)`. Text: cỡ 16, textarea. Props: `backgroundColor textColor bold=true italic fontsize`

### arrowup · arrowdown
- Toolbar: templates, line-tool-color, text-color, settings, lock, remove, more
- Style: `Arrow (màu)`. Text: cỡ 14. Default màu: up `#089981`, down `#CC2F3C`. Props: `color arrowColor fontsize bold italic showLabel`

### text
- Tabs: **Text, Visibility** (không Style, không Coordinates)
- Toolbar: templates, text-color, font-size, settings, lock, **toggle-anchor**, remove, more
- Text: `(màu) <14▾> B I` · textarea · `[ ] Background (màu)` · `[ ] Border (màu)` · `[ ] Text wrap`
- Props: `color backgroundColor borderColor backgroundTransparency fontsize bold italic fillBackground drawBorder wordWrap wordWrapWidth anchored`

### note (TV gọi là "Pin")
- Toolbar: templates, line-tool-color, text-color, font-size, settings, lock, toggle-anchor, remove, more
- Style: `Label (màu)`. Text: `(màu) <14▾>` textarea · `[x] Background` · `[ ] Border`
- Props: `textColor backgroundColor backgroundTransparency borderColor markerColor fontSize bold italic drawBackground drawBorder anchored`

### pricenote (Price note)
- Toolbar: templates, line-tool-color, background-color, text-color, settings, lock, remove, more
- Style: `Label text (màu) <12▾>` · `Label background (màu)` · `Label border (màu)` · `Line color (màu)`. Text: alignment `Top / Center`.

### callout · comment
- Tabs: Text, Coordinates, Visibility. Toolbar: templates, text-color, background-color, font-size, settings, lock, remove, more
- callout Text: `(màu) <14▾>` textarea · `Background (màu)` · `Border (màu)` · `[ ] Text wrap`
- comment Text: `Text (màu) <16▾>` textarea · `Background (màu)` · `Border (màu)`

### signpost
- Toolbar: templates, font-size, settings, lock, remove, more
- Style: `[ ] Emoji pin (emoji) (màu)`. Text: `<12▾>` textarea.

### frvp (Fixed range volume profile) — chụp tay
- Tabs: Inputs, Style, Coordinates, Visibility. Toolbar: templates, settings, lock, remove, more (không alert).
- Inputs: `Rows Layout <Number of rows / Ticks per row ▾>` · `Row Size {24}` · `Volume <Up/Down / Total / Delta ▾>` · `Value Area Volume {70}` · `[ ] Extend Right`
- Style: `[x] Volume profile` › `[ ] Values (màu)` · `Width (% of the box) {30}` · `Placement <Left/Right ▾>` · `Up Volume` · `Down Volume` · `Value Area Up` · `Value Area Down` (màu có opacity) · `[x] VAH (màu+nét)` · `[x] VAL (màu+nét)` · `[x] POC (màu+nét)` · `[ ] Developing POC` · `[ ] Developing VA` · `Histogram Box (màu)`
- Coordinates: `#1 (bar)`, `#2 (bar)`.

### longpos / shortpos (Position) — đo 2026-10-21
Toolbar: templates, text-color, (màu lời), (màu lỗ), (biểu tượng), settings, add-alert, lock, remove, more.
- **Mô hình:** chỉ 2 điểm `[entry (time, price), mép phải (time)]`; stop/target lưu là `stopLevel`/`profitLevel` = **số tick lệch so với entry**. Hệ quả: kéo entry thì target và stop dịch theo; mép phải giữ thời gian.
- Giá entry làm tròn theo tick (4122.71). Điểm của trend line thì **không** làm tròn.
- **Tạo bằng 1 click:** stop = target = **20% biên độ High−Low của các nến đang thấy** (đo 0.1993 và 0.1991 ở 2 mức zoom); rộng **≈ 1/7 số nến đang thấy** (28/193, 31/214).
- Props: `linecolor #808080, textcolor #fff, stopBackground rgba(242,54,69,.2), profitBackground rgba(8,153,129,.2), linewidth 1, fontsize 12, compact false, riskDisplayMode money|percents, accountSize 1000, lotSize 1, risk, leverage, alwaysShowStats false, showPriceLabels true, qtyPrecision default, infoBlocks{tp/sl PriceOffset, PercentOffset, TickOffset, Amount, PL, openClosePL, qty, riskRewardRatio}`.
- **Nhãn** (hiện khi chọn): `Target: 14.327 (0.347%) 1,432.7, Amount: 1250` · `Stop: 14.327 (0.347%) 1,432.7, Amount: 750` · giữa trên đường entry: `Closed PnL: 14.327, Qty: 17` / `Risk/reward ratio: 1`.
  - số thứ 3 là **pip** (XAUUSD tick 0.001 → pip 0.01), có dấu phẩy nghìn; Amount **không** có dấu phẩy.
  - Amount = **tài khoản ± rủi ro × R** (R:R 2 → 1500), không phải qty × khoảng cách.
  - PnL ghi theo **giá** (14.327), không theo tiền. Qty = rủi ro / (stop × lot) **làm tròn xuống** (17.64 → 17).
- Handles: entry, target, stop ở mép trái; 1 handle mép phải trên đường entry.

### fib_retracement — props (default **đã chỉnh trong tài khoản user**)
- Mức trong tài khoản: 0, 0.382, 0.5, 0.618, 1 hiện (màu cam); 0.236, 0.786, 1.618, 2.618, 3.618, 4.236, 1.272, 1.414, 2.272, 2.414, 2, 3, 3.272, 3.414, 4, 4.272, 4.414, 4.618, 4.764 ẩn. Default gốc của TV không đọc được qua API (`TradingView.factoryDefaults` trả object rỗng).
- `trendline {#808080, width 1, style 2 (dashed)}`, `levelsStyle {width 1, style 0}`, `showCoeffs, showPrices, fillBackground true, transparency (user 100), extendLines/extendLinesLeft false, reverse false, coeffsAsPercents false, fibLevelsBasedOnLogScale false, labelFontSize 11, horzLabelsAlign (user right), vertLabelsAlign middle`.
- Vẽ: mức 0 ở điểm 2, 1 ở điểm 1; đường mức chạy giữa x của 2 điểm; nhãn `0.5 (4,132.000)` nằm **ngoài** đầu đường, canh giữa dọc, giá đủ số lẻ theo tick.

### Shift khi vẽ (TV)
- Trend line: Shift → ngang tuyệt đối (2 điểm cùng giá).
- Rectangle: Shift → **hình vuông trên màn hình** (200×200px), cạnh = cạnh dài.
- Rectangle có 8 handle: 4 góc + 4 giữa cạnh.

### Gann (chưa làm theo)
- `gannbox_square` (**Gann Square**): có `scaleRatio` (giá/nến) — điểm 2 bị ép theo tỉ lệ: 30 nến → 4120 → 4157.34 (1.2446/nến). Props: `reverse, showLabels, labelsStyle, arcsBackground, levels, fanlines, arcs, scaleRatio`.
- `gannbox_fixed` (**Gann Square Fixed**): giữ đúng 2 điểm nhập; props `reverse, arcsBackground{fill, transparency 80}, levels (6 mức, màu #808080 #FF9800 #00bcd4 #4caf50 #089981 #808080), fanlines (11: 8x1 5x1 4x1 3x1 2x1 1x1 1x2 1x3 1x4 1x5 1x8; bật mặc định 2x1 1x1 1x2), arcs (11 cung 1:0, 1:1, 1.5:0, 2:0, 2:1, 3:0, 3:1, 4:0, 4:1, 5:0, 5:1)`. Trên chart điểm 2 là handle **giữa** lưới chứ không phải góc; lưới + cung lớn hơn nhiều so với 2 điểm.
