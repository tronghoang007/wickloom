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

### Gann (đo lần 2, 2026-10-21 — đã làm theo cho Gann Square và Gann Square Fixed)
- Chung: lưới **5×5 ô** tính từ điểm 1 về phía điểm 2; 6 mức 0…5 màu `#808080 #FF9800 #00bcd4 #4caf50 #089981 #808080`; fan line `a×b` từ điểm 1 tới mép hộp (2×1 → mép phải ở 1/2 chiều cao); cung tâm điểm 1, bán kính = khoảng cách tới điểm lưới (x, y), vẽ 1/4 vòng; nền giữa 2 cung liền nhau tô màu cung ngoài, transparency 80.
- **Gann Square**: lúc tạo TV chốt `scaleRatio` = giá/nến sao cho hộp vuông trên màn hình (176×176px; 29.629 giá / 26 nến = 1.1396), rồi ép giá điểm 2 theo tỉ lệ đó. Nhãn (`showLabels`, cỡ 12): khoảng giá phía trên góc trái, tỉ lệ phía trên góc điểm 2, số nến phía dưới góc phải.
- **Gann Square Fixed**: không có tỉ lệ; lưới vuông trên màn hình, **1 ô = khoảng cách pixel giữa 2 điểm** (√(176²+118²) ≈ 212px, ô đo được 211px). Điểm 2 là handle tỉ lệ nằm trong ô đầu.
- **Gann Box** (`gannbox`, đo lần 3): `hlevel1..7` / `vlevel1..7` = 0 #808080, 0.25 #FF9800, 0.382 #00bcd4, 0.5 #4caf50, 0.618 #089981, 0.75 #2962FF, 1 #808080 (giá và thời gian, tính từ điểm 1); `fillHorzBackground` + `fillVertBackground` transparency 80 (dải màu mức ngoài); `showTop/Bottom/Left/RightLabels` (nhãn hệ số 4 cạnh); `fans` (#9C9C9C) tắt; 4 handle góc; `linewidth 2`.
- **Gann Fan** (`gannbox_fan`): 9 tia từ điểm 1, tia 1/1 qua điểm 2; màu 1/8 #FF9800, 1/4 #089981, 1/3 #4caf50, 1/2 #089981, 1/1 #00bcd4, 2/1 #2962FF, 3/1 #9c27b0, 4/1 #e91e63, 8/1 #F23645; nhãn tia dốc (1/8…1/2) ở mức giá điểm 2, tia thoải (2/1…8/1) trên đường dọc qua điểm 2; `fillBackground` transparency 80; `showLabels`.

### Pitchfork (đo lần 3)
- 4 tool cùng 1 loại, khác `style`: pitchfork 0, schiff_pitchfork_modified 1, inside_pitchfork 2, schiff_pitchfork 3.
- Props: `median {#F23645, width 2}`, mức (theo nửa bề rộng median→nhánh = 1): 0.25 #ffb74d, 0.382 #81c784, **0.5 #089981 bật**, 0.618 #089981, 0.75 #00bcd4, **1 #2962FF bật**, 1.5 #9c27b0, 1.75 #e91e63, 2 #F77C80; `fillBackground` transparency 80; `extendLines false`.
- Gốc median: thường = p0; Schiff = (p0.x, giữa giá p0–p1); Modified = trung điểm p0–p1; **Inside** = trung điểm p0–p1 nhưng median bắt đầu ở trung điểm p1–p2 và song song gốc→p2 (độ dốc đo 0.054 vs 0.056). Đoạn nối vẽ màu median: p1–p2 (mọi loại), p0–p1 (Schiff, Modified, Inside), gốc–p2 (Inside).

### Gann (lần 1)
- `gannbox_square` (**Gann Square**): có `scaleRatio` (giá/nến) — điểm 2 bị ép theo tỉ lệ: 30 nến → 4120 → 4157.34 (1.2446/nến). Props: `reverse, showLabels, labelsStyle, arcsBackground, levels, fanlines, arcs, scaleRatio`.
- `gannbox_fixed` (**Gann Square Fixed**): giữ đúng 2 điểm nhập; props `reverse, arcsBackground{fill, transparency 80}, levels (6 mức, màu #808080 #FF9800 #00bcd4 #4caf50 #089981 #808080), fanlines (11: 8x1 5x1 4x1 3x1 2x1 1x1 1x2 1x3 1x4 1x5 1x8; bật mặc định 2x1 1x1 1x2), arcs (11 cung 1:0, 1:1, 1.5:0, 2:0, 2:1, 3:0, 3:1, 4:0, 4:1, 5:0, 5:1)`. Trên chart điểm 2 là handle **giữa** lưới chứ không phải góc; lưới + cung lớn hơn nhiều so với 2 điểm.

### Kênh (đo lần 3, 2026-10-21)
- **parallel_channel**: `level1..7` −0.25, 0, 0.25, 0.5 (nét đứt), 0.75, 1, 1.25 (màu #2962FF; 0 và 1 dày 2) — trên chart chỉ thấy 0, 0.5, 1; nền rgba(41,98,255,.2); `extendLeft/Right false`; nhãn tắt. TV chuẩn hóa điểm 3 về thời gian điểm 1 (giữ khoảng lệch giá).
- **regression_trend**: `inputs {upper/lower deviation ±2, source close}`; `upLine/downLine rgba(41,98,255,.3) width 2`, `baseLine rgba(242,54,69,.3) dashed`; nền transparency 70 — dải trên xanh, dải dưới đỏ; `showPearsons` (số Pearson R đầy đủ chữ số dưới đầu trái); `showLabelsOnPriceScale`.
- **flat_bottom**: màu #FF9800, nền .2. **disjoint_angle**: màu #089981, nền .2; đường 2 **dốc ngược**: từ (x điểm 1, giá p3 + Δ) tới (x điểm 2, giá p3), thời gian p3 không dùng; tô hình nơ.

### Fib còn lại (đo lần 3)
- **Default gốc TV** (fib_trend_ext, fib_channel chưa chỉnh): 11 mức bật 0 #808080, .236 #F23645, .382 #FF9800, .5 #4caf50, .618 #089981, .786 #00bcd4, 1 #808080, 1.618 #2962FF, 2.618 #F23645, 3.618 #9c27b0, 4.236 #e91e63; 13 mức mở rộng tắt.
- **fib_channel**: đoạn song song p1–p2 (không kéo dài) lệch về phía p3; nền .2; nhãn "hệ số (giá)" ở đầu trái (`horzLabelsAlign left, middle`), cỡ 12.
- **fib_timezone**: mốc 0 #808080, 1 2 3 5 8 13 21 34 55 89 #2962FF; không nền; nhãn phải/đáy; trendline xám nét đứt.
- **fib_trend_time**: 0 #808080, .382 #F23645, (.5 tắt), .618 #4caf50, 1 #089981, 1.382 #00bcd4, 1.618 #808080, 2 #2962FF, 2.382 #e91e63, 2.618 #9c27b0, 3 #673ab7; nền .2 giữa các đường dọc; nhãn đáy.
- **fib_speed_resist_fan**: h/v level 0, .25, .382, .5, .618, .75, 1 (màu như Gann Box) tính từ **điểm 2**; tia từ điểm 1 tới mép phải (giá) và mép trên (thời gian); `grid rgba(21,56,153,.8)`; nền .2; nhãn 4 cạnh.
- **fib_circles**: .236 #F23645, .382 #FF9800, .5 #089981, .618 #4caf50, .786 #00bcd4, 1 #808080, 1.618 #2962FF, 2.618 #e91e63, 3.618 #2962FF, 4.236 #e91e63, 4.618 #F23645; **elip** tâm trung điểm, bán trục = hệ số × |Δx|/2, |Δy|/2; nền .2; nhãn ở đáy elip.
- **fib_speed_resist_arcs**: cùng bộ mức; **nửa đường tròn tâm điểm 1**, bán kính = hệ số × |điểm 1→2|, phía điểm 2 (`fullCircles false`); nhãn trên đỉnh cung.
- **fib_wedge**: .236 #F23645, .382 #FF9800, .5 #4caf50, .618 #089981, .786 #00bcd4, 1 #808080; cạnh xám liền; nền .2.
- **fib_spiral**: #00bcd4, chiều kim đồng hồ. **pitchfan**: median #F23645, mức .5 #00bcd4, 1 #2962FF, nền .2 (tia từ p0).

### Patterns, Elliott, Cycles (đo lần 4, 2026-10-21)
- Màu mặc định: XABCD, Cypher #2962FF (nền, transparency 85); Head and shoulders #089981 (nền 85); ABCD #089981 (không nền); Triangle pattern #673ab7 (nền 85); Three drives #673ab7; Elliott impulse, correction #3d85c6; Elliott triangle #FF9800; double/triple combo #6aa84f (`degree 7`, `showWave`); Cyclic lines #80ccdb; Time cycles #159980 + nền rgba(106,168,79,.5) transparency 50; Sine #159980. Chữ trắng cỡ 12, nét dày 2.
- **XABCD**: tô X-A-B và B-C-D; đường chấm kèm ô tỉ lệ: X–B = AB/XA, A–C = BC/AB, B–D = CD/BC, X–D = AD/XA (vd 0.6, 0.556, 2.4, 1.067); chữ X A B C D trong ô nền.
- **Cypher**: như XABCD nhưng A–C = XC/XA (1.167), X–D = CD/XC (0.857).
- **ABCD**: chấm A–C (BC/AB) và B–D (CD/BC), không tô.
- **Three drives**: không có chữ; chấm nối đỉnh drive 1–2 và 2–3 với tỉ lệ mở rộng 2 số lẻ (2.43, 1.89).
- **Head and shoulders**: tô vai trái, đầu, vai phải phía trên đường cổ; đường cổ chấm qua 2 đáy, tới chỗ cắt cạnh ngoài; nhãn "Left Shoulder / Head / Right Shoulder" trong ô nền.
- **Triangle pattern**: AC và BD kéo tới đỉnh hội tụ (chấm), đường chấm dọc tại A, tô tam giác.
- **Elliott**: nhãn "(1)…(5)", "(A)(B)(C)", "(A)…(E)", "(W)(X)(Y)…" màu đường, không nền; điểm đầu không có nhãn.
- **Cyclic lines**: chỉ lặp về phía phải điểm 1; đoạn chấm điểm 1 → 2.
- **Time cycles**: nửa đường tròn thật (đường kính = khoảng 2 điểm) lặp 2 phía.
- **Sine line**: đáy/đỉnh tại 2 điểm, nửa chu kỳ = khoảng 2 điểm, kéo hết chiều ngang.

### Measurers, Shapes (đo lần 5, 2026-10-21)
- **price_range**: `linecolor #2962FF`, nền rgba(41,98,255,.15), `showPriceRange false, showPercentPriceRange true, showPipsPriceRange true, showVolume`; hộp + 2 cạnh ngang + mũi tên dọc ở giữa; nhãn **không nền** "0.60%, 2,500.0" phía điểm 2.
- **date_range**: hộp + 2 cạnh dọc + mũi tên ngang; nhãn ô `labelBackgroundColor #2E2E2E` chữ trắng "20 bars, 5h" / "Vol 138.84K" (`showBarsRange, showDateTimeRange, showVolume`).
- **date_and_price_range**: hộp + 2 mũi tên; ô tối 3 dòng "25.000 (0.60%) 2,500.0" / "20 bars, 5h" / "Vol 185.08K". Pip có 1 số lẻ và dấu phẩy nghìn.
- **arc** #e91e63 nền .2: nửa elip, đáy p1–p2, cao tới p3. **curve** #2962FF không nền (điều khiển tại (x điểm 2, giá điểm 1)). **double_curve** #673ab7. **triangle** #089981 nền .2. **rotated_rectangle** #4caf50 nền .2. **polyline** #00bcd4 nền .2. **path** #2962FF, `rightEnd 1` (mũi tên).
