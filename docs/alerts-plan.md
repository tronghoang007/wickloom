# Alert đa kênh: trình duyệt + Telegram + MT5 mobile

Ngày lập: 2026-10-25. Trạng thái (2026-10-26): **Phase 0 + Phase 1 đã commit (9583380); Phase 2 (alert trên hình vẽ) đã code, test và thử trên UI thật, chưa commit**; Phase 3 chưa làm. Xem mục 11 và 12.

## 1. Hiện trạng

Chưa có alert. Chỉ có các chỗ UI đang tắt (`disabled`, "Alert (sắp có)"):

| Chỗ | File |
|---|---|
| Nút Alert trên toolbar | `web/src/components/chart/Toolbar.tsx` |
| Menu chuột phải chart "Add alert on SYMBOL at price" (⌥ A) | `web/src/components/chart/Chart.tsx` |
| Menu indicator / Volume legend "Add alert on ..." | `indicatorMenu.tsx`, `VolumeLegend.tsx` |
| Menu drawing "Add alert on ..." | `drawingMenu.tsx` |
| Nút chuông trên thanh style của drawing | `StylePanel.tsx` |
| Tab Alerts trong Settings (`soon: true`) | `SettingsDialog.tsx` |

Điểm móc sẵn ở backend:

- `tcp_server._handle_ticks`: mọi tick từ EA đi qua đây.
- `state._on_close`: mọi nến đóng.
- `state.ea_hub.push(...)`: đẩy lệnh xuống EA.
- `economic.py`: mẫu để làm module riêng có bảng SQLite riêng.
- `me.py`: mẫu khoá dữ liệu theo `user_id` của phiên đăng nhập.
- `web/src/store/toast.ts`: toast có sẵn.

## 2. Nguyên tắc

Backend là nơi kiểm tra điều kiện, không phải trình duyệt. Lý do: alert phải nổ khi tắt tab, và Telegram / MT5 push không đi qua trình duyệt.

Hệ quả cần nói rõ với người dùng: mọi kênh đều cần **backend đang chạy**. Kênh MT5 cần thêm **MT5 + EA đang online**.

```
EA ticks ──> tcp_server ──> alerts.engine (so điều kiện)
                                 │ nổ
                                 ▼
                          notify.dispatch ──┬─> ws (user) ──> web: Notification API + toast + âm thanh
                                            ├─> telegram (httpx -> api.telegram.org)
                                            └─> ea_hub.push({"type":"notify"}) ──> EA SendNotification() ──> MT5 mobile
                                 │
                                 └─> bảng alert_log (kết quả giao từng kênh)
```

## 3. Trả lời: có đẩy sang app MT5 mobile không?

**Có**, qua `SendNotification()` của MQL5 trong EA.

- Phải nhập MetaQuotes ID của điện thoại (app mobile: Settings → Messages) vào MT5 desktop: Tools → Options → Notifications, và tick "Enable Push Notifications".
- Tối đa 255 ký tự mỗi tin.
- Tối đa 2 lần gọi mỗi giây và 10 lần mỗi phút. Vượt quá có thể bị khoá hàm (lỗi `ERR_NOTIFICATION_TOO_FREQUENT`). Backend phải xếp hàng và gộp tin.
- EA không biết tin có tới điện thoại hay không (chỉ biết hàm trả true/false).
- Không chạy trong Strategy Tester (không liên quan ở đây).
- Điện thoại nhận theo **terminal**, không theo tài khoản Wickloom: mọi user bật kênh MT5 cùng đẩy về một điện thoại.
- **Chưa kiểm chứng**: MT5 chạy qua Wine trên macOS có đẩy được không. Làm Phase 0 để biết.

Nguồn: [MQL5 book](https://www.mql5.com/en/book/advanced/network/network_push), [MQL5 docs](https://www.mql5.com/en/docs/network/sendnotification), [MetaQuotes ID](https://www.mql5.com/en/articles/476).

## 4. Phase 0: thử kênh MT5 trước

Rẻ nhất, và là kênh có thể hỏng nhất.

- EA 2.18: nhận lệnh `{"type":"notify","text":"..."}` rồi gọi `SendNotification`. Ghi vào log Experts kết quả và `GetLastError()`.
- Thông điệp `account` thêm `push_enabled` (từ `TERMINAL_NOTIFICATIONS_ENABLED`) để web nói đúng lý do khi chưa bật: "Tools → Options → Notifications".
- Nút "Gửi thử" trong Settings → Alerts → MT5 push.
- Người dùng biên dịch lại EA bằng F7 (compile headless qua Wine đang hỏng).
- Nếu Wine không đẩy được: bỏ kênh MT5, Telegram là kênh mobile chính.

## 5. Phase 1: lõi alert + 3 kênh

### 5.1 Dữ liệu (module `backend/app/alerts.py`, bảng riêng trong `meta.sqlite`)

Không đưa vào `TABLES` của `store.py`: CRUD generic của bảng đó mở cho ai cũng ghi (xem ghi chú đầu `economic.py`).

`alerts`:

| Cột | Ý nghĩa |
|---|---|
| id, user_id | chủ sở hữu lấy từ phiên, client không gửi |
| symbol | |
| cond | `cross`, `cross_up`, `cross_down`, `gt`, `lt` |
| level | giá |
| source | `bid` hoặc `last` (theo cách nến của symbol được dựng) |
| trigger | `once`, `once_per_bar`, `once_per_bar_close`, `every_time` |
| expires_at | NULL = không hạn |
| name, message | nội dung tuỳ chọn |
| channels | `{web, telegram, mt5}` |
| state | `active`, `paused`, `triggered`, `expired` |
| last_price | mốc để phát hiện cắt |
| created_at, fired_at | |

`alert_log`: alert_id, user_id, time, price, kết quả từng kênh (`ok` / lỗi + lý do).

`notify_channels`: user_id, kind (`telegram`), config (`chat_id`, ...).

### 5.2 Engine

- Gọi từ `_handle_ticks` sau khi cập nhật aggregator, và từ `_on_close` cho kiểu "mỗi nến đóng".
- Giữ alert đang active trong bộ nhớ theo symbol; chỉ đọc DB khi khởi động và khi có thay đổi.
- Cắt giá: so `last_price` với giá mới. Tick đầu tiên sau khi tạo chỉ làm mốc, **không bắn ngay**. Tick bị đứt rồi nối lại mà giá nhảy qua mức thì vẫn tính là cắt (như TradingView).
- Khởi động lại backend: mốc đặt lại, không bắn nhầm.
- Giới hạn: tối đa 100 alert active mỗi user, `message` tối đa 200 ký tự.

### 5.3 Kênh

**Trình duyệt**
- Cần kiểm tra `/ws` có biết user không (hiện đăng ký theo symbol). Nếu chưa, thêm xác thực phiên vào `/ws` và `hub.send_user(user_id, msg)`.
- Web nhận `alert_fired` → `Notification` API (xin quyền lúc người dùng bật kênh, không xin ngay khi mở app) + toast + âm thanh (chọn trong Settings).
- Chỉ hiện được khi còn một tab Wickloom mở. Không làm Web Push / service worker: Telegram đã lo trường hợp tắt trình duyệt.

**Telegram**
- Người dùng tạo bot qua BotFather. Token chỉ ở biến môi trường `WICKLOOM_TG_BOT_TOKEN`, không bao giờ gửi xuống web, không ghi log.
- Liên kết tài khoản, không cần URL công khai:
  1. Settings → Alerts → "Connect Telegram" → backend tạo mã dùng một lần, hết hạn 10 phút.
  2. Người dùng mở `t.me/<bot>?start=<mã>`.
  3. Backend long-poll `getUpdates`, thấy `/start <mã>` thì lưu `chat_id` cho user đó.
- Gửi bằng `sendMessage` qua `httpx` (đã có trong `requirements.txt`). Thử lại tối đa vài lần, tôn trọng `retry_after` khi gặp 429. Escape HTML trong tên / nội dung do người dùng gõ.
- Có nút "Gửi thử" và "Ngắt kết nối".
- Đã kiểm tra: máy này gọi `api.telegram.org` được (HTTP 302, 0.6s). Nếu ISP chặn sau này, thêm biến cấu hình proxy.

**MT5 mobile**
- `ea_hub.push({"type":"notify","text":...})`, cắt còn 255 ký tự.
- Bộ giới hạn trong backend: 2/giây và tối đa 8/phút (chừa dư so với 10). Tin dồn dập gộp thành một: "N alert: A, B, C...". Quá hạn mức thì ghi `alert_log` là bị bỏ, báo trên web.
- Không có EA online thì ghi log "EA offline", không xếp hàng chờ (tin cũ vô nghĩa).

### 5.4 API

Mọi endpoint cần phiên đăng nhập, khoá theo `user_id` như `me.py`; POST/DELETE qua `OriginGuard`.

- `GET/POST /alerts`, `PATCH/DELETE /alerts/{id}`
- `GET /alerts/log`
- `GET /alerts/channels`, `POST /alerts/channels/telegram/link` (trả link), `DELETE /alerts/channels/telegram`
- `POST /alerts/channels/{kind}/test`

### 5.5 Giao diện

- Dialog "Create Alert" kiểu TradingView: symbol, điều kiện, giá, kiểu nổ, hạn, tên, nội dung, tick kênh.
- Panel danh sách trong thanh phải: tab Active và Log; sửa, tạm dừng, xoá.
- Đường đứt kèm tag chuông trên chart cho alert đang active; kéo để đổi giá (tái dùng cơ chế tag / kéo của `trading/chartOrders.ts`).
- Bật lại các nút đang `disabled` ở mục 1 (menu chuột phải điền sẵn giá tại con trỏ).
- Settings → Alerts: âm thanh, kênh mặc định, kết nối Telegram, trạng thái MT5 push, nút gửi thử.

## 6. Phase 2: alert trên drawing

- Trendline, ray, horizontal ray, kênh, rectangle.
- Alert giữ **bản sao toạ độ** của drawing (không đọc layout lúc đánh giá). Khi kéo / sửa drawing thì cập nhật alert liên kết; xoá drawing thì hỏi có xoá alert không.
- Rủi ro cần xử lý trước: giá của đường tại thời điểm hiện tại phải khớp với cách chart vẽ. Nếu chart vẽ theo chỉ số nến mà alert nội suy theo thời gian thì lệch qua cuối tuần / ngày nghỉ. Đọc code vẽ trong `web/src/drawings` rồi mới chọn công thức.

## 7. Phase 3: bổ sung (theo thứ tự đáng giá)

1. Báo trước N phút cho tin kinh tế mức cao: dữ liệu lịch đã có trong backend (`economic.py`).
2. Báo vị thế chạm SL/TP và lệnh chờ khớp: EA đã gửi `trade` / `deals`, backend so trước / sau.
3. Báo bù lần giá chạm lúc backend tắt: duyệt high/low nến M1 từ lần kiểm cuối, gắn nhãn "(trễ)".
4. **Alert theo indicator** (RSI cắt 70, MA cross): engine indicator hiện chỉ có ở web (TypeScript), nên muốn nổ khi tắt tab phải port sang Python. Làm sau cùng, chỉ port vài indicator hay dùng.

## 8. Kiểm thử

- `backend/tests/test_alerts.py`: cắt giá (lên / xuống / cả hai, tick đầu làm mốc, tick đứt nhảy qua mức), các kiểu nổ, hết hạn, giới hạn số alert.
- Bộ giới hạn MT5: 2/giây, 8/phút, gộp tin.
- Dispatcher với Telegram giả (transport thay được): thành công, 429 có `retry_after`, lỗi mạng, escape HTML.
- Liên kết Telegram: mã hết hạn, dùng hai lần, mã của user khác.
- Quyền: user A không đọc / sửa / xoá alert của user B (404, không lộ tồn tại).
- Web: vitest cho model dialog và hàm giá-theo-con-trỏ.
- Thử thật bằng backend scratch trên bản copy dữ liệu; không đăng ký user thử vào `backend/data`.

## 9. Việc người dùng phải làm tay

1. Tạo bot Telegram qua BotFather, đặt `WICKLOOM_TG_BOT_TOKEN`, khởi động lại backend.
2. Biên dịch lại EA 2.18 bằng F7.
3. Nhập MetaQuotes ID vào MT5 desktop (Tools → Options → Notifications), tick Enable Push Notifications.

## 10. Quyết định đã chọn mặc định (đổi được)

- Đánh giá điều kiện ở backend, không ở trình duyệt.
- Telegram dùng long-polling, không webhook.
- Không làm Web Push / service worker.
- Alert indicator để sau cùng.
- Một bot Telegram cho cả cài đặt Wickloom; mỗi user liên kết `chat_id` riêng.
- Kênh MT5 là chung cho terminal (không theo user).

## 11. Tiến độ (2026-10-26)

**Đã làm (Phase 0 + 1)**

- Backend: `alerts.py` (bảng `alerts` / `alert_log` / `notify_channels`, engine, API `/alerts*`), `notify.py` (Telegram, giới hạn MT5, Dispatcher), `/ws` action `alerts` (xác thực cookie + kiểm Origin) + `Hub.send_user`, `state.wanted_symbols()` để EA stream tick của symbol có alert dù không chart nào mở, hook `bar_close_hooks` cho "đóng nến". 51 test mới (`tests/test_alerts.py`), cả bộ 194 pass.
- EA **2.19** (không phải 2.18 như plan: 2.18 đã dùng cho `deals`): lệnh `notify` -> `SendNotification`, trả `notify_result {id, ok, err}`, `account.push_enabled`. **Đã kiểm chứng trên máy thật (2026-10-26):** F7 EA 2.19, nhập MetaQuotes ID, bấm "Send test" ở Settings → Alerts → MT5 mobile push -> điện thoại nhận đúng tin của Wickloom, log Experts `10:38:35 SendNotification OK (loi 0, 38 ky tu)`. Nghĩa là MT5 chạy qua Wine đẩy push được; rủi ro ở mục 3 đã hết, giữ kênh MT5.
- Web: `lib/alertsApi.ts`, `alerts/{model,store,feed,sound,useAlertLines}.ts`, `AlertHost` (WS riêng + toast + âm báo + Notification + phím ⌥A), `AlertDialog`, `AlertsPanel` (thanh phải: Alerts / Log), đường alert cam kéo được trên chart, Settings → Alerts (âm báo, desktop notification, kênh mặc định, kết nối Telegram, trạng thái + gửi thử MT5). Bật: nút Alert trên toolbar, menu chuột phải chart. 16 test mới; cả bộ 1225 pass, `tsc` + `next build` sạch.
- Kiểm tra end-to-end bằng backend scratch + EA giả + bot Telegram giả + Chrome: tạo từ dialog / menu chuột phải, kéo đường đổi giá (lưu ở backend), nổ -> toast + Telegram + MT5 + nhật ký, re-activate, xoá, gửi thử từng kênh, đường lỗi MT5 hiện đúng lý do.

**Lệch so với plan (có chủ ý)**

- Không có cột `source` (bid/last): engine so với đúng giá chart dựng nến (`bid or last` ở `tcp_server`), nên đường alert luôn khớp nến.
- `last_price` không lưu DB: mốc cắt chỉ ở bộ nhớ (plan cũng nói khởi động lại thì đặt lại).
- Thêm cột `tf`: "Once per bar" / "Once per bar close" cần biết khung nến. "Once per bar close" lần đóng nến đầu tiên chỉ làm mốc (như tick đầu).
- "Every time" nổ lại tối đa mỗi 5 giây (`REFIRE_GAP`) để giá dao động quanh mức không làm ngập Telegram.
- Điều kiện `gt` / `lt` nổ ngay nếu giá đang thoả (khác `cross*` luôn chờ một lần cắt).
- Tin gửi EA giờ dùng UTF-8 thô (`ensure_ascii=False`) vì `JsonStr` của EA không giải mã `\uXXXX`.
- Nhật ký có thêm tin `alert_delivery` (kết quả từng kênh) để web báo ngay khi Telegram / MT5 lỗi.

**Chưa làm**

- Nút chuông ở menu indicator (alert theo indicator, Phase 3) vẫn `disabled`.
- Phase 3 (báo trước tin kinh tế, SL/TP chạm, bù lần chạm lúc backend tắt, alert theo indicator).

## 12. Phase 2: alert trên hình vẽ (2026-10-26)

**Hỗ trợ:** trendline, ray, extended line, info line, horizontal line, horizontal ray, parallel channel, rectangle. Vào từ nút chuông trên thanh style của hình và mục "Add / Edit alert on ..." trong menu chuột phải của hình. Bấm chuông của hình đã có alert thì sửa alert (chuông sáng xanh).

**Công thức giá (rủi ro đã nêu ở mục 6):** chart dựng hình theo chỉ số nến (`timeToLogical`), nên đường thẳng trong không gian (chỉ số nến, giá), hoặc (chỉ số nến, ln giá) khi chart ở thang log. Giá của đường = giá ở chỉ số của nến đang chạy. Nội suy theo thời gian sẽ lệch qua mỗi kỳ nghỉ (đã thử với đường vắt qua cuối tuần: Sat 00:30 -> Mon 05:45).
- `backend/app/geometry.py`: hình học thuần (`geometry`, `hit_band`) + `BarStore.logical` lặp lại `timeToLogical` bằng SQL trên nến của backend (nến đang chạy chưa có trong DB được coi như nến ảo đặt ngay sau nến cuối, như web). Có test đối chiếu với bản port nguyên văn `timeToLogical` trên chuỗi nến ngẫu nhiên có lỗ, và test phá cố ý để chắc test bắt được lỗi.
- `web/src/alerts/drawingSpec.ts` là bản port của `geometry` để dialog cho xem mức hiện tại; backend và web ra cùng 4001,21 trên cùng đường (thử thật).
- Mức chỉ đổi khi sang nến mới nên engine tính lại mỗi nến (vài truy vấn SQL), không phải mỗi tick; tick đầu và lần đóng nến đầu chỉ làm mốc.

**Điều kiện:** đường: cross / cross_up / cross_down / gt / lt (đường dịch qua giá đứng yên cũng là một lần cắt, như trên chart). Kênh và hình chữ nhật (dải [lo, hi]): Entering, Exiting, Crossing (đổi phía, kể cả nhảy qua cả dải), Inside, Outside (hai cái cuối là trạng thái: nổ ngay nếu đang thoả). Đủ 4 kiểu nổ (once / per bar / per bar close / every time).

**Quy tắc cần biết**
- Alert **đánh giá trên khung (TF) và thang giá (thường / log) của chart lúc tạo**, lưu cùng alert; sửa hình ở khung khác không đổi hai thứ này. MN1 chưa hỗ trợ.
- Đoạn thẳng không Extend right: hết hiệu lực (`expired`) khi nến hiện tại qua điểm neo cuối. Đã kết thúc ở quá khứ lúc tạo thì web từ chối và chỉ cách bật Extend right / dùng Ray. Điểm bắt đầu ở tương lai: alert chờ.
- Backend giữ **bản sao toạ độ** (cột `drawing` JSON, không đọc layout). `DrawingDoc.changed` (mọi sửa / kéo / xoá / undo ở mọi chart) -> `alerts/drawingLinks.ts` gửi bản sao mới (PATCH, gộp 600 ms) khi toạ độ hoặc Extend đổi; màu / độ dày không ảnh hưởng. Chỉ doc đã nạp xong, cùng symbol **và cùng layout** mới được coi là "hình đã bị xoá" (alert ở layout khác không bị hỏi nhầm).
- Hình bị xoá: hộp "Delete alert too?" - Delete alert hoặc Keep alert (Huỷ / Esc / X cũng là giữ): giữ thì tháo liên kết (`drawing.id = null`), alert chạy tiếp với toạ độ cuối, panel ghi "drawing deleted".
- Alert trên hình không vẽ đường ngang cam (hình chính là đường); log / thông báo ghi tên hình và mức / dải lúc nổ ("XAUUSDm Exiting Rectangle (3,996.69-4,005.07)").
- EA reconnect và lúc tạo alert: backend xin nạp nến của (symbol, tf) của alert hình vẽ để đếm chỉ số nến đủ; `aggregator.watch` dựng nến TF đó dù không chart nào mở.
- DB cũ (Phase 1) tự thêm cột `drawing` (alerts) và `label` (alert_log) khi khởi động; đã thử trên bản copy DB Phase 1.

**Kiểm tra:** 41 test backend mới (`tests/test_drawing_alerts.py`) + 18 test web (`drawingSpec`, `drawingLinks`); cả bộ backend 235, web 1243, `tsc`, lint, `next build` sạch. Thử UI thật (scratch backend + EA giả): vẽ trendline qua cuối tuần, tạo alert từ chuông, nổ đúng mức, kéo điểm neo -> bản sao đổi, xoá hình -> Keep alert -> alert vẫn nổ; hình chữ nhật Exiting.

**Chưa làm:** bell trên indicator (Phase 3); các loại hình khác (fib, pitchfork, ...); chấm / chuông vẽ ngay trên hình để thấy hình nào có alert (hiện chỉ chuông sáng xanh ở thanh style và dòng trong panel); alert trên hình đang ở khung MN1.
