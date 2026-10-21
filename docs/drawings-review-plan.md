# Review drawings (web/src/drawings) & kế hoạch làm lại theo logic TradingView

Ngày review: 2026-10-21 (commit f72bf33). Đọc code + đối chiếu TradingView thật (mục 6). CHƯA sửa gì, chưa có test.

Kết luận: khung hiện tại đúng hướng (anchor `{time, price}`, vẽ qua `ISeriesPrimitive`,
catalog `SPEC` với `build() → Shape[]`) → refactor theo phase, không viết lại từ đầu.

## 1. Lỗi chắc chắn (đọc code)

| # | Chỗ | Lỗi | Hậu quả |
|---|---|---|---|
| 1 | `manager.ts:693-703`, `645` | Load drawings lỗi (backend chưa chạy) → danh sách rỗng; vẽ thêm → PUT ghi đè toàn bộ server | **Mất drawings cũ**. Cũng xảy ra nếu vẽ trước khi GET trả về |
| 2 | `tools.ts:287, 388, 732` | Số nến = `(t2-t1)/step`, không theo chỉ số nến | Đo qua cuối tuần/gap sai (H1 qua weekend ~72 bars thay vì ~24). Date range, Info line, Measure |
| 3 | `tools.ts:307` | Long/short suy từ target > entry | Kéo target của Long xuống dưới entry → thành Short. TV cố định theo loại tool |
| 4 | `manager.ts:449-453` | Kéo cả hình: mỗi điểm qua `fromPx` → magnet hút riêng từng điểm | Bật magnet kéo hình bị méo |
| 5 | `manager.ts:359-362`, `479-483` | Click chọn là `pushUndo` + `commit`/save, dù không kéo | Ctrl+Z phải bấm nhiều lần vô ích, PUT thừa |
| 6 | `tools.ts:96-110`, `114`, `140`, `591` | Fib/channel/Gann tính theo pixel, không theo giá | Sai khi trục giá **log**. Gann square fixed đổi hình khi zoom |
| 7 | `shapes.ts:133-139` | Hit text ước bằng số ký tự × 0.6, vẽ thì `measureText` | Click chữ hay trượt (emoji, tiếng Việt) |
| 8 | `manager.ts:52`, `290` | Chặn pan nhờ `preventDefault` pointerdown; LWC nghe `mouse*`/`touch*` (đã kiểm node_modules) | Chuột chạy được nhưng **cảm ứng: chart vẫn trôi khi vẽ** |

Lỗi nhẹ:
- Nhãn Position chỉ hiện khi hover, không hiện khi đang chọn.
- Clone dịch giá ×0.999 (TV không làm vậy).
- Text nhập bằng `window.prompt`.
- Measure bị đưa vào danh sách drawings và undo.
- Magnet lấy OHLC thật khi chart đang hiển thị Heikin Ashi.

## 2. Kiến trúc

- Mỗi frame và mỗi lần di chuột đều build lại shape mọi drawing (`hitAt`, `manager.ts:258`); VP/VWAP/regression lặp toàn bộ nến → chậm.
- Vẽ ở media space → nét 1px mờ trên Retina (TV vẽ bitmap space).
- Manager sửa thẳng object, store copy nông → UI Settings có thể hiện giá trị cũ.
- Trạng thái tương tác rải rác (`draft`, `placed`, `pressed`, `drag`), chưa thành state machine.
- Dữ liệu lưu chưa có `version`.

## 3. Thiếu so với TradingView

1. Tạo hình bằng nhấn-kéo-thả (ngoài click từng điểm).
2. Shift khóa ngang/45°; Ctrl/Cmd magnet tạm thời; magnet yếu/mạnh.
3. Nhãn giá/thời gian trên trục cho điểm của hình đang chọn.
4. Mini toolbar nổi cạnh hình đang chọn (màu, độ dày, khóa, xóa, cài đặt).
5. Sửa text inline trên chart thay `prompt`.
6. Tùy chọn từng tool: màu nền riêng, extend trái/phải, sửa mức Fib, đảo chiều, vị trí nhãn.
7. Ẩn/hiện theo timeframe.

## 4. Kế hoạch

- **Phase 0 – Test nền (~½ ngày):** thêm vitest; tách hàm thuần (time↔logical, đếm nến, mức Fib/Gann, volume profile, P&L Position) để test. Lỗi #1 test ở đây (không tái hiện trên dữ liệu thật).
- **Phase 1 – Sửa lỗi mục 1 (1–2 ngày):** #1 trước (chỉ lưu sau khi load thành công, thêm `version`), rồi #2–#5, #7.
- **Phase 2 – Kiến trúc (2–3 ngày):** lớp `Coords` (mức theo giá tính qua giá rồi mới ra pixel → sửa #6); state machine `idle → hover → drafting → dragPoint/dragBody`; bật/tắt `handleScroll`/`handleScale` khi vẽ/kéo (sửa #8); cache shape theo (drawing + khung nhìn + số nến); vẽ bitmap space; store immutable.
- **Phase 3 – Hành vi TV (3–4 ngày):** mục 1→5 phần 3, theo thứ tự.
- **Phase 4 – Đối chiếu từng tool:** checklist điểm neo/công thức/mức mặc định/màu/handles so với TV. Chưa chắc: Inside pitchfork, cách tính Value Area. Ưu tiên Position, Fib, FRVP, Rectangle, Trend line, Horizontal ray.

## 5. Test trên trình duyệt (xong #2–#5, xem mục 7)

- App chạy ở `http://localhost:3000`.
- Claude in Chrome: đã bật `/chrome` nhưng tool chưa vào phiên → user reset phiên để thử lại.
- Phương án dự phòng: Playwright (Chromium có sẵn ở `~/Library/Caches/ms-playwright`, chromium-1223), script giả lập chuột.
- Kịch bản: #2 Date range qua cuối tuần H1; #3 kéo target Long xuống dưới entry; #4 magnet + kéo cả hình; #5 click chọn rồi Ctrl+Z; Fib trên trục log; click text; theo dõi PUT `/drawings`.
- Hình test được lưu lên backend → **hỏi user symbol nào để test**, xóa sạch khi xong.

## 6. Đối chiếu trên TradingView thật (2026-10-21, OANDA:XAUUSD)

Đã thử trên tab TradingView của user rồi xóa hết hình test, trả về 15m, tắt magnet.

| # | Thao tác trên TV | TV làm gì | Plan |
|---|---|---|---|
| 2 | Measure H1 từ Fri 16 12:00 → Mon 19 15:00 | **"26 bars, 3d 3h"**: đếm theo chỉ số nến (nếu tính `Δt/step` sẽ ra 75). Cùng ngày: 27h → 26 bars vì nghỉ 1h mỗi ngày | Đúng. Thêm: TV hiện **cả** số nến lẫn khoảng thời gian thật |
| 3 | Long position, kéo target xuống dưới entry | Target **bị kẹp ở entry + 1 tick** (Target 0.001), vẫn là Long, R:R = 0 | Đúng. Sửa cụ thể: kẹp target ≥ entry+tick, stop ≤ entry−tick (Short thì ngược lại) |
| 4 | Trend line, bật magnet, kéo cả hình tới sát nến | Chênh giá 2 đầu giữ nguyên (−7.096 trước và sau kéo), độ rộng theo số nến giữ nguyên | Đúng: dịch mọi điểm cùng một delta, không cho magnet hút từng điểm |
| 5 | Click chọn/bỏ chọn hình vài lần rồi Cmd+Z | Việc chọn hình không vào undo; Cmd+Z hoàn tác thao tác thật gần nhất ("Undo change point") | Đúng. Thêm: mỗi bước undo có tên (tooltip "Undo change point", "toggle maximized pane state") |
| 6 | Fib trên trục log | Chưa thử được: chart không nhận click sau khi chọn Fib bằng Alt+F | Còn bỏ ngỏ. Nhớ là Fib có tùy chọn "Fib levels based on log scale" nhưng **chưa kiểm** |

Thấy thêm khi chọn hình trên TV (khớp mục 3 phần "Thiếu"):
- Nhãn giá/thời gian của các điểm hiện trên trục giá và trục thời gian.
- Có mini toolbar nổi (màu, chữ, độ dày, kiểu nét, cài đặt, alert, khóa, xóa, thêm).
- Nhãn Position (Target / Open PnL / R:R) hiện khi hình đang chọn, không chỉ khi hover → lỗi nhẹ trong mục 1 là đúng.

## 7. Tái hiện trên app (localhost:3000, XAUUSDm H1, 2026-10-21)

Đã xóa sạch sau khi test (backend `XAUUSDm__default` về `items: []` như trước). Bắt PUT bằng cách bọc `window.fetch`.

| # | Thao tác | App | TV |
|---|---|---|---|
| 2 | Measure ~25 nến từ thứ Sáu qua thứ Hai | **"73 bars, 3d 1h"** | 26 bars |
| 3 | Long, kéo target xuống dưới entry | **Đổi thành Short**: vùng lời nằm dưới, "Closed P&L 20.02, R:R 2.12" | Kẹp ở entry+1 tick, vẫn Long |
| 4 | Bật magnet, kéo cả trend line cho 1 đầu rơi sát nến | Đầu 1 bị hút về 4139.504 (giá OHLC), đầu 2 không → chênh giá từ −12.40 thành −13.52, **hình méo** | Giữ nguyên chênh giá |
| 5 | Click bỏ chọn/chọn 2 lần rồi Cmd+Z | **2 PUT thừa**; phải bấm Cmd+Z **3 lần** mới hoàn tác được lần kéo target (2 lần đầu không làm gì) | Chọn hình không vào undo |

Thấy thêm:
- **Measure (ephemeral) vẫn gọi PUT** (gửi `items: []`). Khi kết hợp lỗi #1 (load lỗi), chỉ cần đo một lần là ghi đè rỗng lên server → #1 càng nghiêm trọng.
- Measure sau khi đặt bị chọn như drawing thường (hiện mini toolbar màu/độ dày/khóa/xóa); TV thì Measure biến mất khi click tiếp, không có toolbar.
- Nhãn Position chỉ hiện khi hover (xác nhận lỗi nhẹ). Khi chọn hình chưa có nhãn giá/thời gian trên trục.
- Magnet app chỉ hút khi cách OHLC < 20px (`manager.ts:192`); vì vậy #4 chỉ lộ khi một đầu nằm gần nến.

## 8. Đã làm Phase 0 + Phase 1 (2026-10-21, chưa commit)

Test: `cd web && npm test` (vitest 4 — vitest 5 đòi @types/node ≥22). 40 test trong `src/drawings/*.test.ts`.

| # | Sửa | File |
|---|---|---|
| 1 | `DrawingSync`: chỉ PUT sau khi GET thành công (404 = rỗng, hợp lệ); GET lỗi thì tự thử lại mỗi 5s rồi gộp bản server + hình vẽ trong lúc chờ (xóa undo cũ); bỏ PUT khi nội dung không đổi; lưu `{version: 1, items}`, gặp version mới hơn/dữ liệu hỏng thì chỉ đọc; PUT lỗi thì thử lại; đổi symbol / unmount thì lưu nốt. Item có type app không biết được giữ nguyên khi lưu | `sync.ts`, `manager.ts` |
| 2 | Đếm nến theo chỉ số nến (`barsBetween`) cho Measure, Date range, Date & price range, Info line | `coords.ts`, `tools.ts` |
| 3 | Long/Short theo loại tool; kéo target/stop/entry bị kẹp cách entry ≥ 1 tick (`posConstrain`). Ô nhập giá trong Settings không kẹp (đang gõ dở) | `tools.ts` |
| 4 | Kéo cả hình: mọi điểm dịch cùng số nến + chênh giá (`shiftAnchors`), không qua magnet | `coords.ts`, `manager.ts` |
| 5 | Click chọn không vào undo, không lưu; chỉ khi điểm thật sự đổi mới đẩy ảnh chụp trước khi kéo vào undo | `manager.ts` |
| 7 | Hit-test chữ dùng cùng hộp đo `measureText` như lúc vẽ (`textBox`) | `shapes.ts` |
| nhẹ | Nhãn Position hiện cả khi đang chọn; Measure không vào undo, không gây PUT | `tools.ts`, `manager.ts` |

Phase 0 tách thêm hàm thuần `computeProfile` (VP) và `positionStats` (P&L) để test.

Kiểm trên app (localhost:3000, XAUUSDm, đã dọn sạch; backend giờ là `{version: 1, items: []}`):
- Click chọn/bỏ chọn 4 lần: 0 PUT thừa. Magnet bật, kéo trend line 2 lần: vẫn 38 nến, chênh giá 9.10214. Cmd+Z 1 lần hoàn tác đúng lần kéo cuối.
- Long, kéo target xuống dưới entry: target = entry + 0.001, vẫn Long, R:R 0.00.
- Measure H1 thứ Sáu → thứ Hai: "21 bars, 2d 22h"; 0 PUT.
- Chặn GET `/drawings` (giả backend lỗi), đổi symbol rồi quay lại, vẽ: 0 PUT. Bỏ chặn → sau ~5s tự load lại rồi mới PUT.

Còn lại / thấy thêm:
- #6, #8 → Phase 2 như plan. Clone ×0.999, `window.prompt`, Measure vẫn hiện mini toolbar, magnet lấy OHLC thật khi Heikin Ashi: chưa sửa.
- Settings vẫn cho nhập target Long dưới entry (không kẹp khi gõ); có thể kẹp khi bấm Ok.
- Giá điểm chưa làm tròn theo tick (entry 4128.2025788…); nhãn Target đè lên nhãn P&L khi target sát entry.

## 9. Phase 2 (2026-10-21)

| Mục | Làm gì | Kiểm |
|---|---|---|
| **Lỗi trong commit ae425ee** | `sync.ts` gọi `window.fetch` với `this` = DrawingSync → "Illegal invocation" → load luôn lỗi, thử lại mãi: drawings không load/không lưu (không mất dữ liệu). Lần test trước không lộ vì fetch bị bọc bằng arrow function. Đã sửa + test giả fetch kiểu trình duyệt | Reload: Fib trên server hiện lại; kéo → lưu |
| #6 | Fib retracement, Fib speed fan, Gann box, Gann square, Gann fan: mức tính theo giá rồi mới `Y(price)` | D + log, Fib 3946→4690: mức 0.5 (4318.64) khớp trục giá, khoảng cách mức không đều như phải thế |
| #8 | Nhấn khi cầm tool / bắt đầu kéo hình / eraser → `handleScroll`/`handleScale` = false, nhả (pointerup/pointercancel) thì trả lại. Phải `structuredClone` options cũ vì `merge` của LWC sửa object con tại chỗ | Giả lập pointer+touch: không tool → chart trôi; cầm Trend line → chart đứng, nét nháp theo ngón; bỏ tool → trôi lại |
| State machine | `mode`: `idle` / `drafting` / `dragPoint` / `dragBody` thay cho `draft`, `placed`, `pressed`, `drag` | |
| Cache shape | `WeakMap<Drawing, Built>` theo key khung nhìn (khoảng logical, giá ở 3 điểm trục → bắt cả linear↔log, kích thước pane, số nến + nến cuối, `profileVer`) + hover/chọn. Draft vẫn build mỗi frame | Pan/zoom: hình đi theo chart |
| Bitmap space | Vẽ bằng `useBitmapCoordinateSpace`; nét ngang/dọc, hình chữ nhật thẳng trục bắt vào lưới pixel thiết bị; độ dày làm tròn ra pixel thiết bị | Test `drawShapes` với ctx giả |
| Store bất biến | Drawing không bị sửa tại chỗ nữa (`put` thay object mới) — cần cho cache và để Settings không thấy giá trị cũ | |

Chưa làm: Gann square fixed vẫn tính theo pixel (đổi hình khi zoom) — chưa rõ TV định nghĩa "fixed" theo tỉ lệ giá/nến nào, để Phase 4 đối chiếu. Fib channel, pitchfork, channel vẫn theo pixel (đường thẳng trên màn hình như TV, chưa kiểm trên log). Chưa có tùy chọn "Fib levels based on log scale".

## 10. Phase 3 (2026-10-21)

| Mục | Làm gì | Kiểm trên app |
|---|---|---|
| 1. Nhấn-kéo-thả | Nhấn điểm đầu, kéo, nhả cách > 5px → chỗ nhả là điểm 2 (vẫn click từng điểm được). Chỉ áp cho đoạn đầu; tool 3+ điểm đặt tiếp bằng click | Trend line và Measure tạo bằng 1 lần kéo |
| 2. Phím | Shift khi vẽ / kéo điểm: khóa ngang / dọc / 45° so với điểm trước (ngang giữ đúng giá, dọc đúng thời gian; bỏ qua magnet; không áp cho tool 1 điểm, Position, brush). Ctrl/Cmd: đảo magnet khi giữ. Magnet Weak (< 20px) / Strong (luôn hút), chọn ở mũi tên cạnh nút magnet, lưu trong prefs | Shift: 2 điểm cùng giá 4128.2026. Strong: điểm hút về Low 4141.677; Cmd+click khi Strong bật: không hút |
| 3. Nhãn trục | Hình đang chọn / đang vẽ: nhãn xanh giá + thời gian từng điểm, dải tô giữa min–max trên cả 2 trục. `axes` trong spec: hline chỉ giá; vline, AVWAP, FRVP, AVP chỉ thời gian | Thấy trên trend line, Measure |
| 4. Mini toolbar | Đã có sẵn (StylePanel). Chỉ thêm: ẩn với Measure như TV | Measure không còn toolbar |
| 5. Text inline | Bỏ `window.prompt`: tạo Text/Note/Pin/... mở ô gõ ngay trên chart; Enter xong, Shift+Enter xuống dòng, Esc hủy, click ra ngoài = xong. Double-click hình có text để sửa. Tạo + gõ lần đầu = 1 bước undo; Text mới mà Esc/để trống thì bỏ hẳn | Gõ "Vùng cản 4137 🚀" lưu đúng; double-click đúng vào emoji mở sửa; Cmd+Z 2 lần: về text cũ rồi mất hình; Esc khi vừa tạo: server rỗng |

Còn lại / chưa chắc so với TV: ô sửa text không đi theo khi cuộn/zoom lúc đang gõ; ngưỡng magnet yếu 20px và việc Shift có áp cho rectangle (vẽ hình vuông) hay không chưa đối chiếu TV; tool 3+ điểm có cho nhấn-kéo-thả từng đoạn không cũng chưa kiểm. Mục 6–7 phần 3 (tùy chọn từng tool, ẩn theo timeframe) chưa làm.

## 11. Phase 4 – đợt 1 (2026-10-21)

Đo trên TradingView thật (OANDA:XAUUSD 15m, qua `TradingViewApi`, hình test đã xóa hết). Dữ liệu chi tiết: `docs/tv-drawing-settings-reference.md` mục longpos, fib_retracement, Shift, Gann.

| Tool | Khác TV | Đã sửa |
|---|---|---|
| Position | Kích thước 1-click (app: ±8% khoảng giá, 20 nến theo thời gian) | ±20% High−Low nến đang thấy (tròn tick), rộng 1/7 số nến đang thấy, đếm theo nến |
| Position | Kéo entry chỉ dịch entry (bị kẹp giữa stop/target) | Target/stop dịch theo entry (TV lưu theo tick lệch) |
| Position | Giá không làm tròn | Làm tròn theo tick khi tạo/kéo (Settings đang gõ thì không) |
| Position | Nhãn: Amount = qty×khoảng / rủi ro; P&L theo tiền; Qty làm tròn; số tick; "P&L", "Risk/Reward Ratio: 1.00" | Amount = tài khoản ± rủi ro×R (không dấu phẩy nghìn); PnL theo giá; Qty làm tròn xuống; pip (tick/10 với giá 3/5 số lẻ); "Closed PnL", "Risk/reward ratio: 1"; nền 20% |
| Mọi tool | Giá ≥ 100 bị cắt còn 2 số lẻ | Đủ số lẻ theo tick |
| Fib retracement / extension | Nhãn ở trong, phía trên đường | Ngoài đầu trái, canh giữa dọc |
| Rectangle | 2 handle; Shift khóa góc (rect gần ngang thành dẹt) | 8 handle (4 góc + 4 giữa cạnh); Shift = hình vuông (Ellipse = tròn) |

Khớp sẵn: trend line Shift → ngang; trend line không làm tròn giá; Fib mức 0 ở điểm 2; Qty = rủi ro/(stop×lot).

Chưa làm / còn mở:
- **Gann**: app đặt tên lệch — TV "Gann Square" mới là hình ép vuông theo `scaleRatio` (giá/nến); "Gann Square Fixed" giữ 2 điểm, có levels + 11 fan line + 11 cung, điểm 2 là handle giữa. Cần làm lại cả 2.
- Default Fib gốc của TV chưa đọc được (tài khoản user đã chỉnh: chỉ 0/0.382/0.5/0.618/1, màu cam, nhãn bên phải). App giữ bộ mức + màu gốc (theo hiểu biết, chưa đo).
- Position: chế độ rủi ro theo tiền (`riskDisplayMode money`), leverage, các info block bật/tắt — chưa có trong Settings.
- FRVP: chưa kiểm số liệu (TV không cho xuất dữ liệu nến: "Data export is not supported").
- Horizontal ray, trend line: khác biệt chủ yếu ở Settings (Stats, Price labels, Middle point...) — thuộc mục 6 phần 3.

## 12. Mục 6–7 phần 3: tùy chọn từng tool + ẩn theo khung thời gian (2026-10-21)

**Mục 7 – Visibility** (`visibility.ts`): mỗi drawing có `visibility?` theo đơn vị phút/giờ/ngày/tuần/tháng (bật/tắt + khoảng từ–đến) như tab Visibility của TV (bỏ tick/giây/range vì app không có). Không có = hiện mọi khung (dữ liệu cũ không đổi). Hình ẩn ở khung hiện tại thì không vẽ, không hit, không nhãn trục, không mini toolbar.
- Dialog Settings: tab **Visibility**.
- Mini toolbar → More: **Current interval and above / and below / only / All intervals**.
- Kiểm: Horizontal ray "Current interval only" ở 15m → 1h ẩn, 15m hiện lại, lưu đúng lên server.

**Mục 6 – tùy chọn từng tool** (`spec.options`, lưu trong `d.opts`, hiện ở tab Style; tên theo thuộc tính TV):
| Tool | Tùy chọn |
|---|---|
| Trend line, Ray, Extended, Info line, Arrow (cùng 1 loại như TV, chỉ khác default) | Extend (none/left/right/both theo màn hình), Middle point, Price labels, Always show stats (Info line bật sẵn) |
| Horizontal line / ray | Price label = nhãn giá trên trục **luôn hiện** (bỏ chữ giá vẽ trong chart của hline) |
| Rectangle | Extend, Middle line, Background |
| Fib retracement | Extend lines, Reverse, Levels, Prices, Labels trái/phải, Background, **bảng 24 mức** (bật/tắt, hệ số, màu; mặc định 8 mức 0…1.618 bật, 16 mức mở rộng tắt) |
- Bấm Ok trong Settings lưu luôn làm mặc định cho lần vẽ sau (như TV) — kể cả bộ mức Fib.
- Kiểm: bật 1.272 / tắt 0.786 → vẽ lại đúng; lưu `levels` dạng chuỗi `coeff|màu|1;…` (opts chỉ chứa giá trị đơn).

Chưa có: Stats của TV là chọn nhiều mục (price range, %, pips, bars, date/time, distance, angle) — app gộp thành 1 bật/tắt; tab Text (cỡ chữ, B/I, căn lề); đầu mút mũi tên trái/phải; màu nền riêng của Rectangle; tùy chọn Position (risk theo tiền, leverage, info block); Gann (mục 11).

## 13. Tab Text, Stats nhiều mục, đầu mũi tên, nền Rectangle, rủi ro theo tiền (2026-10-21)

- **Tab Text** (tool có `spec.text`): màu, cỡ (10–40), B, I, textarea, căn lề dọc + ngang. Lưu `d.text` + opts `fontSize, bold, italic, vAlign, hAlign`.
  - Họ trend line (trend line, ray, info line, extended, arrow): chữ **chạy dọc theo đường** (xoay theo góc), mặc định cỡ 14, Top / Center như TV; căn trái/phải theo đầu trái/phải màn hình.
  - Horizontal line: cỡ 12, Top / Center. Horizontal ray: cỡ 12, **Bottom / Center** (theo tài liệu tham chiếu).
  - Rectangle: chữ trong hộp, 3×3 vị trí, mặc định giữa.
  - Chữ xoay: `shapes.ts` vẽ trong hệ tọa độ quay quanh `at`, hit-test quay ngược điểm click.
- **Stats** của họ trend line giờ chọn nhiều mục như TV: Price range, Percent change, Change in pips, Bars range, Date/time range, Angle + Stats position (trái/giữa/phải) + Always show stats. Tắt "Always" thì chỉ hiện khi hover/chọn. Info line bật sẵn mọi mục, canh giữa (TV). Chưa có "Distance" (chưa rõ đơn vị TV dùng).
- **Left end / Right end** (Normal/Arrow) cho cả họ trend line; Arrow = trend line có Right end = Arrow.
- **Rectangle**: màu nền riêng (`backgroundColor`, trống = màu viền); nền và viền tách thành 2 shape.
- **Position**: Risk theo `%` hoặc `$` (như TV `riskDisplayMode`).
- Kiểm trên app: chữ "Trendline hỗ trợ" đậm, chạy dọc đường phía trên; Stats "22.755 / 44 bars" ở đầu phải. Đã trả prefs trình duyệt về như trước test.

## 14. Gann Square / Gann Square Fixed làm lại theo TV (2026-10-21)

Đo lại trên TV (chi tiết trong tài liệu tham chiếu mục Gann), rồi viết lại cả 2 tool trên chung hàm `gannGrid` (lưới 5×5, 6 mức màu, 11 fan line — bật 2×1/1×1/1×2, 11 cung, nền giữa các cung):
- **Gann Square**: hook mới `spec.init` chạy lúc vẽ xong để chốt `opts.scaleRatio` (giá/nến cho hộp vuông trên màn hình), góc điểm 2 tính từ tỉ lệ; handle điểm 2 nằm ở góc thật; nhãn giá / tỉ lệ / số nến màu xám; tùy chọn Labels, Background.
- **Gann Square Fixed**: 1 ô = khoảng cách pixel giữa 2 điểm, lưới về phía điểm 2; tùy chọn Background.
- Kiểm trên app: Gann Square vuông 183×183px, nhãn 20.902 / 0.9087738 / 23; Square Fixed lưới lớn đúng kiểu TV.
- Hình cũ của Gann Square (chưa có `scaleRatio`) dùng tỉ lệ suy từ 2 điểm đã lưu nên vẫn hiện, không đổi dữ liệu.

Còn: Gann Box, Gann Fan chưa đo được (TV không tải được tool); tùy chọn bật/tắt từng fan line / cung chưa có trong Settings.

## 15. Gann Box, Gann Fan, 4 Pitchfork theo TV (2026-10-21)

Lần này TV tải được các tool (đo chi tiết trong tài liệu tham chiếu):
- **Gann Box**: 7 mức (0 … 1) theo cả giá và thời gian, mỗi mức 1 màu, dải ngang + dọc 20%, nhãn 4 cạnh, 4 handle góc, bỏ đường chéo (app cũ: 8 mức, cùng màu, có chéo). Tùy chọn Labels, Background.
- **Gann Fan**: nhãn kiểu TV (1/8 … 8/1 thay "8x1"), màu theo TV, nền giữa các tia, vị trí nhãn như TV. Tùy chọn Labels, Background.
- **Pitchfork / Schiff / Modified Schiff / Inside**: median màu đường (mặc định đỏ #f23645), mức 0.5 + 1 với màu và nền như TV, đoạn nối như TV; **Inside** sửa đúng hình học (app cũ: gốc p0 + 2 đường phụ). Tùy chọn Background.
- Kiểm trên app: Gann Box, Gann Fan, Inside pitchfork trông như ảnh TV.
- Sửa thêm: flyout của toolbar trái cao tối đa tới đáy cửa sổ (trước tràn ra ngoài, không cuộn tới "Gann fan").
- Sửa lỗi nhẹ mục 1: Clone giữ đúng chỗ (bỏ ×0.999); magnet hút về giá Heikin Ashi khi chart đang ở HA.
- Layout TV: phát hiện 1 Gann Square Fixed test còn sót từ lượt trước (đóng tab trước khi TV lưu) — đã xóa, chờ 8s, reload xác nhận 0 hình.

## 16. Kênh + các tool Fib còn lại theo TV (2026-10-21)

| Tool | Sửa |
|---|---|
| Parallel channel | nền 20%, tùy chọn Extend / Middle line / Background |
| Regression trend | dải trên xanh, dải dưới đỏ, đường gốc đỏ nét đứt, số Pearson R; `regression()` tách hàm thuần |
| Flat top/bottom, Disjoint channel | màu mặc định cam / teal, nền 20%; **Disjoint** sửa hình học (đường 2 dốc ngược, handle 3 ở đầu phải) |
| Fib retracement | default 11 mức như TV (bật thêm 2.618, 3.618, 4.236), nền 20% |
| Trend-based fib extension | cùng bộ mức + tùy chọn + bảng sửa mức như Fib retracement |
| Fib channel | đoạn không kéo dài, 11 mức, nền, nhãn "hệ số (giá)" ở đầu trái |
| Fib time zone | mốc 0 xám, còn lại xanh, nhãn ở đáy |
| Trend-based fib time | màu từng mức, tô dải, nhãn ở đáy |
| Fib speed resistance fan | hộp lưới, tia 2 phía (giá + thời gian) tính từ điểm 2, nền, nhãn 4 cạnh |
| Fib circles | **elip** tâm trung điểm, mức 1 nội tiếp hộp 2 điểm (app cũ: đường tròn) |
| Fib speed resistance arcs | **tâm điểm 1** (app cũ: điểm 2), nửa vòng phía điểm 2, nhãn trên đỉnh |
| Fib wedge | mức tới 1, nền, nhãn |
| Fib spiral | màu #00bcd4 |
| Pitchfan | median đỏ + mức 0.5 / 1 với nền (app cũ: 7 tia màu lung tung) |

- Mỗi tool có bộ mức mặc định riêng (`spec.levels`) và dùng chung bảng sửa mức trong Settings.
- Kiểm trên app: Disjoint, Regression, Fib circles, Speed fan trông như TV. Chỉ xóa đúng hình test (chart XAUUSDm có 1 Short position của user — giữ nguyên).
- Còn: Fib extension — vị trí x của các đường mức chưa đo; chưa so: patterns, Elliott, cycles, measurers, shapes, annotation.

## 17. Patterns, Elliott, Cycles theo TV (2026-10-21)

- XABCD / Cypher / ABCD / Three drives: **nhãn tỉ lệ** trên đường chấm (công thức như TV, Cypher khác ở A–C và X–D; Three drives 2 số lẻ), chữ trong ô nền, nền 15%; Three drives bỏ chữ số.
- Head and shoulders: tô 3 vùng, đường cổ chấm cắt cạnh ngoài, nhãn có nền, màu xanh lá (app cũ: tia đỏ, không tô).
- Triangle pattern: đỉnh hội tụ + đường dọc tại A + tô tam giác (app cũ: tô tứ giác + 2 tia).
- Elliott: "(1)…", không nền, bỏ nhãn "0"; màu mặc định theo từng loại sóng.
- Cyclic lines chỉ về bên phải; Time cycles nửa vòng tròn thật + nền 50%; **Sine** sửa công thức (app cũ: chu kỳ 4×Δ, dao động quanh điểm 1).
- Hàm mới: `intersect`, `harmonic`, `headShoulders`, `trianglePattern`, `elliott`.
- Kiểm trên app: XABCD, Head and shoulders, Elliott impulse, Sine như ảnh TV. Đã xóa từng hình test, giữ Short position của user.
- Còn chưa so: measurers (Price/Date range…), shapes (rect đã làm; circle, ellipse, arc, curve…), annotation, Position forecast/Bars pattern/Ghost feed (đang disabled).

## 18. Measurers và Shapes theo TV (2026-10-21)

- Price range / Date range / Date and price range / Measure: nhãn đúng định dạng TV (khoảng giá, %, **pip**, số nến, thời gian, **Vol tổng volume**), hộp nền 15%, mũi tên và cạnh như TV; Date range và Date & price range dùng ô nhãn tối #2E2E2E; Price range nhãn không nền, có tùy chọn bật/tắt từng mục; Measure giữ màu xanh/đỏ theo chiều.
- Arc: **nửa elip** đáy p1–p2 cao tới p3 (app cũ: cung tròn qua 3 điểm), nền 20%.
- Màu mặc định theo TV: Arc hồng, Curve xanh, Double curve tím, Triangle teal, Rotated rectangle xanh lá, Polyline cyan (nền 20%).
- Hàm mới: `volumeIn`, `fmtVol`, `rangeText`, `rangeBox`.
- Kiểm trên app: Measure "13.359 (0.32%) 1,335.9 / 18 bars, 4h 30m / Vol 61.63K".
- Chưa: Double curve (TV tạo qua API ra điểm điều khiển lạ, chưa rõ hình học); màu mặc định Circle / Ellipse chưa đo.

## 19. Annotation theo TV (2026-10-21)

- **Pin**: chỉ vẽ ghim; chữ hiện trong ô tối khi hover / chọn (app cũ: luôn vẽ ô chữ màu xanh).
- **Callout**: ô teal chữ trắng + đuôi nhọn tới điểm 1 (app cũ: đường + chấm + nhãn).
- **Comment**: cỡ 16, bo tròn hẳn (shape text có thêm `radius`).
- **Price note**: thêm tab Text, chữ chạy dọc đường.
- **Signpost**: ô tối viền xám, cột xám xuống điểm neo (app cũ: ô xanh, cột chĩa xuống dưới).
- Màu mặc định: Text cỡ 14, Arrow down #cc2f3c, Arrow marker #1e53e5, Circle cam.
- Kiểm trên app: Callout, Signpost, Pin (cả hover) như TV; xóa từng hình test, giữ Short position của user.
- Chưa đo được: Price label, Flag mark (TV API lỗi "Value is undefined"), Table, Anchored text/note.

## 20. Price label, Flag; kẹp Position khi bấm Ok (2026-10-21)

- Price label: chữ trắng đậm cỡ 14, ô phía trên-phải, góc nhọn chạm điểm (app cũ: ô nằm ngang bên phải, mũi nhỏ).
- Flag: cán xám 18px + cờ 12×8px (app cũ: cán 34px cùng màu, cờ 24px).
- Settings → Ok cho Position: kẹp target/stop về đúng phía entry + làm tròn tick (lúc gõ vẫn không kẹp) — đóng lỗi còn ghi ở mục 8.
- Đã so với TV gần như mọi tool. Còn: Double curve (TV tạo qua API ra điểm điều khiển lạ), Table, Anchored text/note, số liệu FRVP (TV không xuất dữ liệu nến), ô sửa text đi theo khi cuộn, nhãn Target đè nhãn P&L khi target sát entry.
