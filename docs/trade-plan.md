# Kế hoạch: trade từ web (demo + real) giống MT5

Ngày viết: 2026-10-22. CHỈ LÀ PLAN, chưa code. Phụ thuộc `docs/multi-account-plan.md`
(Phase 1–2: account + avatar + EA gửi `login/mode/balance`) và `docs/auth-plan.md` (phải **đăng nhập tài khoản Wickloom** mới
trade được). Trade luôn chạy **trên account MT5 đang chọn** (dropdown avatar) qua EA `TVBridge` của account đó.

## 1. Yêu cầu (bạn chốt 2026-10-22)

1. Có các lệnh như MT5: Buy/Sell market, lệnh chờ Limit/Stop, sửa/xoá lệnh chờ, đóng/đóng một phần vị thế.
2. **Tự chuyển Limit ↔ Stop** theo giá so với thị trường, kể cả khi giá nhảy (cách hiểu ở mục 3 —
   nếu ý bạn khác thì sửa mục này trước khi code).
3. **Kéo SL/TP** trực tiếp trên chart.
4. **Set lot.**

Chưa chốt: giới hạn lot và lỗ-ngày cho account real (mục 8; con số ở đó chỉ là đề xuất).

## 2. Loại lệnh (theo MT5)

| MT5 | Có trong plan |
|---|---|
| Buy / Sell (market) | Có (T2) |
| Buy Limit, Sell Limit, Buy Stop, Sell Stop | Có (T3), **loại do app tự suy ra** từ giá, bạn không chọn tay |
| Buy Stop Limit, Sell Stop Limit | Để sau (T6): cần 2 mức giá, ít dùng |
| Sửa SL/TP của vị thế, sửa giá/SL/TP/hết hạn của lệnh chờ | Có (T3–T4) |
| Đóng vị thế, đóng một phần (volume), xoá lệnh chờ | Có (T2–T3) |
| Trailing stop, break-even, risk-based lot, OCO | T6, tuỳ nhu cầu |

Kèm theo: hết hạn lệnh chờ (GTC / hết ngày / thời điểm cụ thể), deviation (trượt giá tối đa) cho market,
magic number của app để phân biệt lệnh app với lệnh tay/EA khác.

## 3. Tự chuyển Limit/Stop

Người dùng chỉ chọn **hướng (Buy/Sell)** và **giá vào**. Loại lệnh suy ra từ giá thị trường:

| Hướng | Giá vào so với thị trường | Loại |
|---|---|---|
| Buy | thấp hơn Ask | Buy Limit |
| Buy | cao hơn Ask | Buy Stop |
| Sell | cao hơn Bid | Sell Limit |
| Sell | thấp hơn Bid | Sell Stop |

Chỗ "giá nhảy" xử lý ở 3 tình huống:

1. **Ticket / đường giá đang kéo:** nhãn loại lệnh đổi theo từng tick (kéo đường entry qua giá thị
   trường thì "Buy Limit" thành "Buy Stop" ngay trên nhãn). Chuyển loại cũng chạy khi thị trường chạy
   xuyên qua giá vào lúc bạn đang để ticket mở.
2. **Lúc bấm gửi:** web gửi **ý định** (hướng + giá vào), không gửi loại. **EA tự quyết loại tại thời điểm
   thực thi** bằng Ask/Bid mới nhất, nên giá nhảy giữa lúc bấm và lúc tới EA vẫn ra đúng loại.
3. **Loại đổi so với cái bạn nhìn thấy:** web gửi kèm `expected_type`. Nếu EA tính ra loại khác (vd
   thấy "Buy Limit @4120" nhưng giá đã rớt xuống 4118 nên thành Buy Stop = mua breakout thay vì mua
   hồi) thì:
   - **demo:** vẫn đặt, hiện toast "Đã đặt Buy Stop (giá nhảy)";
   - **real:** **không đặt**, ticket hiện lại với loại mới và bạn xác nhận lần nữa.
4. **Kéo lệnh chờ đang có qua giá thị trường:** MT5 không cho đổi loại lệnh chờ, nên khi thả tay app
   **đặt lệnh mới đúng loại trước, rồi mới xoá lệnh cũ** (nếu đặt mới lỗi thì giữ nguyên lệnh cũ và báo).
   Cùng loại thì dùng modify bình thường.

Giá vào quá gần thị trường (trong `SYMBOL_TRADE_STOPS_LEVEL`) MT5 từ chối. App **không âm thầm đổi sang
market**: chặn nút gửi và hiện "Quá gần giá thị trường (tối thiểu N điểm)". Muốn vào market thì bấm Buy/Sell market.

## 4. Giao diện

Móc vào chỗ đã có:
- **Chuột phải chart** (`Chart.tsx`, `menuItems`): các dòng "Buy/Sell 1 @ giá limit/stop" đang disabled
  (đã tự đảo theo giá trên/dưới thị trường) → bật, dùng đúng quy tắc mục 3, số lot lấy từ lot hiện tại.
  "Add order on … at …" mở ticket với giá đó.
- **Widget SELL/BUY** góc trái trên chart như TV: giá Bid/Ask, **ô lot ở giữa** (thay chỗ spread; spread
  hiện nhỏ bên dưới), nút −/+ theo `volume_step`. Bấm = market ngay (real: có xác nhận, mục 8).
- **Ticket đầy đủ** (từ widget hoặc "Add order"): hướng, giá vào (market / giá cụ thể), lot, SL, TP
  (nhập giá hoặc điểm), hết hạn, nhãn loại lệnh tự suy ra, **số liệu xem trước**: margin cần, lỗ nếu
  chạm SL, lời nếu chạm TP (tính bằng đơn vị tiền account), spread. Tên account + nhãn Demo/Real + màu
  account luôn hiện trên ticket.
- **Đường trên chart** (primitive mới `web/src/trading/`, cùng kiểu `ISeriesPrimitive` như drawings,
  tái dùng quy đổi giá↔pixel và xử lý kéo của `drawings/manager.ts`):
  - vị thế: đường entry + nhãn "BUY 0.10 | +12.34 USD", đường **SL đỏ**, **TP xanh**, kéo được;
  - lệnh chờ: đường giá + nhãn loại/lot, kéo được, nút × xoá;
  - đang soạn ticket: entry/SL/TP xem trước, kéo để chỉnh trước khi gửi;
  - vùng cấm (trong stops level) tô mờ, kéo vào đó thì dừng ở mép;
  - giá luôn làm tròn theo `tick_size` của symbol.
- **Panel dưới chart** (kiểu MT5/TV "Paper Trading"): tab Positions | Orders | History | Account, theo
  account đang chọn. Cột: ticket, symbol, loại, lot, giá vào, SL, TP, giá hiện tại, P/L, nút
  đóng / đóng một phần / sửa. Có tổng P/L và nút "Close all" (xác nhận).

## 5. Lot

- Ô lot theo **từng account × symbol**, nhớ lần nhập gần nhất; mặc định riêng cho demo và real
  (real mặc định = `volume_min`, thường là **0.01**; step 0.01 nên lot nhảy 0.01, 0.02, ...).
- Tự làm tròn theo `SYMBOL_VOLUME_STEP`, kẹp trong `volume_min`/`volume_max` của symbol; EA báo 3 giá trị
  này cùng `contract_size`, `stops_level`, `freeze_level`, `digits` cho mỗi symbol.
- Nút −/+ nhảy 1 step; preset nhanh (vd 0.01 / 0.10 / 1.00).
- Ticket hiện margin cần và margin còn lại; không đủ thì chặn gửi.
- Để sau (T6): lot theo % rủi ro dựa trên khoảng cách SL.

## 6. Kiến trúc

### EA (`TVBridge`, v2.1x)
- Dùng `CTrade`; tự chọn filling mode theo symbol (`SYMBOL_FILLING_MODE`), deviation mặc định 20 điểm.
- Input mới: `TradingEnabled` (**mặc định false**), `MagicNumber`, `MaxLotPerOrder`, `DailyLossLimit`,
  `Deviation`.
- Lệnh nhận từ backend: `trade_check`, `order_send` (market/pending, kèm hướng + giá vào), `position_modify`,
  `position_close` (volume tuỳ chọn), `order_modify`, `order_delete`, `close_all`. Mỗi lệnh có `req_id`.
- Trả `trade_result {req_id, retcode, order, deal, price, volume, comment, type_resolved}`.
- **Pre-flight bằng `OrderCheck()`**: trả margin/free margin/lỗi hợp lệ mà không gửi lệnh thật; ticket
  gọi khi bạn đang nhập để hiện số liệu và báo lỗi sớm.
- Đẩy trạng thái: `positions`, `orders`, `deals` (từ `OnTradeTransaction`, gửi ngay khi đổi) và snapshot
  đầy đủ mỗi vài giây để tự sửa lệch. Message `account` thêm `trade_allowed`, `margin_mode`
  (hedging / netting), `margin_level`.
- Thiếu quyền hay chưa bật: báo rõ trong `account` (`trade_allowed`, "Algo Trading" của terminal, đăng nhập
  bằng investor password) để ticket tự khoá kèm lý do thay vì chờ lỗi.

### Backend
- Endpoint trade (đều nhận `account_id` tường minh, **không** dùng "account đang chọn" ngầm):
  `POST /accounts/{id}/orders`, `POST …/orders/check`, `PATCH …/positions/{ticket}`,
  `DELETE …/positions/{ticket}` (kèm `volume`), `PATCH/DELETE …/orders/{ticket}`, `POST …/close-all`;
  đọc: `GET …/positions|orders|history`.
- Gửi lệnh = đẩy xuống đúng EA + **đợi `trade_result` theo `req_id`** (timeout ~10s). Account offline thì từ
  chối ngay, không xếp hàng.
- **Xác thực**: mọi endpoint trade (đọc lẫn ghi) yêu cầu **phiên đăng nhập Wickloom** (`Depends(current_user)`, cookie HttpOnly) và
  middleware chặn `Origin` lạ trên POST/PUT/PATCH/DELETE (khác `TV_TOKEN` của EA). CORS không chặn được POST từ trang web
  khác vào `127.0.0.1`, nên không có phiên + Origin hợp lệ thì không trade. Khách bấm Buy/Sell chỉ ra popup đăng nhập
  (`requireLogin`). Chi tiết: `docs/auth-plan.md` §5.4. `orders_log` ghi thêm `user_id`.
- **Chống gửi lặp**: `client_id` gắn vào comment lệnh (MT5 giới hạn 31 ký tự) cùng magic; timeout/mất kết
  nối thì **hỏi lại trạng thái trước khi thử lại**, không tự gửi lại lệnh trên real.
- Bảng `orders_log` (meta): mọi yêu cầu + kết quả + account MT5 + user Wickloom + thời điểm, để truy vết.
- Đẩy `positions/orders/account` tới web qua WS theo account.

### Web
- `web/src/trading/`: store (positions/orders/account theo account), primitive đường trên chart, ticket, panel,
  hàm thuần dễ test: `resolveOrderType(side, price, bid, ask)`, `normalizeLot(...)`, `checkStopsLevel(...)`.
- Thông báo lỗi dịch retcode sang tiếng Việt. Một số hay gặp: 10027 "AutoTrading đang tắt trên
  terminal" (bấm nút Algo Trading của MT5 + tick "Allow Algo Trading" trong EA), 10016 "SL/TP không hợp
  lệ (quá gần giá)", 10014 "Lot không hợp lệ", 10019 "Không đủ margin", 10018 "Thị trường đóng cửa",
  10004/10020 "Giá đã đổi".
- Hedging vs netting: netting thì một symbol chỉ có một vị thế (mua thêm cộng dồn, bán ngược thì giảm/đảo);
  UI hiện cảnh báo trên ticket và đóng theo symbol thay vì theo ticket.

## 7. Các phase

| Phase | Việc | Xong khi |
|---|---|---|
| T1 | Chỉ đọc: EA gửi positions/orders/deals/account; panel + đường vị thế/lệnh chờ (chưa kéo, chưa gửi lệnh) | Thấy đúng lệnh của account trên chart/panel, kể cả lệnh đặt tay trên MT5; **không có rủi ro** |
| T2 | Market trên **demo**: widget SELL/BUY + lot, ticket, đóng, đóng một phần, `OrderCheck`, retcode, chống gửi lặp, token | Đặt/đóng lệnh demo nhỏ, kết quả khớp MT5 |
| T3 | Lệnh chờ + tự Limit/Stop (mục 3), chuột phải + "Add order", kéo entry lệnh chờ, xoá/sửa | Kéo đường qua giá thì nhãn đổi, đặt đúng loại trên demo |
| T4 | Kéo SL/TP (vị thế, lệnh chờ, ticket xem trước), vùng cấm stops level, toast hoàn tác | Kéo SL/TP khớp với MT5 mobile/desktop |
| T5 | **Mở cho real**: xác nhận, giới hạn lot/lỗ-ngày, kill-switch, `orders_log`, xác nhận lại khi loại lệnh đổi | Qua checklist mục 9 |
| T6 | Tuỳ chọn: Stop Limit, trailing, break-even, lot theo % rủi ro, đổi tool Long/Short position đã vẽ thành lệnh thật | — |

T1 làm được ngay sau Phase 2 của multi-account vì chỉ đọc. T2–T4 chỉ chạy với account `mode = demo` cho tới T5.

### Trạng thái (cập nhật 2026-10-22)

- **T1 xong** (commit `1e5eed5`, đã thử trên MT5 thật với EA 2.11).
- **T2 xong phần code (commit `d6a2309`); EA 2.12 chưa chạy trên MT5 thật.** Có: widget SELL | lot | BUY dưới tiêu đề chart (giá Bid/Ask từ tick, −/+ theo
  step, lot nhớ theo account × symbol, mờ + tooltip nói lý do khi chưa gửi được), đóng / đóng một phần trong tab Positions (bấm Close, sửa lot, OK),
  `POST /accounts/{id}/orders` + `DELETE /accounts/{id}/positions/{ticket}?volume=` (chỉ demo, backend đợi `trade_result` theo `req_id`, 10s, không tự gửi
  lại, `client_id` chống gửi lặp, một lệnh một lúc mỗi account, 20 lệnh/phút, bảng `orders_log`), EA: `TradingEnabled=false` mặc định + `AllowRealAccount`
  + `MaxLotPerOrder` + `OrderCheck` trước `OrderSend`, `symbols` báo thêm volume_min/max/step.
- Khác plan ban đầu: đóng vị thế dùng `DELETE …?volume=` (query thay vì body); chưa có endpoint `orders/check` riêng (OrderCheck chạy ngay trong EA,
  endpoint riêng làm cùng ticket ở T3); chưa có hộp xác nhận cho demo (bấm là gửi, như TV mặc định); kết quả của sàn trả HTTP 200 với `ok=false` + `message`.
- **T3 xong phần code (commit `2ad37ac`); EA 2.13 chưa chạy trên MT5 thật.** Có: lệnh chờ với loại Limit/Stop tự suy ra (`web/src/trading/orderType.ts`; web gửi hướng + giá,
  EA quyết loại theo Ask/Bid lúc thực thi, account không phải demo mà loại đổi so với `expected_type` thì EA từ chối `type_changed`), menu chuột phải
  (Buy/Sell limit-stop tại giá bấm + "Add order" mở ticket có SL/TP/hết hạn, nhãn loại đổi theo từng tick), kéo đường lệnh chờ trên chart (cùng loại → sửa giá; qua giá
  thị trường → đặt lệnh mới đúng loại TRƯỚC rồi mới xoá cũ; vùng cấm stops level bị chặn ở web và EA), Cancel ở tab Orders, `POST /accounts/{id}/orders` có `price`,
  `PATCH` / `DELETE /accounts/{id}/orders/{ticket}`; backend chặn sớm nếu EA < 2.13. EA 2.13 cũng gửi time/time_setup/expiration theo UTC (trước đó là giờ server).
  Chưa có: nút × xoá ngay trên chart (xoá ở tab Orders), Stop Limit, margin/lời lỗ xem trước trong ticket, kéo SL/TP (T4).
- **Bảng đặt lệnh (đã gộp vào commit `a16648c`):** bấm SELL / BUY không còn đặt market ngay như T2 mà mở bảng nổi (`OrderTicket`, không chặn chart): chọn Buy/Sell, Market hoặc Limit/Stop, lot,
  SL/TP (nút "+" tạo đường), hết hạn cho lệnh chờ. Entry/SL/TP của bản nháp vẽ trên chart thành đường kéo được (`trading/lineDrag.ts` kéo mọi loại đường; `trading/draft.ts` giữ bản nháp), kéo
  thì ô nhập đổi theo và ngược lại, nhãn Limit/Stop đổi theo giá. Tab Account có dòng "Profit" (ACCOUNT_PROFIT). Chưa có: kéo SL/TP của vị thế / lệnh chờ đã đặt (T4), tuỳ chọn "đặt nhanh không hỏi lại".
- **Bảng đặt lệnh ở thanh bên phải + T4 (commit `a16648c`):** panel "Order" nằm trong thanh bên phải như TV (mở khi bấm SELL/BUY hoặc "Add order", icon ở thanh chỉ hiện khi đang soạn): hai ô SELL/BUY giá lớn + spread,
  Market / Limit-Stop, lot, Take profit và Stop loss mỗi dòng có ba ô **Giá | Điểm | Lãi (Lỗ) theo tiền account** liên thông (sửa ô nào hai ô kia tính lại), Risk/Reward và rủi ro % equity.
  Lãi/lỗ tính từ `tick_value` của MT5 (EA 2.14 báo trong `symbols`), chưa có thì không hiện số thay vì hiện sai (`web/src/trading/pnl.ts`). Nhãn đường SL/TP trên chart (bản nháp, vị thế, lệnh chờ) kèm lãi/lỗ
  ("TP +20.00 USD"). Kéo thả SL/TP của vị thế đang mở (EA 2.14 `position_modify`, `PATCH /accounts/{id}/positions/{ticket}`) và của lệnh chờ (`PATCH …/orders/{ticket}`): nhãn đổi theo số lãi/lỗ lúc kéo, kiểm tra
  phía + stops level trước khi gửi, toast có nút "Hoàn tác". Tab Account có dòng Profit. Chưa có: thêm SL/TP cho vị thế chưa có bằng cách kéo (hiện chỉ kéo đường đã có), tuỳ chọn "đặt nhanh không hỏi lại".
- **Giao diện giống TradingView (2026-10-22, chưa commit):** đã xem trực tiếp TV Paper Trading (docs/tv-chart-trading-reference.md) rồi làm lại: thẻ trên chart (`TradeOverlay.tsx`) `[TP][SL][lot | loại / lãi-lỗ | ×][Buy|Sell]` với nút TP/SL
  mờ **kéo ra giá cần đặt** (bản nháp, vị thế, lệnh chờ; bấm không kéo thì nhận mức gợi ý 0.25%), nút Buy/Sell của bản nháp đặt thẳng từ chart (bên PHẢI cụm thẻ cho khỏi bấm nhầm TP/SL), × huỷ lệnh chờ / bỏ SL-TP (có "Hoàn tác") /
  đóng vị thế (hỏi lại bằng toast), đường nối dọc giữa giá vào và SL/TP, đường nháp nét đứt / lệnh đã đặt nét liền / SL-TP chấm chấm, màu Buy xanh dương, Sell đỏ, SL cam, TP xanh lá. Bản nháp Market có đường giá khớp: kéo nó đi chỗ khác thì
  thành lệnh chờ, Limit / Stop vẫn **tự suy ra** (cả bản nháp lẫn lệnh đã đặt). Panel Order làm lại theo TV: ô Sell | Buy (ô chọn tô màu) với chip spread (pip) ở giữa, tab Market | Limit / Stop gạch chân, công tắc cho TP / SL,
  nút đặt lệnh hai dòng dính đáy (không bị đẩy ra khỏi màn hình). Widget SELL | spread | BUY trên chart bỏ ô lot (lot chỉ ở panel, nhớ theo account × symbol). Cursor `pointer` cho mọi nút / tab (quy tắc chung `globals.css`).
  Tab Account có thêm Profit đã đóng / Deposit / Swap / Commission tính từ deal (như màn History của MT5; "Profit" cũ đổi tên "Profit đang mở").
- **Xác nhận kiểu TV + One-click trading (2026-10-22, đã xem TV thật, docs/tv-chart-trading-reference.md):** Settings > Trading > **One-click trading** (`oneClick`, mặc định TẮT; bật = làm ngay không hỏi). Khi tắt: (1) kéo SL/TP / giá lệnh chờ của lệnh đã đặt
  (kể cả kéo nút TP/SL mờ ra giá) thì đường dừng ở giá mới, thẻ lệnh chủ hiện **Discard / Confirm** (thẻ đang sửa mờ đi), Confirm mới gửi, Discard / Esc / kéo đường khác thì trả về (`pending` trong `chartOrders.ts`, `DragPreview.pending`);
  (2) × hộp thoại: đóng vị thế ("Đóng vị thế": account, lệnh, giá vào / hiện tại, lãi/lỗi), huỷ lệnh chờ ("Giữ lệnh / Huỷ lệnh"), bỏ SL / TP ("Giữ lại / Bỏ SL") (`store/confirm.ts`, `ConfirmHost`, `trading/tagActions.ts`). Đặt lệnh từ nút Buy/Sell
  và kéo trên bản nháp thì không hỏi (giống TV). Nút Close ở tab Positions cũng qua hộp thoại đóng vị thế.
- Để bật: gắn EA 2.14 với `TradingEnabled = true` (và "Allow Algo Trading") trên account **demo**; real vẫn bị chặn ở cả web, backend và EA.

## 8. An toàn cho real

- `TradingEnabled = false` mặc định; real phải bật tay **ở EA**, web không bật hộ được.
- Mọi lệnh real hiện hộp xác nhận: tên account + login + hướng + loại + lot + giá + SL/TP + rủi ro ước tính.
  Bấm "market" cũng xác nhận (có tuỳ chọn tắt xác nhận **chỉ cho demo**).
- Kéo SL/TP áp dụng khi thả tay (cả demo và real) kèm toast "Hoàn tác" ~5s; kéo ra khỏi vùng cho phép thì
  dừng ở mép.
- Giới hạn cấu hình theo account ở EA: `MaxLotPerOrder`, `DailyLossLimit` (EA tự từ chối khi vượt, kể cả
  nếu web có lỗi). **Đề xuất cho real: lot tối đa 0.10/lệnh, lỗ tối đa 2% balance/ngày — bạn chốt số.**
- Nút kill-switch: đóng hết vị thế + xoá hết lệnh chờ **của app** (magic của app) trên account đang chọn;
  một tuỳ chọn khác cho "mọi lệnh của account".
- Không trade khi đang Replay; đổi account thì đóng ticket đang mở; lệnh luôn đi theo `account_id` trên ticket.
- Không có gửi một lệnh cho nhiều account.
- Không lưu mật khẩu; backend chỉ nghe `127.0.0.1`.

## 9. Kiểm thử và checklist bật real

- Test thuần (vitest): `resolveOrderType` đủ 4 hướng + sát giá + đúng bằng giá; `normalizeLot` theo step/min/max;
  `checkStopsLevel`; quy đổi giá↔điểm; quy tắc `expected_type` lệch.
- Test backend (`backend/tests`): giả lập EA qua socket, kiểm tra ghép `req_id`, timeout, account offline,
  từ chối khi thiếu token, không gửi lặp khi thử lại.
- Test tay trên demo: mỗi loại lệnh, kéo SL/TP, giá nhảy qua entry, mất kết nối giữa chừng, đóng một phần,
  đối chiếu với MT5 desktop và mobile.
- Checklist trước khi bật real: đã chạy demo đủ các ca trên ít nhất vài phiên; `OrderCheck` trùng thực tế;
  giới hạn lot/lỗ-ngày đã test bằng cách cố tình vượt; kill-switch đã thử; lần đầu trên real chỉ dùng
  lot nhỏ nhất (0.01).

## 10. Rủi ro / câu hỏi mở

- Loại lệnh tự chuyển lúc giá nhảy là điểm dễ nguy hiểm nhất (mua hồi thành mua breakout) → mục 3.3 bắt
  xác nhận lại trên real. Bạn có muốn demo cũng hỏi lại không?
- Hiển thị/sửa cả lệnh **không phải của app** (lệnh tay, EA khác) mặc định là có, vì bạn quản lý chung với
  MT5 mobile; kill-switch mặc định chỉ đụng lệnh của app.
- Một số broker không cho sửa SL/TP trong vùng freeze level hoặc đóng cửa; hiện lỗi gốc của broker kèm giải thích.
- Con số `MaxLotPerOrder`, `DailyLossLimit` cho real.
- Cùng account mở ở MT5 mobile/desktop khác: lệnh đặt từ đó cũng hiện sang web qua snapshot, cần thử độ trễ.
