# Kế hoạch: nhiều account + avatar góc trái trên để chuyển account

Ngày viết: 2026-10-21 (sau commit 46ed76e). CHỈ LÀ PLAN, chưa code gì. Mục đích: chuyển qua lại giữa
nhiều account MT5 như app MT5 mobile, và về sau dùng chính cơ chế này để **trade** từ web.

## 1. Hiện trạng (đọc từ code)

- Dữ liệu đi 1 đường: **EA `TVBridge` trong 1 cửa sổ MT5 → TCP :8001 → backend**. Một cửa sổ MT5 chỉ
  đăng nhập **1 account** tại 1 thời điểm.
- Backend chỉ có **1 nguồn** (`state.py`: `symbols`, `broker_offset`, `aggregator`, `pending_backfill`,
  `ea_hub` đều là biến toàn cục). `tcp_server.handle_ea` từ chối EA thứ 2 khác server
  (`active_ident`), vì 2 server cùng chạy sẽ trộn bar.
- Đổi server (vd Exness Trial17 → server khác) = `resync_after_broker_switch()`: **archive toàn bộ**
  `bars.sqlite` thành `bars_archive_<ts>.sqlite`, xoá symbols, gửi WS `reset`. Cùng server khác login thì giữ cache.
- EA hello hiện chỉ gửi `broker` (ACCOUNT_COMPANY) + `server` (ACCOUNT_SERVER). **Chưa gửi login,
  balance/equity, demo/real.**
- Web: `fetchSymbols`, `fetchBars`, WS `subscribe`, watchlist đều không có khái niệm account.
- Chưa có chức năng trade nào (EA chỉ đọc).

Vì sao mobile chuyển account được: app lưu thông tin đăng nhập từng account rồi tự đăng nhập vào server
broker khi bạn bấm. EA/MQL5 **không có hàm đăng nhập account khác** nên không bắt chước kiểu đó được.

## 2. Các hướng

| | Cách làm | Ưu | Nhược |
|---|---|---|---|
| **A (chọn)** | Mỗi account = 1 cửa sổ MT5 + 1 EA riêng, đã đăng nhập sẵn. Backend nhận nhiều nguồn cùng lúc; web "chuyển account" = đổi nguồn đang xem | Đơn giản, ổn định, chuyển tức thì, không ngắt feed; trade về sau chạy thẳng qua EA (`CTrade`) của đúng account | Tốn RAM, phải mở N cửa sổ MT5; "thêm account" = mở thêm cửa sổ |
| B | 1 cửa sổ MT5, script tự đăng nhập lại (Python `MetaTrader5` hoặc tự động hoá UI) | Chỉ 1 cửa sổ | Python `MetaTrader5` chỉ chính thức cho Windows, chạy qua wine trên Mac chưa chắc được; mỗi lần chuyển ngắt feed, mất tick/nến đang chạy; mong manh |
| C | Dịch vụ cloud (MetaApi...) | Không cần cửa sổ MT5 | Phải đưa mật khẩu account cho bên thứ 3, trả phí → **loại** |

Nguyên tắc: **app không bao giờ lưu mật khẩu account.** Mật khẩu chỉ nằm trong MT5; backend chỉ biết
login + server.

## 3. Phase 0 — thử nghiệm xác minh (làm TRƯỚC khi code)

Hướng A chỉ đi được nếu chạy được 2 cửa sổ MT5 cùng lúc trên máy này. Chưa kiểm tra.
- MT5 chạy bằng wine đi kèm, data ở `~/Library/Application Support/net.metaquotes.wine.metatrader5/`
  (1 prefix). Thử: mở lần 2 cùng app có được không; nếu không thì copy app/tạo prefix thứ 2 hoặc chạy
  chế độ portable.
- Mỗi cửa sổ phải bật "Allow WebRequest/Socket" cho `127.0.0.1:8001` (whitelist theo từng terminal).
- Đo RAM/CPU khi chạy 2–3 cửa sổ.
- **Nếu không chạy được 2 cửa sổ** → quay lại bàn: hướng B hoặc chấp nhận 1 account + hướng dẫn đổi
  account trong MT5 (như hiện nay, avatar chỉ hiển thị account đang dùng).

## 4. Thiết kế (hướng A)

### 4.1 Định danh account
- `account_id = "<server>:<login>"` (vd `Exness-MT5Trial17:12345678`).
- EA v2.10: hello gửi thêm `login` (ACCOUNT_LOGIN), `name` (ACCOUNT_NAME), `currency`, `leverage`,
  `mode` (ACCOUNT_TRADE_MODE: demo / contest / real). Thêm message `account` gửi mỗi ~5s:
  `balance`, `equity`, `margin`, `profit`.
- Input EA mới: `AccountLabel` (tên hiển thị tuỳ ý, mặc định `ACCOUNT_NAME`).

### 4.2 Backend: nhiều nguồn
- Gom state toàn cục thành `Source` theo account: `symbols`, `broker_offset`, `aggregator`,
  `pending_backfill`, writer EA. `ea_hub` thành `sources[account_id]`; `request_backfill`/`request_catchup`
  chỉ đẩy lệnh tới EA của đúng account.
- **Bar cache khoá theo server, không theo login** (giữ luật hiện tại: cùng server khác login = cùng
  dữ liệu): bảng `bars` thêm cột `src` (= server). Symbols khoá theo **account** (loại account khác nhau
  có thể có symbol khác nhau).
- Bỏ luật "từ chối EA khác server" và bỏ "archive + reset khi đổi server" vì không còn đổi nguồn tại chỗ.
  File archive cũ giữ nguyên, không đụng.
- Migration `bars.sqlite`: **sao lưu file trước** (`bars_pre_multi_<ts>.sqlite`), thêm cột `src` cho
  dữ liệu cũ bằng server đã lưu ở `settings/broker`.
- API: `GET /accounts` (danh sách + trạng thái online/offline + balance/equity + lần cuối thấy). Các
  endpoint `/symbols`, `/bars`, `/backfill`, WS `subscribe`/`unsubscribe` nhận thêm `account`
  (thiếu thì dùng account online gần nhất, để bản web cũ không vỡ). Hub publish theo
  `(account, symbol, tf)`.
- Bảng meta mới `accounts` (thêm vào `TABLES` ở `store.py`): nhớ account đã từng thấy, tên/màu tuỳ
  chỉnh, thứ tự. Account offline vẫn hiện trong danh sách.
- Watchlist theo account: `watchlists/<account_id>` (tên symbol khác nhau giữa broker).
  Drawings/layouts giữ nguyên toàn cục (gắn với tên symbol, broker khác tên khác nên tự tách).
  **Quyết định cần bạn xác nhận.**

### 4.3 Web
- Store mới `store/account.ts` (persist): `accountId`, danh sách `accounts` poll 10s như `symbols`.
- `lib/api.ts`: mọi hàm fetch + WS truyền `account`.
- **Avatar góc trái trên cùng** (giống avatar tròn của TV): ô rộng 52px bằng cột `DrawingToolbar`, nằm
  đầu `Toolbar.tsx`, trước ô tìm symbol. Hình tròn ~30px, chữ cái đầu của tên account trên nền màu của
  account. Viền **đỏ = account real, xanh lá = demo** để không nhầm khi trade. Chấm trạng thái online/offline.
- Bấm avatar → popup (kiểu menu account của TV):
  - Đầu popup: account đang dùng (tên, login, server, nhãn Demo/Real, balance/equity).
  - Danh sách account, mỗi dòng: avatar nhỏ, tên, server, chấm online/offline, balance. Bấm để chuyển.
  - Cuối popup: "Add account…" (mở hướng dẫn: mở thêm 1 cửa sổ MT5, đăng nhập, gắn EA TVBridge) và
    "Edit" (đổi tên/màu, ẩn account).
- Khi chuyển account: `set({accountId})` → nếu symbol hiện tại không có ở account mới thì lấy symbol đầu
  tiên hoặc `XAUUSD*` → WS subscribe lại → xoá bar trong bộ nhớ (dùng lại cơ chế `reset` đã có) → thoát
  Replay nếu đang bật → tải watchlist của account.
- Account **offline**: vẫn xem được chart từ cache, hiện thanh "Offline — dữ liệu cũ"; không backfill, không trade.

## 5. Chuẩn bị cho trade (chưa làm ở đợt này)

Thiết kế đợt này chừa sẵn chỗ để thêm trade không phải đập lại:
- Kênh lệnh qua cùng TCP: web → backend → **đúng EA của account đang chọn**:
  `order_send`, `position_close`, `position_modify`, `order_cancel`; EA trả `positions`, `orders`,
  `deals`, `order_result`. EA tự thực thi bằng `CTrade`, dùng magic number riêng của app.
- An toàn (bắt buộc trước khi bật):
  - EA input `TradingEnabled` mặc định **false** (chế độ chỉ đọc). Real account phải bật thủ công ở EA.
  - Ticket đặt lệnh luôn hiện tên account + nhãn Demo/Real + màu account; real thì có bước xác nhận.
  - `client_order_id` chống gửi lặp, giới hạn lot tối đa và lỗ tối đa/ngày theo account, nút kill-switch
    đóng hết lệnh của app, bảng log `orders_log` trong meta.
  - **Xác thực endpoint trade**: backend nghe 127.0.0.1 nhưng CORS không chặn được POST từ trang web
    khác trong trình duyệt của bạn → endpoint trade cần token riêng (header) ngoài `TV_TOKEN` của EA.
  - Không cho trade khi đang Replay; đổi account thì đóng ticket đang mở.
- Plan chi tiết cho trade sẽ viết riêng khi bắt đầu.

## 6. Các phase

| Phase | Việc | Xong khi |
|---|---|---|
| 0 | Thử 2 cửa sổ MT5 chạy song song, whitelist socket, đo tài nguyên | Biết chắc hướng A khả thi hay không |
| 1 | EA v2.10 (login/mode/balance) + backend multi-source + migration + `/accounts` + test trong `backend/tests` | 2 EA 2 account cùng đẩy data, không trộn bar; restart backend không mất cache |
| 2 | Web: store account, avatar + popup, truyền `account` qua api/WS/Chart/Watchlist/SymbolSearch | Chuyển account trên avatar, chart + watchlist đổi đúng |
| 3 | Hoàn thiện: watchlist theo account, xem cache khi offline, màu/tên tuỳ chỉnh, balance/equity | Dùng hằng ngày không vướng |
| 4 | Trade (plan riêng) | — |

## 7. Rủi ro / câu hỏi mở

- **Chạy 2 cửa sổ MT5 trên wine/Mac chưa kiểm chứng** — quyết định cả plan (Phase 0).
- 2 account cùng server nhưng khác loại (Standard/Pro) có symbol khác nhau → symbols theo account là đúng, bar theo server là đúng.
- Broker đóng kết nối khi 1 account đăng nhập ở 2 nơi: cửa sổ MT5 + app mobile cùng lúc có thể đá nhau (tuỳ broker).
- Mỗi cửa sổ MT5 + tick stream của nhiều account làm backend nặng hơn; cần theo dõi CPU (từng có sự cố 94% CPU do tick history, xem `tvbridge-socket-gotchas`).
- Bạn muốn dùng nhiều account để: xem giá nhiều broker, hay giữ vài demo/real để trade? (ảnh hưởng mức ưu tiên Phase 3–4)
