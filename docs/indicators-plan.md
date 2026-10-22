# Kế hoạch làm lại toàn bộ indicator theo TradingView (đủ Settings)

Ngày lập: 2026-10-22. Phần dưới (mục 1–8) là kế hoạch ban đầu; tiến độ ở mục "Tiến độ". Đã đọc: `web/src/indicators/*`, `IndicatorsDialog.tsx`,
`VolumeSettingsDialog.tsx`, `store/volume.ts`, `store/paneStores.ts`, `store/paneStorage.ts`, phần legend trong `Chart.tsx`.
Chi tiết TV bên dưới lấy từ (a) dialog Vol đã capture ngày 2026-10-21 (xem memory `volume-indicator-and-legend`) và
(b) hiểu biết chung về TV; mục nào chưa kiểm chứng bằng TV thật đánh dấu **⚠** — Phase 0 sẽ chốt lại.

## Tiến độ

- **Phase 0 (capture TV): chưa làm** — cần bạn đồng ý tạo/xoá study tạm trong tab TV (mục 8). Phase 1 không phụ thuộc nó.
- **Phase 1 (nền engine): xong 2026-10-22.** `indicators/ta/*` (sma ema rma wma vwma hma stdev highest lowest tr atr rsi change; O(n), seed/na như Pine),
  `calendar.ts` (kỳ ngày/tuần/tháng/năm theo giờ broker, dùng mốc D1 thật để đúng qua DST), `schema.ts` + `defs/` + `catalog.ts` (10 indicator khai báo),
  `instance.ts` (instance có `v`, `inputs`/`style.plots[id].color` chỉ lưu phần user đặt, migrate từ `{uid,id,inputs,colors}`, id lạ bị bỏ),
  `engine.ts`, `data.ts` (`BarHistory` nạp ngầm ≥5000 nến cũ hơn nến chart, `CalendarFeed` offset + D1), `diff.ts` (tick chỉ `update` nến cuối thay vì `setData` cả mảng), `manager.ts` viết lại.
  Sửa lỗi #1 (lịch sử ngắn), #3 (setData toàn bộ mỗi 250ms), #4 (windowed O(n·w)), #7 (VWAP theo UTC, `v||1`). 72 test mới; kiểm tra tay trên trình duyệt với layout cũ (migrate OK, nạp 4500 nến cũ, VWAP Week, đổi input trong dialog).
  - **Phase 3 (một phần, làm sớm theo yêu cầu 2026-10-22 "mọi indicator phải có mắt/settings khi hover như Vol"): xong.** Hàng legend `IndicatorLegend` cho MỌI indicator: giá trị từng plot theo nến dưới crosshair,
  rê chuột hiện **mắt · gear · thùng rác · ⋯**, nhấp đúp mở Settings, ẩn thì mờ + bỏ giá trị; menu ⋯ giống Vol (Visibility on intervals + Hide/Remove/Favorites/Settings chạy thật; Visual order / Move to / Pin to scale / Copy / Alert vẫn khoá).
  `IndicatorSettingsDialog` chung dựng từ def (Inputs · Style: bật/tắt + màu từng plot, Precision, Labels on price scale, Values/Inputs in status line · Visibility; Defaults ▾ Reset, Cancel khôi phục, Ok).
  Khung dialog tách thành `settingsParts.tsx` (`SettingsFrame`, `VisibilityTab`, `Check`, `Section`) dùng chung với Volume; icon hover tách thành `legendButtons.tsx`.
  Instance thêm `hidden/visibility/precision/priceLabel/statusValues/statusInputs` + `style.plots[id].visible`. Manager đổi màu/ẩn/precision/input bằng `applyOptions` + tính lại (không dựng lại series) → phần lớn lỗi #2 đã hết; chỉ thêm/xoá/đổi thứ tự indicator mới dựng lại.
  Còn lại của Phase 3: dialog Indicators dựng lại (bỏ tab "On chart"), Visual order / Move to / Pin to scale thật, Chart Settings → Status line → Values, độ dày/nét/levels/fill trong Style (Phase 2).
  Khác kế hoạch: (1) `lowerBars(tf, from, to)` và `htf(tf)` **chưa làm** — chưa def nào dùng, làm ở Phase 4b/4c khi cần;
  (2) lịch sử ngầm chỉ lấy từ DB backend, chưa tự xin MT5 backfill khi DB ít hơn 5000 nến; (3) EMA giờ seed bằng giá đầu tiên như Pine (trước đây seed SMA) nên có giá trị từ nến đầu;
  (4) VWAP thêm input **Anchor Period** (Session/Week/Month/Year); (5) #2 (xoá/dựng lại mọi series khi đổi màu/input) vẫn còn — thuộc Phase 2.

Kết luận: không vá `registry.ts` thêm được nữa. Mô hình hiện tại (input = số/select, màu = mảng, mỗi indicator 1 pane) quá hẹp so với
Settings của TV. Cần **schema indicator mới (khai báo, giống metadata của Pine)** + engine tính + renderer + dialog Settings/legend dùng chung.
Volume (đã làm riêng) sẽ gộp vào cùng khung ở giai đoạn cuối.

## 1. Hiện trạng và lỗi/giới hạn (đọc code)

| # | Chỗ | Vấn đề | Hậu quả |
|---|---|---|---|
| 1 | `lib/api.ts:53`, `Chart.tsx:802,1137` | Chart nạp 500 nến; indicator chỉ tính trên đúng số nến đã nạp | EMA/RMA/RSI/ATR/ADX… cần lịch sử dài mới hội tụ → **giá trị lệch TV, nhất là phần đầu chart**; EMA200, Ichimoku (52+26) gần như rỗng |
| 2 | `manager.ts:58-61` | Đổi bất kỳ thứ gì (màu, input) → `JSON.stringify` khác → xoá & tạo lại **mọi** series | Nháy hình, mất vị trí/chiều cao pane, không thể xem trước mượt |
| 3 | `manager.ts:80-83` | Mỗi 250ms tính lại toàn bộ + `setData` toàn bộ cho mọi indicator, kể cả khi chỉ đổi nến cuối | Tốn CPU khi nhiều indicator / dữ liệu dài |
| 4 | `math.ts:18-25` | `windowed` dùng `slice` + `Math.max(...w)` mỗi nến → O(n·w) | Chậm với dữ liệu dài; `Math.max(...w)` vỡ với window lớn |
| 5 | `registry.ts` | Input chỉ `number`/`select`; không có bool, màu, timeframe, source tham chiếu indicator khác, nhóm (group), tooltip | Không dựng được Settings như TV (vd Smoothing, Calculate Divergence) |
| 6 | `registry.ts` | Plot chỉ `line`/`histogram`; độ dày cố định 1; không kiểu nét, plot type, fill giữa 2 plot, band nền, offset | Thiếu hẳn tab Style của TV |
| 7 | `registry.ts` (vwap) | Reset theo ngày UTC, `v||1`; không có bands/anchor/session | Sai với vàng/crypto (phiên theo giờ server broker); thiếu setting |
| 8 | `manager.ts:65` | `overlay ? pane 0 : ++pane` — mỗi indicator 1 pane mới | Không gộp nhiều indicator vào 1 pane, không "Move to", không đổi thang |
| 9 | `Chart.tsx:1578-1595` | Legend chỉ có tên + tham số + nút ✕; **không hiện giá trị**, không eye/gear/⋯, không mở Settings | Muốn đổi input phải vào tab "On chart" của dialog Indicators |
| 10 | `IndicatorsDialog.tsx:68-172` | Settings là cái thẻ trong tab "On chart" (ô số + ô màu); cột "AUTHOR/BOOSTS" là giả | Không giống TV (dialog Inputs/Style/Visibility, Cancel/Ok, Defaults) |
| 11 | `paneStores.ts:15-20` | `IndicatorInstance = {uid,id,inputs,colors}`; không `version`, không style/visibility/hidden/precision | Mỗi lần thêm setting là rủi ro làm hỏng layout đã lưu |
| 12 | `registry.ts` (`volume`) + `store/volume.ts` | Volume tồn tại **hai** nơi (registry không dùng + store riêng) | Trùng, dễ lệch; legend/menu/dialog Volume không tái dùng được |
| 13 | — | Không có test nào cho indicator | Không biết công thức đúng hay sai |

## 2. "Giống TV" nghĩa là gì — checklist chuẩn cho MỌI indicator

**Dialog Settings** (mở bằng gear trên legend / double-click legend / menu ⋯ → Settings; khung giống `VolumeSettingsDialog`):
- Header tên ngắn + nút X; tab **Inputs | Style | Visibility**; footer `Defaults ▾` (Reset settings · Save as default ⚠) · `Cancel` · `Ok`.
- Đổi là xem trước trực tiếp trên chart; Cancel/X/Esc trả về như lúc mở (mẫu đã có ở Volume).
- **Inputs**: đủ input của indicator, đúng nhãn/thứ tự/mặc định/min/max, có nhóm (vd "Smoothing" với Type · Length · BB StdDev), tooltip ⚠.
  Kiểu input: số nguyên, số thực, checkbox, dropdown, **Source** (open/high/low/close/hl2/hlc3/ohlc4/hlcc4 ⚠ + plot của indicator khác trên chart),
  timeframe (+ "Wait for timeframe closes") ⚠, session, text, màu.
- **Style**: mỗi plot một hàng `[x] tên  (màu + opacity)  kiểu nét  độ dày  plot type`; **Levels** (đường ngang: bật/tắt, giá trị, màu, nét, độ dày);
  **Background fill** giữa 2 plot / 2 level (bật/tắt + màu có opacity); khối **Output values** (Precision · Labels on price scale · Values in status line);
  khối **Input values** (Inputs in status line).
- **Visibility**: giống drawings (Minutes/Hours/Days/Weeks/Months; app không có Ticks/Seconds/Ranges) — đã có `drawings/visibility.ts`.

**Legend (status line)**: `Tên (inputs) giá-trị-plot-1 giá-trị-plot-2 …`, giá trị theo nến dưới crosshair (không có crosshair thì nến cuối), mỗi giá trị đúng màu plot,
tô xám khi hidden; hover hiện 4 nút **eye · gear · trash · ⋯**; menu ⋯: Add alert (khoá), Add indicator…, Add to favorites, Visual order ›, Visibility on intervals ›,
Move to ›, Pin to scale ›, Copy, Hide, Remove, Object tree, Settings. Các mục Visual order / Move to / Pin to scale hiện là stub bị khoá ở Volume — sẽ làm thật.
Tuân theo Chart Settings → Status line (Titles, Inputs; thêm **Values**).

**Pane/thang giá**: nhiều indicator chung 1 pane; "Move to → New pane above/below / pane có sẵn"; "Pin to scale → right / left / new / no scale (overlay)";
kéo chia pane (LWC có sẵn), maximize/collapse pane ⚠; nhãn giá cuối của từng plot trên trục (tắt được qua "Labels on price scale").

**Mỗi indicator "xong" khi**: công thức khớp (mục 6) · Inputs đủ như TV · Style đủ plot/level/fill · mặc định (màu, độ dày, nét) khớp · legend đúng · có test.

## 3. Kiến trúc đích

```
web/src/indicators/
  ta/            hàm thuần kiểu Pine ta.* : sma ema rma wma vwma hma stdev highest lowest tr atr rsi cci …  (O(n), có test)
  defs/          mỗi indicator 1 file khai báo: ma.ts rsi.ts macd.ts …
  schema.ts      kiểu IndicatorDef / InputDef / PlotDef / FillDef / HLineDef
  instance.ts    IndicatorInstance (version) + migrate từ {uid,id,inputs,colors}
  engine.ts      tính (đầy đủ / chỉ nến cuối), cache theo (inputs, bars version)
  render/        renderer: series theo plot, fill/hline primitives, offset, pane/scale
  catalog.ts     danh mục + nhóm + tên đầy đủ cho dialog Indicators
components/chart/indicator/
  IndicatorSettingsDialog.tsx   dialog chung theo def (tách Check/Section/Visibility khỏi VolumeSettingsDialog dùng chung)
  IndicatorLegend.tsx           hàng legend + nút + menu
```

**Def (khai báo, không có UI riêng cho từng indicator):**
```ts
type IndicatorDef = {
  id; name; title; category; description?;
  overlay: boolean;                       // mặc định trên chart chính hay pane riêng
  inputs: InputDef[];                     // {key,label,type,default,min,max,step,group?,tooltip?,options?,inline?}
  plots: PlotDef[];                       // {id,title,type:'line'|'histogram'|'columns'|'area'|'step'|'circles'|'cross'|'candles',color,width,lineStyle,display}
                                          // 'candles' = plotcandle: 4 chuỗi open/high/low/close + màu thân/viền/bấc, màu có thể theo điều kiện (CVD, mục 4d)
  fills?: FillDef[];                      // {between:[plotA|levelA, plotB|levelB], color, title}
  levels?: HLineDef[];                    // {id,value,color,width,lineStyle,visible}
  scale?: { format:'price'|'volume'|'percent'|'inherit'; min?; max? };
  warmup: (inputs) => number;             // số nến cần trước nến đầu tiên
  compute: (ctx: { bars; inputs; src(name); htf?(tf) }) => { [plotId]: Num; colors?: { [plotId]: string[] } };
  // Các loại output KHÔNG phải chuỗi theo nến (đều tuỳ chọn):
  profiles?: (ctx) => SessionProfile[];   // volume profile theo phiên: {t0, t1, rows…, poc, vah, val} → mục 4b
  objects?: (ctx) => ObjectSet;           // line / label / box kiểu Pine (xloc theo thời gian hoặc bar, extend right, max 500/loại) → mục 4c
  candleColors?: (ctx) => string[];       // ghi đè màu nến của chart chính (plotcandle "Color Candles")
};
// ctx của mọi compute: { bars, inputs, src(name), htf(tf) = nến khung lớn (request.security),
//                        lowerBars(tf, from, to) = nến khung nhỏ có cache/phân trang, calendar = ranh giới phiên/anchor (D/W/M, giờ broker) }
```
**Instance (lưu trong layout, có `v`):** `{ v, uid, id, inputs, style:{ plots:{[id]:{visible,color,width,lineStyle,type}}, levels, fills },
precision, priceLabel, statusValues, statusInputs, visibility, hidden, pane:{ ref, scale }, order }` — chỉ lưu phần khác mặc định.
`parsePaneInit`/`layoutDoc` đọc bản cũ `{uid,id,inputs,colors}` → map `colors[k]` vào `style.plots[plot k].color`. Có test migrate.

**Engine:** tính trên **lịch sử nạp riêng cho indicator** (≥ 5000 nến, tự nạp thêm khi cuộn trái; `warmup` để biết cần bao nhiêu) — chart vẫn hiển thị 500 như cũ.
Tick mới chỉ cập nhật nến cuối (hàm `ta` nào có state thì giữ state); đổi input / nạp thêm nến cũ mới tính lại cả mảng. Cân nhắc Web Worker nếu đo thấy giật.

**Renderer (lightweight-charts 5.2):** giữ series theo `(uid, plotId)`, đổi style bằng `applyOptions` (không dựng lại).
Map plot type → Line/Histogram/Area series; Cross/Circles/Step-diamonds → custom series hoặc markers; **fill giữa 2 plot / level** → `ISeriesPrimitive`
(đã quen từ drawings); hlines → price line hoặc primitive; **offset** (Ichimoku +26) → thêm whitespace point ở tương lai (xem rủi ro);
màu theo nến (MACD hist, SuperTrend, Awesome Osc) → màu từng điểm; `priceScaleId` + `scaleMargins` cho overlay/pin; pane ref → `chart.panes()`/`moveToPane`.

## 4. Danh mục indicator (theo độ ưu tiên)

Tên/inputs/mặc định/màu chính xác chốt ở Phase 0 từ TV thật — danh sách dưới chỉ là phạm vi.

**Tier 1 (~28, cái trader dùng nhiều + 10 cái đang có)**
- Overlay: Moving Average (SMA, có khối Smoothing) · EMA · WMA · SMMA · VWMA · Hull MA · Bollinger Bands · Keltner Channels · Donchian Channels ·
  Ichimoku Cloud · Parabolic SAR · Supertrend · VWAP (Session/Week/Month… + bands) · Pivot Points Standard
- Pane: Volume (gộp) · RSI (Smoothing, Calculate Divergence ⚠) · MACD · Stochastic · Stochastic RSI · ATR · ADX/DMI · CCI · Williams %R ·
  Awesome Oscillator · OBV · MFI · Momentum · ROC

**Tier 2 (~35)**: DEMA · TEMA · LSMA · McGinley · MA Ribbon · Envelopes · Zig Zag · Williams Alligator · Williams Fractals · Aroon · Bollinger %B ·
BB Bandwidth · Choppiness · Chaikin Money Flow · Chaikin Oscillator · A/D · Ultimate Oscillator · TRIX · TSI · Vortex · Volume Oscillator ·
Balance of Power · Elder Force Index · Ease of Movement · KST · Coppock · DPO · Historical Volatility · Standard Deviation · Relative Vigor Index ·
Price Oscillator · Net Volume · Accelerator Oscillator · Connors RSI · Mass Index · Chande Momentum · Klinger

**Yêu cầu thêm (2026-10-22), làm riêng:** **Session Volume Profile** + **Visible Range Volume Profile** (mục 4b) · **Cumulative Volume Delta / CVD dạng nến** (mục 4d) ·
**Smart Money Concepts [LuxAlgo]** (mục 4c). Ba cái này cần cơ chế mới (output profile / nến khung nhỏ / lớp object line-label-box) nên không nằm trong Tier 1–2.

**Tier 3 (cần thêm cơ chế)**: Sessions / killzone box (hợp vàng, ICT) ·
Anchored VWAP · Previous Day/Week/Month High-Low (cần dữ liệu khung lớn; SMC đã có bản "Highs & Lows MTF") · MA nhiều khung (`htf`) ·
các indicator cộng đồng khác vẽ object (sau khi SMC xong, lớp object dùng lại được).

## 4b. Session Volume Profile (SVP)

TV có indicator built-in **Session Volume Profile** (overlay, khung intraday): mỗi phiên một volume profile + POC / VAH / VAL (Value Area mặc định 70%).
Inputs/Style thật chốt ở Phase 0 ⚠; khung dự kiến lấy từ FRVP đã capture tay (`docs/tv-drawing-settings-reference.md`, mục frvp) vì cùng họ volume profile của TV:
- **Inputs**: Rows Layout (Number of rows / Ticks per row) · Row Size (24) · Volume (Up/Down · Total · Delta) · Value Area Volume (70) · Extend POC/VAH/VAL sang phải ⚠ (tên) ·
  có thể có lựa chọn phiên / extended hours ⚠.
- **Style**: `[x] Volume profile` (Values · Width % · Placement Left/Right) · Up Volume · Down Volume · Value Area Up · Value Area Down ·
  VAH / VAL / POC (màu + nét) · Developing POC / Developing VA ⚠ · Histogram Box · Output values · Visibility.
- "Session Volume Profile **HD**" của TV là gói Premium, chỉ khác độ mịn dữ liệu → một code, luôn dùng khung nhỏ nhất có thể (tab TV của user là Basic nên có thể không capture được bản HD).

**Đã có sẵn trong `web/src/drawings/tools.ts` + `manager.ts` (FRVP/AVP):** `computeProfile` (row theo Number of rows/Ticks per row, POC, Value Area),
`profileSource` (ghép nến khung nhỏ với nến chart), `volumeProfile` (vẽ histogram Up/Down/Total/Delta, Values, VAH/VAL/POC, Extend), `prefetchProfileBars`
(chọn khung nhỏ nhất có <5000 nến). Hiện dính chặt vào `Drawing`/`Shape`. **Chưa có**: Developing POC / Developing VA (TV có toggle ở FRVP, app chưa làm).

Việc làm:
1. **Tách module dùng chung** `web/src/volumeProfile/` (compute + chọn nguồn khung nhỏ + kiểu options + test). FRVP/AVP gọi lại module này, không đổi hành vi
   (test hiện có phải giữ nguyên xanh); làm luôn Developing POC/VA cho cả hai.
2. **Output kind `profiles`** (mục 3): def trả danh sách `{ t0, t1, rows(up/down), poc, vah, val }` theo phiên; renderer `ProfilePrimitive` (`ISeriesPrimitive`, vẽ ở bitmap space)
   dựng histogram trong khoảng x của từng phiên, đường POC/VAH/VAL (kèm nhãn trục), Extend sang phải; phiên đang chạy cập nhật theo tick, phiên đã đóng giữ cache.
3. **Định nghĩa phiên**: mặc định = ngày giao dịch của broker. Nến lưu `t` theo UTC; EA gửi `broker_utc_offset` nên biết điểm cắt ngày (phải kiểm tra DST, cuối tuần, gap).
   TV theo giờ phiên của sàn nên ⚠ chốt quy ước ở Phase 0. Thêm **preset ngoài TV**: Asia / London / New York / giờ tuỳ chọn (hợp vàng & ICT; dùng chung cơ chế với Sessions Tier 3).
   Chỉ có nghĩa ở khung < D1 → từ D1 trở lên ẩn và báo trong legend.
4. **Dữ liệu**: gom volume từ khung nhỏ (M1 trước) cho cả khoảng các phiên đang nạp bằng 1 lần tải (`fetchBars` giới hạn 50000, đã dùng ở `loadM1`), cắt theo phiên;
   phiên quá dài/quá nhiều thì dùng khung lớn hơn theo quy tắc <5000 nến/phiên như drawings. Cuộn trái nạp thêm phiên cũ thì tải thêm. Cache theo `(symbol, phiên, rev)`.
5. **UI**: dùng dialog Settings + legend chung (Phase 3), chỉ thêm khối control riêng cho profile (layout, volume type, placement, màu, line).
6. **Test**: cắt phiên đúng (DST, offset broker đổi, cuối tuần); tổng volume các row = tổng volume nến trong phiên; POC/VA khớp `computeProfile`; Up/Down/Delta; Extend; phiên cuối cập nhật theo tick.

Làm sau Phase 3 (cần renderer + dialog chung). Ước tính 3–4 ngày.

### 4b-2. Visible Range Volume Profile (VRVP) — user yêu cầu thêm 2026-10-22

Built-in TV, overlay: **một** profile cho **vùng đang nhìn thấy** của chart, ghim vào mép pane (mặc định bên phải), tính lại mỗi khi kéo/zoom.
Inputs/Style cùng họ FRVP/SVP (Rows Layout · Row Size 24 · Volume Up/Down|Total|Delta · Value Area Volume 70 · Width % · Placement Left/Right · Up/Down/Value Area colors ·
VAH/VAL/POC · Values · Developing POC/VA ⚠ · Histogram Background ⚠) — chốt khi capture ở Phase 0. Khác FRVP: không có Extend/Coordinates; khác SVP: không chia theo phiên.

- **Dữ liệu**: nến chart trong `visibleLogicalRange` (kể cả nến lọt một phần ở mép); chia volume theo nến khung nhỏ nhất có <5000 nến trong vùng — đúng quy tắc đã làm cho FRVP
  (`profileSource` + `prefetchProfileBars`), thiếu thì dùng nến chart.
- **Cơ chế riêng so với SVP**:
  1. `ProfilePrimitive` thêm chế độ **pinned**: x ghim theo mép pane (độ rộng = % bề ngang pane), không theo thời gian; chỉ y theo giá.
  2. Nghe `timeScale().subscribeVisibleLogicalRangeChange` → tính lại **debounce ~100–150ms**; có cache theo `(range, rev)`. Đường nhanh: tính ngay trên nến chart, sau đó nâng cấp lên nến khung nhỏ khi tải xong
     (giữ profile cũ tới lúc đó, tránh nháy).
  3. Vùng nhìn vượt dữ liệu đã nạp (cuộn trái) → kích hoạt nạp thêm như chart vẫn làm.
  4. Hiệu năng: `computeProfile` O(nến × row) mỗi lần đổi vùng → đo với M1 ~5000 nến; nếu chậm thì gộp nến theo bucket giá.
  5. Đang Replay: chỉ tính tới con trỏ replay.
- Dùng chung module `volumeProfile/` với SVP và FRVP/AVP (mục 4b). Ước tính **1 ngày** sau SVP.

## 4c. Smart Money Concepts [LuxAlgo] (SMC)

Nguồn: Pine v5 user dán 2026-10-22, lưu nguyên văn ở `docs/reference/smc-luxalgo.pine` (giữ header license). **License CC BY-NC-SA 4.0**: dùng cá nhân/phi thương mại,
bản port là tác phẩm phái sinh → giữ ghi công "© LuxAlgo" + cùng license ở đầu file port, không đóng gói/bán. Đã có clone MT5 (`SMC_LuxAlgo.mq5`, ~610 dòng, chưa có candle color và MTF levels,
file nay chỉ còn trong thư mục MT5) → dùng đối chiếu kết quả cấu trúc, không dùng làm nguồn chính.

**Inputs (đủ như script, giữ nhóm/inline/tooltip):**
- *Smart Money Concepts*: Mode (Historical / Present) · Style (Colored / Monochrome) · Color Candles
- *Real Time Internal Structure*: Show Internal Structure · Bullish Structure (All/BOS/CHoCH + màu) · Bearish Structure (All/BOS/CHoCH + màu) · Confluence Filter · Internal Label Size (Tiny/Small/Normal)
- *Real Time Swing Structure*: Show Swing Structure · Bullish/Bearish Structure (+ màu) · Swing Label Size · Show Swings Points (+ length 50, min 10) · Show Strong/Weak High/Low
- *Order Blocks*: Internal OB (+ số lượng 5, 1–20) · Swing OB (+ số lượng 5) · Order Block Filter (Atr / Cumulative Mean Range) · Mitigation (Close / High-Low) · 4 màu OB (internal/swing × bull/bear)
- *EQH/EQL*: Equal High/Low · Bars Confirmation (3) · Threshold (0.1; 0–0.5, step 0.1) · Label Size
- *Fair Value Gaps*: Fair Value Gaps · Auto Threshold · Timeframe (input.timeframe, rỗng = khung chart) · màu bull/bear · Extend FVG (1)
- *Highs & Lows MTF*: Daily / Weekly / Monthly (mỗi cái: bật + nét Solid/Dashed/Dotted + màu)
- *Premium & Discount Zones*: bật + màu Premium / Equilibrium / Discount

**Output:** line + label BOS/CHoCH (internal nét đứt, swing nét liền) · nhãn HH/HL/LH/LL · EQH/EQL (line chấm + nhãn) · Strong/Weak High/Low (line + nhãn) ·
box Order Block (kéo tới nến cuối) · FVG (2 box/gap, xoá khi bị lấp) · line + nhãn `P{tf}H/L` của D/W/M · box Premium/Equilibrium/Discount · `plotcandle` tô màu nến theo trend ·
16 `alertcondition` (app chưa có alerts → để lại chỗ cắm, bỏ qua lúc đầu).

**Cần có trước (cơ chế):**
1. **Lớp object line/label/box** (Phase 2c): `ObjLine {x1,y1,x2,y2,xloc time|bar,màu,nét,độ dày,extend}`, `ObjLabel {x,y,text,style up/down/left,size,màu chữ}`,
   `ObjBox {x1,y1,x2,y2,bg,border,extend right}` + `ObjectsPrimitive` (`ISeriesPrimitive`, bitmap space, cắt ngoài vùng nhìn). Giới hạn **500/loại, xoá cũ nhất** như `max_*_count` của script
   (ảnh hưởng thấy được ở phần lịch sử bên trái). Vị trí z (trên/dưới nến) ⚠ chốt khi so TV.
2. **`htf(tf)`** cho FVG theo timeframe và MTF levels (`request.security` + `lookahead_on`: `high[1]/low[1]` của nến D/W/M trước) — backend đã có D1/W1/MN1.
3. **`candleColors`**: ghi đè màu nến chart chính (Color Candles); phải chạy đúng với chart type Candles/Bars/Heikin (TV vẽ đè lên nến).
4. **Settings dialog chung hỗ trợ**: heading theo `group`, `inline` (dropdown + ô màu cùng hàng), tooltip, `input.color`, `input.timeframe`, số có min/max/step.

**Port thuật toán (state machine từng nến, như `var` của Pine):** `leg(size)` bằng highest/lowest · `getCurrentStructure` cho swing (50) / internal (5) / equal (N) ·
`displayStructure` (crossover/crossunder close qua pivot, cờ `crossed`, trend bias → BOS hay CHoCH, Confluence Filter) · Order Block (parsed high/low có lọc nến biến động
`range ≥ 2×volatility` với ATR(200) hoặc cum mean TR, lấy cực trị giữa pivot và nến hiện tại, xoá khi mitigate, giữ 100, hiện N gần nhất) · EQH/EQL (`|Δ| < threshold×ATR(200)`) ·
FVG (auto threshold = `cum(|Δ%|)/bar_index×2`) · MTF levels (cần tìm thời điểm đỉnh/đáy trong kỳ bằng binary search trên `times`) · trailing extremes + zones.
Realtime: Pine chạy lại mỗi tick có rollback; app **tính lại cả mảng khi có nến mới/tick, throttle 250ms** (đo: mục tiêu vài–chục ms cho 5000 nến), không cần rollback state.
Lưu ý: kết quả phụ thuộc điểm bắt đầu lịch sử (Strong/Weak, OB còn hiệu lực) → cần lịch sử ngầm đủ dài (≥5000 nến), TV tính trên dài hơn nên phần đầu chart có thể khác.

**Test:** unit test từng luật trên nến tổng hợp (pivot/leg, BOS vs CHoCH, chọn OB, mitigation, EQH threshold, FVG + auto threshold, PD zones, giới hạn 500) ·
đối chiếu cấu trúc với clone MT5 trên cùng bộ nến · nhìn cạnh TV (vàng OANDA vs XAUUSDm: giá lệch nhẹ nên chỉ so cấu trúc/vị trí, không so số).
Ước tính **5–7 ngày**, chưa tính lớp object ở Phase 2c (+3 ngày).

## 4d. Cumulative Volume Delta (CVD) — dạng nến

Nguồn: Pine v6 user dán 2026-10-22 (`docs/reference/cvd.pine`, dùng `ta.requestVolumeDelta` của thư viện `TradingView/ta`) + ảnh chụp từ TV (pane CVD dưới pane Vol).

**Từ ảnh TV (quan sát trực tiếp):**
- Pane riêng, vẽ **nến** (`plotcandle`): mỗi nến chart = 1 nến O/H/L/C của *delta tích luỹ* (open = delta tích luỹ đầu nến, high/low = cực trị trong nến, close = cuối nến).
  Màu `close ≥ open` → teal (`color.teal` = #089981), ngược lại red (#F23645); thân đặc, viền và bấc cùng màu.
- Đường ngang **0** nét đứt xám xuyên pane (`hline(0)`).
- Delta **về 0 mỗi chu kỳ Anchor** (mặc định 1D): thấy bước nhảy ở ranh giới ngày, nến đầu ngày bắt đầu quanh 0.
- Legend: `CVD  1D  Time  1  −817  1.15K  −1.11K  1.15K` = tên · inputs (Anchor `1D`, Aggregation `Time`, Timeframe `1`; input bool "Use custom timeframe" **không hiện**) ·
  4 giá trị **O, H, L, C** cùng màu nến; định dạng volume (`-817`, `1.15K`).
- Trục giá format volume (`40K`, `20K`, `0`), nhãn giá cuối `−11.82K` nền teal (màu theo nến cuối), chữ trắng.

**Inputs của script:** Anchor period (input.timeframe, mặc định 1D) · Data aggregation (Time / 1 tick; "1 tick" chỉ gói expert → trong app **khoá** + tooltip) ·
Use custom timeframe (bool) · Timeframe (mặc định "1", **chỉ bật khi** Use custom timeframe và không phải 1 tick → input cần thuộc tính `enabledIf`).

**Tính toán:**
- Khung nhỏ tự chọn: intraday → **M1**, daily → **M5**, weekly/monthly → **H1** (khung giây `1S` không có trong app). Custom thì dùng khung user chọn (phải ≤ khung chart, nếu không ẩn + báo trong legend).
- Delta của mỗi nến khung nhỏ: `close > open` → +volume, `close < open` → −volume; `open == close` → so với close nến trước, rồi giữ chiều trước ⚠ (nguồn thứ cấp, **kiểm lại với doc TV ở Phase 0**).
- Tích luỹ trong anchor period: `open = tích luỹ trước nến chart`, đi qua các nến khung nhỏ của nến chart để lấy `max/min/last`; sang anchor mới thì về 0.
- Volume là **tick volume của MT5** (vàng/FX không có volume thật; OANDA trên TV cũng là tick volume) → số tuyệt đối khác TV, hình dạng tương tự.
- Báo lỗi như script: broker không có volume (tổng volume = 0) → thông báo trong legend/toast.
- Ranh giới anchor (1D/1W/1M) dùng **calendar chung** (giờ broker từ `broker_utc_offset`, cùng quy ước với SVP, VWAP, Pivots) ⚠ TV theo phiên của sàn.

**Dữ liệu:** cần nến khung nhỏ phủ **từ đầu anchor period của nến chart đầu tiên**: M1 × nhiều ngày rất lớn (5000 nến M15 ≈ 52 ngày ≈ 75k nến M1 > giới hạn 50000/lần của `fetchBars`)
→ provider `lowerBars` phân trang + cache, và CVD chỉ tính cho vùng đang nhìn + 1 anchor thay vì cả 5000 nến (tính thêm khi cuộn trái). Nến đầu vùng nạp cắt giữa anchor thì tích luỹ lệch → luôn nạp từ ranh giới anchor.

**Hiển thị:** `candles` plot trong pane riêng (LWC `CandlestickSeries`, màu từng điểm teal/red), `levels: [0]` nét đứt, `scale.format = 'volume'` (K/M), nhãn giá cuối theo màu nến cuối;
legend hiện 4 giá trị O/H/L/C. **Settings**: Inputs như trên · Style: hàng "CVD" (màu thân/viền/bấc ⚠ chốt từ dialog TV), hàng hline 0 (màu/nét/độ dày) · Output values · Visibility.

Ước tính **2 ngày** nếu làm cùng SVP (chung `lowerBars`, calendar, kiểu `candles`).

## 5. Các phase

- **Phase 0 – Capture TV + spike (1–2 ngày).** Lấy từ tab TV của user (`TradingViewApi.activeChart().createStudy(...)` → đọc dialog
  `[data-name="indicator-properties-dialog"]` ⚠ + `getInputValues`/`getStyleInfo` nếu có) cho 28 indicator Tier 1: input (nhãn, kiểu, mặc định, nhóm, min/max),
  plot (tiêu đề, kiểu, màu, độ dày), fill, level, precision, overlay/pane, thang, dạng legend → `docs/tv-indicator-reference.md`.
  Thêm **Session Volume Profile** và **Visible Range Volume Profile** vào danh sách capture (Inputs, Style, quy ước phiên, Extend, Developing, cách ghim/Placement), cùng **CVD** và
  **SMC LuxAlgo** (dialog của script cộng đồng: group/inline/Style tab).
  Spike: có kéo được OHLCV + giá trị plot từ TV làm **fixture golden** không (nội bộ model; `exportData` đã biết là không hỗ trợ). Xem rủi ro DNS ở mục 7.
  Xuất fixture nến từ backend (XAUUSDm M5/H1, 5000 nến) cho test.
- **Phase 1 – Nền engine (3–4 ngày).** `ta/*` O(n) + test (so với TA-Lib/Pine reference + fixture); `schema.ts`; `instance.ts` + migrate + test;
  nạp lịch sử riêng cho indicator (≥5000, nạp thêm khi cuộn); engine tính đầy đủ/chỉ nến cuối;
  **hạ tầng dùng chung cho nhóm volume/SMC**: `calendar` (ranh giới phiên/anchor D·W·M theo giờ broker), `lowerBars(tf, from, to)` (nến khung nhỏ, phân trang + cache),
  `htf(tf)` (nến khung lớn). Chuyển 10 indicator hiện có sang def mới
  (sửa lỗi #1, #3, #4, #7 ngay trong bước này). UI chưa đổi.
- **Phase 2 – Renderer (3–4 ngày).** Series theo plot + `applyOptions` (hết nháy); độ dày/nét/opacity; plot type; fill + hlines primitive; offset;
  màu theo nến; nhiều indicator chung 1 pane; `priceScaleId`/pin; nhãn giá cuối tắt/bật; ẩn theo `visibility` và `hidden`.
  **Phase 2b (+1 ngày):** plot type `candles` (CandlestickSeries trong pane indicator, màu từng điểm, format volume K/M).
  **Phase 2c (+3 ngày):** lớp object line/label/box (`ObjectsPrimitive`, max 500/loại) + `candleColors` ghi đè màu nến chart chính.
- **Phase 3 – UI chung (4–5 ngày).** `IndicatorSettingsDialog` theo def (tab Inputs/Style/Visibility, xem trước + Cancel, Defaults ▾) — tách `Check`/`Section`/Visibility
  khỏi `VolumeSettingsDialog`; `IndicatorLegend` (giá trị theo crosshair, eye/gear/trash/⋯, double-click mở Settings) thay đoạn legend inline trong `Chart.tsx`;
  menu ⋯ làm thật Visual order / Move to / Pin to scale / Copy / Hide / Visibility on intervals; dựng lại dialog Indicators (Favorites · Technicals chia nhóm ·
  tìm kiếm; bỏ cột AUTHOR/BOOSTS giả; bỏ tab "On chart" vì Settings đã nằm trên legend); thêm Chart Settings → Status line → "Values".
- **Phase 4 – Port Tier 1 (6–8 ngày, ~4 indicator/ngày).** Mỗi cái: def + test công thức + đối chiếu checklist mục 2 với TV (chụp cạnh nhau).
  Làm theo nhóm: MA family → Bollinger/Keltner/Donchian → Ichimoku/PSAR/Supertrend/Pivots/VWAP → dao động (RSI, MACD, Stoch…) → khối lượng.
- **Phase 4b – Nhóm volume: Session Volume Profile + Visible Range Volume Profile + CVD (6–7 ngày, mục 4b, 4b-2, 4d).** Dùng chung `lowerBars`/`calendar` của Phase 1.
  SVP: tách module `volumeProfile/` từ drawings → output `profiles` + `ProfilePrimitive` → phiên + nạp khung nhỏ → Settings → test (3–4 ngày).
  VRVP: chế độ pinned + nghe vùng nhìn + debounce (1 ngày).
  CVD: def `candles` + tích luỹ theo anchor + legend O/H/L/C + `enabledIf` trong dialog + test (2 ngày). Phân loại up/down của SVP (`close > open`, như TV) và của CVD
  (luật `requestVolumeDelta`) là **hai hàm riêng** có test.
- **Phase 4c – Smart Money Concepts [LuxAlgo] (5–7 ngày, mục 4c).** Cần xong Phase 2c (lớp object) và Phase 3 (dialog có group/inline). Lưu Pine gốc ở `docs/reference/`,
  port state machine theo từng khối (structure → OB → EQH/EQL → FVG → trailing/zones → MTF levels → Color Candles), mỗi khối có test.
- **Phase 5 – Gộp Volume + tiện ích (2–3 ngày).** Đưa Volume vào khung chung (migrate `pane.volume` + key `tv-volume`, giữ MA length/ColorByPrevClose/màu);
  Source tham chiếu plot indicator khác (MA của RSI); **Indicator templates** (nút đang khoá trên Toolbar: lưu/áp bộ indicator + setting);
  Save as default; copy/paste indicator giữa chart.
- **Phase 6 – Tier 2 (4–5 ngày)**, rồi **Tier 3** từng cái theo nhu cầu (hỏi user ưu tiên: Sessions, VPVR, SMC port).

Mỗi phase xong thì commit riêng; Phase 1–2 không đổi UI nên rủi ro với layout đã lưu thấp (có migrate + test).

## 6. Kiểm chứng

- Unit test (vitest) mọi hàm `ta` và mọi def: fixture nến + giá trị chuẩn (TA-Lib/Pine ref, và golden từ TV nếu spike được).
  Chú ý: nến MT5 (broker) ≠ nến TV (OANDA…) nên **không so số tuyệt đối giữa hai nguồn** — so công thức trên *cùng* bộ nến.
- Test migrate: layout cũ `{uid,id,inputs,colors}` → instance mới, vòng lưu/đọc không mất setting.
- Trình duyệt: theo "Manual test recipe" (backend scratch trên bản copy dữ liệu), chụp cạnh TV; kiểm chỉnh setting có xem trước, Cancel khôi phục,
  reload còn nguyên, đổi symbol/khung, thêm nến realtime không nháy, 10+ indicator cùng lúc.
- Hiệu năng: đo thời gian tính 5000 nến × 15 indicator và thời gian cập nhật 1 tick (mục tiêu < vài ms).

## 7. Rủi ro và điểm cần quyết định

1. **DNS Viettel chặn CDN TV** (đã gặp với drawings): study chưa cache sẽ "Loading chunk failed" → Phase 0 có thể chỉ lấy được một phần indicator; phần còn lại dựa vào tài liệu Pine `ta.*` + chụp tay.
2. **Offset/tương lai** (Ichimoku Leading Span +26, `Offset` input): LWC cần timestamp tương lai; ta phải tự sinh theo khung (và nhảy cuối tuần?) — xấp xỉ, không hoàn hảo như TV.
3. **Plot type / nhãn của TV vượt khả năng LWC** (Cross, Circles, Step with diamonds, label chữ trên nến như divergence): cần custom series/primitive; làm sau Tier 1.
4. **Session/anchor của VWAP & Pivot**: TV theo giờ phiên của sàn; app cần quy ước theo giờ server broker/timezone (đã có `timezone` setting) — chọn quy ước ở Phase 4.
4b. **Session Volume Profile**: tải nhiều dữ liệu khung nhỏ (M1 nhiều ngày) và vẽ nhiều histogram mỗi frame → cần cache theo phiên + chỉ tính lại phiên cuối, vẽ bitmap space,
    cắt histogram ngoài vùng nhìn; điểm cắt phiên sai (DST/offset broker) sẽ làm profile sai mà khó nhận ra → có test riêng và đối chiếu với TV ở nhiều khung.
4c. **SMC**: script gốc dựa vào hành vi riêng của Pine (rollback realtime, `max_*_count` xoá cũ nhất, `request.security` lookahead, thứ tự thực thi) — port sai một chi tiết là cấu trúc/OB lệch mà khó thấy;
    lịch sử TV dài hơn nên phần đầu chart lệch là bình thường. License NC-SA: không dùng thương mại.
4d. **CVD**: tick volume ≠ volume thật; anchor theo phiên broker ≠ phiên sàn TV; nến M1 nhiều ngày rất nặng (phân trang + chỉ tính vùng nhìn); luật `open == close` của `requestVolumeDelta` chưa xác minh từ doc chính thức.
5. **Phạm vi lớn**: "đủ như TV" ~100 built-in. Kế hoạch chia tier để có giá trị sớm (Tier 1 sau Phase 4); Tier 2/3 tuỳ nhu cầu.
6. **Bản quyền**: công thức built-in TV là công thức TA phổ thông, tự cài lại OK. Script cộng đồng (LuxAlgo CC BY-NC-SA) chỉ dùng cá nhân, không sao chép nguyên văn.
7. Thay đổi lớn đụng `Chart.tsx` (đang có nhiều sửa chưa commit: trade/calendar) → làm Phase 3 sau khi commit đợt đó để khỏi xung đột.

## 8. Câu hỏi mở (đã chọn mặc định, báo nếu muốn khác)

- Phạm vi đợt này: Tier 1 → Tier 2; Tier 3 hỏi lại sau. *(mặc định)*
- Cho phép Claude tạo/xoá study tạm trong tab TV của bạn để capture ở Phase 0 (sẽ dọn sạch, chờ ~8s trước khi đóng tab như lần drawings)? *(cần bạn đồng ý)*
- Session Volume Profile: phiên mặc định = ngày broker, kèm preset Asia/London/New York/tuỳ chọn (ngoài TV)? Có cần Developing POC/VA ngay không? *(mặc định: có preset, Developing làm sau cùng)*
- SMC: làm đủ ngay (kể cả Highs & Lows MTF + Color Candles) hay bỏ MTF/Color Candles ở bản đầu như clone MT5? *(mặc định: làm đủ, MTF và Color Candles là khối cuối)*
- CVD: chỉ "Time" (khoá "1 tick" vì chỉ có tick volume live, không có lịch sử tick)? *(mặc định: chỉ Time)*
- Gộp Volume vào khung chung ở Phase 5 (đổi nơi lưu, có migrate) — hay giữ riêng? *(mặc định: gộp)*
- Indicator tính trên ≥5000 nến nạp ngầm (chart vẫn hiện 500) — OK? *(mặc định: OK)*
