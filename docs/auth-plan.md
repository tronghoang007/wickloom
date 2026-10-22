# Kế hoạch: tài khoản Wickloom (đăng ký / đăng nhập) tách khỏi account MT5

> Tên app: **Wickloom** (đổi từ "Invest Charts" ngày 2026-10-22). Key localStorage cũ `invest-chart-prefs` giữ nguyên để không mất prefs đã lưu.

Ngày viết: 2026-10-22 (sau commit 8635bdd). CHỈ LÀ PLAN, chưa code gì. Liên quan: `docs/layout-plan.md`
(lưu layout), `docs/multi-account-plan.md` (avatar + account MT5), `docs/trade-plan.md` (trade).

## 0. Trạng thái (cập nhật 2026-10-22)

**U1, U2, U3 đã code** (chưa commit): backend `app/accounts.py`, `auth.py`, `me.py`, `auth_cli.py`; web `store/auth.ts`, `lib/authApi.ts`,
`components/auth/*`, `chart/AccountMenu.tsx`, `drawings/guest.ts`, `drawings/storage.ts`. 44 test backend + 167 test web xanh; đã kiểm tay
trên Chrome (đăng ký nhận dữ liệu cũ, reload giữ phiên, đăng xuất, vẽ khi là khách không PUT, đăng nhập nhận hình khách, cả `localhost` và `127.0.0.1`).
**Chưa làm**: U4 phần web (gate Save/menu layout, đi cùng layout Phase 3), U5 (khối MT5 trong dropdown, trade). Chưa kiểm tay: dialog Account settings,
popup "phiên hết hạn" (chỉ có vitest).

Khác với plan ban đầu:
- **Băm mật khẩu = PBKDF2-HMAC-SHA256 600k vòng, không phải scrypt**: Python 3.9 trong `.venv` build với LibreSSL (macOS) không có `hashlib.scrypt`.
  Định dạng `pbkdf2_sha256$<vòng>$<salt>$<hash>` tự mang số vòng nên tăng sau này không làm hỏng hash cũ. (§5.1 bên dưới vẫn ghi scrypt — đọc theo đây.)
- Thêm `GET /auth/options` → `{allow_register, claim_legacy}` để form đăng ký biết có hiện ô "Nhận dữ liệu hiện có" không.
- Backend `/me/layouts[/{id}]` đã có sẵn từ U3 và CRUD generic của cả `layouts`/`drawings`/`watchlists` đã đóng (kéo phần backend của U4 lên sớm vì
  dùng chung một hàm; web chưa dùng layout nên chưa ảnh hưởng).
- `auth_cli`: thêm `list`, `claim-legacy <email>`; `reset <email>` hỏi mật khẩu bằng getpass.
- 401 từ `/me/*` **không** lật sang khách (sẽ xoá hình chưa lưu): đặt cờ `expired`, mở popup đăng nhập lại (60s sau mới hỏi lại nếu đóng), retry của
  `DrawingSync` tự lưu tiếp sau khi đăng nhập. `/auth/me` 401 = khách, store tự xử lý, không đi qua handler này.
- Hình vẽ khách: `memoryFetch` (Map theo URL). Đăng nhập → `adoptGuestDrawings` chuyển lên server **chỉ ở symbol server chưa có hình** rồi chart mới nạp lại;
  đăng xuất → `flushSave()` rồi mới xoá cookie. `DrawingSync.flush()` giờ trả Promise, thêm `abandon()` (bỏ trạng thái mà không lưu khi đổi nơi lưu).
- Lúc `status = "loading"` (chưa biết khách hay user) DrawingSync nhận lỗi mạng giả để tự thử lại, không ghi nhầm chỗ; `refresh()` thử lại mỗi 4s nếu backend chưa chạy.
- `next.config.ts`: `allowedDevOrigins: ["127.0.0.1"]` — không có thì Next dev chặn HMR từ `127.0.0.1` và trang đứng ở khung xương (có sẵn từ trước, nay lộ ra
  vì cookie phiên buộc phải kiểm cả hai host). Cookie là **theo host**: đăng nhập ở `localhost:3000` không kéo theo `127.0.0.1:3000` (mỗi host đăng nhập một lần).

## 1. Yêu cầu (bạn chốt 2026-10-22)

1. Popup **đăng ký / đăng nhập riêng cho Wickloom**.
2. Chưa login: **watchlist hiện nút Login / Register**; bấm **Save chart** thì bắt login rồi lưu chart **theo account Wickloom**.
3. **Account MT5 chỉ dùng để trade** (và là nguồn giá). Chuyển account MT5 nằm trong **dropdown avatar ở góc trên bên trái**.

## 2. Hai loại account

| | Account Wickloom | Account MT5 |
|---|---|---|
| Là gì | email + mật khẩu, lưu ở backend của app | `<server>:<login>`, EA `TVBridge` trong 1 cửa sổ MT5 |
| Dùng để | sở hữu watchlist, layout, hình vẽ; là "cổng" bắt buộc để trade | nguồn giá/symbols và nơi đặt lệnh |
| Đổi bằng | Sign out / Sign in | dropdown avatar |
| Mật khẩu | backend lưu **hash** | app **không bao giờ** lưu (mật khẩu chỉ nằm trong MT5) |

Hệ quả: dữ liệu người dùng (watchlist, layout, drawings) **thuộc account Wickloom, không thuộc account MT5**. Điều này
**thay** quyết định "layout theo account MT5" (chốt trước đó cùng ngày) ở `layout-plan.md` §3/§4.2.
Đổi account MT5 **không** đổi layout/watchlist; symbol không có trên account MT5 đang chọn thì chart báo sẵn
("không có trên account MT5 hiện tại", đã có trong layout-plan §4.2).

## 3. Hiện trạng (đọc từ code)

- Backend **không có xác thực** nào ngoài `TV_TOKEN` của EA (TCP). CRUD generic `GET/PUT/DELETE /{layouts,drawings,
  watchlists,…}/{id}` (`main.py` `_crud`) ai gọi cũng ghi được, khoá chính chỉ là `id` (không có chủ sở hữu).
  CORS chỉ cho `http://localhost:3000` và `http://127.0.0.1:3000`, **không** bật `allow_credentials`.
- Web: `WatchlistPanel` gọi `getWatchlist()` lúc mount → `watchlists/default`; `DrawingManager` lưu
  `drawings/<symbol>__default` (`manager.ts:73`). Chưa có avatar. Khối "Default / Save" ở `Toolbar.tsx:179` là placeholder.
- `API` là hằng `http://127.0.0.1:8000` (`lib/api.ts`), `fetch` rải ở `api.ts`, `manager.ts`, `Chart.tsx` (WS).
- `DrawingSync` đã nhận được `fetch` tiêm từ ngoài (`this.o.fetch ?? fetch`, dùng cho test) → tận dụng được cho chế độ khách (§6.5).

## 4. Quyết định

**Đã chốt (2026-10-22)**: 3 yêu cầu ở mục 1 + dữ liệu thuộc account Wickloom.

**Đề xuất — cần bạn xác nhận (mặc định ghi sẵn, sửa thì báo)**
1. **Đăng ký bằng email + mật khẩu** (+ tên hiển thị tuỳ chọn). V1 **không xác minh email, không "quên mật khẩu" qua mail**
   (không có SMTP). Quên mật khẩu → lệnh CLI trên máy chạy backend: `python -m app.auth_cli reset <email>`.
2. **Khách vẫn dùng chart đầy đủ** (xem, vẽ, indicator, đổi khung…) nhưng **không lưu gì lên server**: hình vẽ giữ trong
   phiên (đổi symbol/khung không mất, reload thì mất), prefs UI vẫn ở localStorage như hiện nay. Lần vẽ đầu tiên hiện toast
   "Đăng nhập để lưu hình vẽ" (có nút Sign in), không chặn thao tác.
3. **Dữ liệu cũ** (watchlist `default`, drawings `*__default`) giao cho **tài khoản đầu tiên** đăng ký (ô tick mặc định bật,
   chỉ hiện khi chưa có user nào), có sao lưu `meta_pre_auth_<ts>.sqlite` trước khi chuyển.
4. **Phiên bằng cookie HttpOnly** (không để token trong localStorage). Phương án thay: Bearer token trong localStorage —
   khỏi lo cookie/host (mục 9) nhưng token lộ nếu có XSS. Khuyến nghị cookie vì sau này gắn với **trade thật**.
5. **Mở đăng ký mặc định bật** (backend chỉ nghe `127.0.0.1`); có biến `WICKLOOM_ALLOW_REGISTER=0` để tắt khi lỡ đưa ra mạng.
6. **Account MT5 chưa gán cho user**: mọi user đăng nhập trên máy này thấy mọi account MT5 đang có EA kết nối (máy là của bạn).
   Nếu sau này nhiều người dùng thật thì thêm bảng `user_mt5_accounts`; chưa làm.

## 5. Backend

### 5.1 Dữ liệu (trong `meta.sqlite`, 2 bảng có cột thật, không dùng bảng document)
```
users(id TEXT PK /*uuid*/, email TEXT UNIQUE /*lowercase*/, name TEXT, pw_hash TEXT, created_at, last_login_at)
sessions(token_hash TEXT PK /*sha256*/, user_id, created_at, expires_at, last_seen, ua TEXT)
```
- Mật khẩu: `hashlib.scrypt` (stdlib, không thêm thư viện; n=2^14, r=8, p=1, salt 16B, lưu `scrypt$n$r$p$salt$hash`),
  so sánh bằng `hmac.compare_digest`. Tối thiểu 8 ký tự, tối đa 128 (chặn DoS bằng chuỗi dài).
- Session: `secrets.token_urlsafe(32)`; DB chỉ lưu **sha256** của token. Cookie `wickloom_session`: `HttpOnly`,
  `SameSite=Lax`, `Path=/`, `Max-Age` 30 ngày, tự gia hạn (sliding) khi còn < 15 ngày; `Secure` bật bằng `WICKLOOM_COOKIE_SECURE=1`.
- Route xác thực phải là `def` (không `async def`) để scrypt (~50–100 ms) chạy trong threadpool, không chặn event loop
  của tick realtime.

### 5.2 Endpoint
```
POST /auth/register   {email, password, name?, claim_legacy?}  → 201 {user} + Set-Cookie (đăng nhập luôn)
POST /auth/login      {email, password}                          → {user} + Set-Cookie
POST /auth/logout                                                → xoá session + cookie
GET  /auth/me                                                    → {user} | 401   (web gọi lúc khởi động)
PATCH /auth/me        {name}                                     → {user}
POST /auth/password   {old, new}                                 → đổi + thu hồi mọi session khác
```
`user = {id, email, name}`; **không bao giờ** trả hash.

### 5.3 Dữ liệu của user: `/me/*`, thay CRUD generic cho 3 bảng
- `GET/PUT/DELETE /me/watchlist`, `/me/layouts[/{id}]`, `/me/drawings[/{id}]` — chủ sở hữu **lấy từ session**, client không gửi `user_id`.
- Lưu vào đúng 3 bảng cũ: `id = "<user_id>:<id client>"`, `scope = user_id` (PK vẫn là `id` nên hai user cùng
  `XAUUSDm__default` không đè nhau). Route cắt tiền tố khi trả về; `list` lọc theo `scope`; get/put/delete kiểm `scope == user_id`
  (lệch → 404, không lộ là có tồn tại).
- **Đóng CRUD generic** của `layouts`, `drawings`, `watchlists` (trả 410/401) ngay khi web đã chuyển sang `/me/*`; không thì
  vòng qua được xác thực. `settings`, `symbols`, `scripts` giữ nguyên (không phải dữ liệu người dùng).
- Giữ nguyên contract JSON của document để `DrawingSync`/`LayoutSync` (`version`, readonly…) không phải đổi.

### 5.4 An toàn
- **CSRF**: cookie `SameSite=Lax` **không đủ** vì `localhost:xxxx` khác cổng vẫn là cùng "site". Thêm middleware: mọi request
  `POST/PUT/PATCH/DELETE` mang `Origin` không nằm trong allowlist (`:3000` ×2) → 403. PUT/DELETE/JSON-POST vốn đã phải
  preflight CORS, nên chặn Origin là đủ.
- CORS: `allow_credentials=True` (bắt buộc với cookie), vẫn **liệt kê origin cụ thể**, không dùng `*`.
- Giới hạn thử mật khẩu: in-memory theo (IP, email) — 5 lần sai → khoá 60 s, tăng dần; đăng nhập email không tồn tại vẫn chạy
  một lần scrypt giả để thời gian không lộ email có tồn tại hay không. Thông báo sai chung: "Email hoặc mật khẩu không đúng".
- Không log body của `/auth/*`. Email chuẩn hoá `strip().lower()`.
- **WS `/ws`**: dữ liệu giá vẫn công khai (khách xem được chart). Handshake đọc cookie để biết user — chỉ dùng cho sự kiện
  trade về sau (positions/order result); không có cookie thì không nhận.
- **Trade**: mọi endpoint trade `Depends(current_user)` → khách 401. Cách này **thay** "token riêng trong header" ở
  `trade-plan.md` §xác thực (cookie + chặn Origin đã làm đúng việc đó). `orders_log` ghi thêm `user_id`.

### 5.5 Chuyển dữ liệu cũ (chỉ lần đầu)
Khi `users` trống và người đầu tiên đăng ký với `claim_legacy=true`: (1) `VACUUM INTO meta_pre_auth_<ts>.sqlite`;
(2) trong 1 transaction, mọi hàng của `watchlists`/`drawings`/`layouts` chưa có tiền tố user → đổi `id` thành
`<uid>:<id>` và `scope = uid`; (3) ghi `settings/auth_legacy_claimed`. Không xoá gì. Bỏ tick thì dữ liệu cũ nằm yên (route
generic đã đóng nên không ai đọc được), nhận sau bằng `python -m app.auth_cli claim-legacy <email>`.

## 6. Web

### 6.1 Store `store/auth.ts` (zustand, không persist cookie/token)
```
status: "loading" | "guest" | "user"     user: {id,email,name} | null
dialog: null | { mode: "login"|"register", reason?: string }
refresh()            // GET /auth/me lúc khởi động
login/register/logout, updateProfile
openAuth(mode, reason?)
requireLogin(reason): Promise<boolean>   // đã login → true ngay; chưa → mở dialog, resolve true khi xong, false nếu đóng
```
`requireLogin` là điểm chặn duy nhất: Save, Rename/Copy/New/Open layout, Buy/Sell… đều gọi nó thay vì tự kiểm `user`.
`status="loading"` ngắn lúc khởi động: **không** chớp nút Login trước khi biết kết quả (watchlist hiện khung xương).
Gợi ý nhỏ: nhớ `wickloom-auth-hint` trong localStorage để vẽ avatar chữ cái đầu ngay, rồi `/auth/me` xác nhận.

### 6.2 `lib/api.ts`
- Hàm `apiFetch(path, init)` thêm `credentials: "include"` và `Content-Type: application/json` khi có body; 401 từ route `/me/*`
  hoặc `/auth/me` → `auth.set({status:"guest"})` (không tự bật popup; popup chỉ do hành động người dùng hoặc phiên hết hạn lúc đang lưu).
- `API`/`WS_URL` đổi từ hằng thành **suy ra từ host của trang** (`${location.protocol}//${location.hostname}:8000`, env
  `NEXT_PUBLIC_API` vẫn thắng). Lý do ở mục 9 (cookie không đi qua `localhost` ↔ `127.0.0.1`). Chú ý SSR: chỉ đọc `window` ở client.
- `getWatchlist/saveWatchlist` → `/me/watchlist`; `DrawingManager.sync.url` → `/me/drawings/<symbol>__<layoutId>`.

### 6.3 Popup đăng nhập / đăng ký — `components/auth/AuthDialog.tsx`
Modal giữa màn hình, rộng ~400 px, nền `var(--bg)`, viền `var(--border)`, lớp phủ tối; Esc / bấm ngoài để đóng
(không đóng khi đang gửi). Nhãn tiếng Anh như TV, thông báo lỗi tiếng Việt như phần còn lại của app.
```
┌──────────────────────────────────────────┐
│  Wickloom                              ✕ │
│  ┌ Sign in ┐ ┌ Create account ┐          │  ← 2 tab, gạch chân accent ở tab đang mở
│  (i) Đăng nhập để lưu layout             │  ← banner `reason`, chỉ khi có
│                                          │
│  Email                                   │
│  [ you@example.com                    ]  │
│  Password                                │
│  [ ••••••••••                      👁 ]  │
│  (Create account) Display name [ ..   ]  │  ← tuỳ chọn, mặc định phần trước @
│  (Create account, user đầu tiên)         │
│  ☑ Nhận dữ liệu hiện có (watchlist, hình vẽ) │
│                                          │
│  [            Sign in                  ] │  ← nút accent full-width, spinner khi gửi
│  Chưa có tài khoản? Create account       │
│  ──────────────────────────────────────  │
│  Tài khoản Wickloom chỉ để lưu watchlist,  │
│  layout, hình vẽ. Account MT5 không cần  │
│  mật khẩu ở đây.                         │
└──────────────────────────────────────────┘
```
- Tự focus Email; Enter gửi; nút gửi khoá khi email sai dạng / mật khẩu < 8 (Create) hoặc rỗng (Sign in).
- Thuộc tính `autocomplete` đúng (`username`, `current-password` / `new-password`) để trình quản lý mật khẩu điền/gợi ý.
- Lỗi hiện **một dòng đỏ** trên nút gửi (sai mật khẩu, trùng email, bị khoá "Thử lại sau N giây", backend không chạy).
- Thành công → đóng, toast "Đã đăng nhập: <tên>"; đăng ký xong tự đăng nhập. Chuyển tab giữ nguyên email đã gõ.
- Dùng kiểu dáng/overlay giống `SettingsDialog`/`SymbolSearchDialog` (đọc 2 file này khi làm để khớp class, z-index, focus trap).

### 6.4 Avatar + dropdown góc trên trái — `components/chart/AccountMenu.tsx`
Vị trí/kích thước theo `multi-account-plan.md` §4.3: ô 52 px đầu `Toolbar.tsx`, trước ô tìm symbol, vòng tròn ~30 px.
- **Avatar = người dùng Wickloom** (chữ cái đầu, màu băm từ id; khách = icon người xám). **Huy hiệu góc dưới phải 10 px =
  account MT5 đang chọn**: đỏ = Real, xanh lá = Demo, xám = offline/chưa có. (Thay cho ý "viền đỏ/xanh cả avatar" cũ — viền
  nay dành cho người dùng, huy hiệu mới nói về tiền thật.) Tooltip: `Trong Hoang · Trading: Exness-MT5Trial17 #12345678 (Demo)`.
- Bấm avatar → popup:
```
KHÁCH                                   ĐÃ ĐĂNG NHẬP
┌───────────────────────────┐          ┌──────────────────────────────────────┐
│ Guest                     │          │ (T) Trong Hoang                      │
│ Đăng nhập để lưu layout,  │          │     me@example.com                   │
│ watchlist và trade.       │          │ ───────────────────────────────────  │
│ [ Sign in ][ Create acct ]│          │ TRADING ACCOUNTS (MT5)               │
└───────────────────────────┘          │ ● Exness Trial17 #1234  DEMO  $10,000 ✓│
                                       │ ○ Exness Real    #5678  REAL  offline  │
                                       │ + Add MT5 account…                     │
                                       │ ───────────────────────────────────  │
                                       │ Account settings…                      │
                                       │ Sign out                               │
                                       └──────────────────────────────────────┘
```
- Khối **Trading accounts** chính là popup danh sách account của `multi-account-plan.md` §4.3 (tên, server, chấm online,
  nhãn Demo/Real, balance/equity, bấm để chuyển, "Add MT5 account…" = hướng dẫn mở thêm cửa sổ MT5 + gắn EA). Chỉ hiện khi đã
  login (khách không chuyển/không trade). Khách vẫn xem giá từ account MT5 online gần nhất.
- "Account settings…": dialog nhỏ — tên hiển thị, đổi mật khẩu (nhập mật khẩu cũ), email chỉ đọc. Không có xoá tài khoản ở v1.
- Sign out: flush mọi thứ đang chờ lưu (layout/hình vẽ) **trước**, rồi `POST /auth/logout`, đóng ticket trade, xoá dữ liệu
  user trong store, quay về chế độ khách (layout 1 ô dựng từ prefs localStorage).

### 6.5 Chặn theo trạng thái đăng nhập
| Chỗ | Khách | Đã login |
|---|---|---|
| **Watchlist** (`WatchlistPanel.tsx`) | thay thân panel bằng khối giữa: icon + "Đăng nhập để dùng watchlist" + 2 nút **Sign in** / **Create account**; ẩn nút "+"; không gọi `getWatchlist` | như hiện nay, qua `/me/watchlist` |
| **Save chart** (khối `Default / Save`, Ctrl+S, mục menu Save/Rename/Copy/New/Open) | bấm → `requireLogin("Đăng nhập để lưu layout")`; không tự PUT bao giờ | autosave/Ctrl+S qua `/me/layouts` |
| **Hình vẽ** | `DrawingSync` tiêm `memoryFetch` (Map theo symbol trong bộ nhớ) — giữ hình qua đổi symbol/khung, không PUT lên server | PUT `/me/drawings/...` như cũ |
| **Buy/Sell** (trade) | nút hiện, bấm → `requireLogin("Đăng nhập để trade")` | theo trade-plan |
| Chart, indicator, replay, settings, theme | dùng bình thường | như cũ |

**Save → login → lưu (luồng theo ý bạn)**: `requireLogin` mang theo `intent: "save"`. Sau khi đăng nhập thành công:
- user **chưa có layout nào** → lưu ngay chart hiện tại thành layout `default` (kèm hình vẽ trong `memoryFetch` ghi sang `/me/drawings/<symbol>__default`);
- user **đã có layout** → **không ghi đè**: lưu thành layout mới tên "Chart <ngày giờ>" và báo toast kèm nút "Mở layout của tôi".
Còn đăng nhập từ avatar/watchlist (không có intent save) thì mở layout gần nhất của user và bỏ trạng thái khách.

**Phiên hết hạn / 401 giữa chừng** (autosave PUT trả 401): trạng thái lưu thành "Phiên hết hạn", mở popup với reason
"Phiên đăng nhập hết hạn — đăng nhập lại để tiếp tục lưu", **giữ nguyên layout trong bộ nhớ**, đăng nhập lại xong thì flush ngay.
Tuyệt đối không PUT bản mặc định đè lên dữ liệu thật (cùng nguyên tắc `layout-plan` §5.5).

## 7. Ảnh hưởng tới các plan khác (đã sửa cùng lúc với file này)

- `layout-plan.md`: scope layout = **user_id** thay vì account MT5; Phase 3 dùng `/me/layouts` ngay (không còn scope `"default"`
  và bước nhận layout cũ; chỉ drawings là dữ liệu cũ); Save gọi `requireLogin`; Phase A (nối account) bỏ, thay bằng phụ thuộc vào Phase U4.
- `multi-account-plan.md`: avatar = người dùng Wickloom, danh sách account MT5 nằm trong dropdown; watchlist/layout theo user chứ
  không theo account MT5; Phase 2 phụ thuộc Phase U2 (có chỗ để đặt dropdown).
- `trade-plan.md`: xác thực trade = session cookie + chặn Origin, thay token riêng.

## 8. Các phase

| Phase | Việc | Xong khi |
|---|---|---|
| U1 ✅ | Backend: bảng `users`/`sessions`, scrypt, `/auth/*`, middleware Origin, CORS credentials, giới hạn thử mật khẩu, `auth_cli`, test `backend/tests` | pytest: đăng ký/đăng nhập/đăng xuất/`me`, sai mật khẩu, trùng email, email hoa-thường, Origin lạ → 403, cookie đủ cờ, hết hạn/sliding, khoá sau 5 lần sai, đổi mật khẩu thu hồi session khác |
| U2 ✅ | Web: `store/auth.ts`, `apiFetch` + `API` theo host, `AuthDialog`, `AccountMenu` (khách/user, **chưa** có khối MT5), Account settings | Đăng ký → đăng nhập → reload vẫn đăng nhập → Sign out; mở bằng `localhost:3000` **và** `127.0.0.1:3000` đều giữ phiên |
| U3 ✅ | Dữ liệu theo user: `/me/watchlist` + `/me/drawings`, `memoryFetch` cho khách, gate `WatchlistPanel`, chuyển dữ liệu cũ (§5.5), đóng CRUD generic `watchlists`/`drawings` | Khách thấy nút Login/Register ở watchlist; 2 user không thấy dữ liệu nhau; dữ liệu cũ về đúng tài khoản đầu tiên; hình vẽ của khách sống qua đổi symbol nhưng không PUT |
| U4 (backend ✅, web chưa) | Gắn vào **layout Phase 3**: `/me/layouts`, `requireLogin` cho Save + menu layout, luồng "Save → login → lưu", xử lý 401 giữa chừng, đóng CRUD generic `layouts` | Khách bấm Save → popup → sau đăng nhập layout nằm trong tài khoản; user thứ hai không thấy; hết phiên không mất bố cục |
| U5 | Khối **Trading accounts** trong dropdown + huy hiệu Real/Demo (cùng `multi-account` Phase 2); trade `Depends(current_user)`, `requireLogin` ở Buy/Sell | Đổi account MT5 trong dropdown; khách bấm Buy/Sell chỉ ra popup đăng nhập |

U1–U3 độc lập với layout và làm được ngay (không cần đợi tách pane). Làm U1–U3 **trước layout Phase 3** để layout sinh ra
đã gắn user, khỏi migrate.

## 9. Rủi ro / câu hỏi mở

- **Cookie và host**: cookie cấp bởi `127.0.0.1:8000` không đi theo fetch từ trang `localhost:3000` (khác site → `SameSite=Lax`
  chặn). Vì vậy `API` phải theo `location.hostname`. Kiểm bằng tay cả 2 host ở Phase U2. Next dev `rewrites` không proxy WS tốt
  nên không dùng làm cách thay.
- **Xoá nhầm dữ liệu cũ**: chuyển dữ liệu (§5.5) chạm hàng loạt `id`; luôn sao lưu trước, chạy trong 1 transaction, có test.
- **Mất hình của khách khi đăng nhập**: `onLoaded` của `DrawingSync` thay hình bằng bản server. Quy tắc: server có dữ liệu → server thắng
  (khách đã chọn đăng nhập vào tài khoản có sẵn); server trống mà `memoryFetch` có hình → nhận hình của khách và lưu. Cần test.
- **Symbol khác tên giữa broker** (`XAUUSDm` vs `XAUUSD`): layout/hình vẽ khoá theo tên symbol nên mở bằng account MT5 khác tên sẽ báo
  "không có trên account hiện tại". Cùng broker demo/real thường trùng tên nên chấp nhận; map tên chuẩn hoá để sau.
- **Đưa app ra mạng** (không còn chỉ `127.0.0.1`): cần HTTPS + `WICKLOOM_COOKIE_SECURE=1`, tắt đăng ký tự do, xác minh email, rate-limit theo IP
  thật. Plan này chỉ đảm bảo an toàn mức máy cá nhân.
- Lộ việc email đã đăng ký (thông báo "trùng email") — chấp nhận ở v1 vì không có xác minh email.
- Câu hỏi cho bạn: (1) email + mật khẩu ổn hay muốn username? (2) chấp nhận không có "quên mật khẩu" qua mail ở v1? (3) khách mất hình
  vẽ khi reload — ổn không? (4) mọi user thấy mọi account MT5 trên máy — ổn không? (5) cookie HttpOnly (khuyến nghị) hay Bearer?

## 10. Kiểm thử

- backend pytest (`TestClient` giữ cookie): xem cột "Xong khi" của U1; `/me/*` cô lập giữa 2 user (user B đọc/ghi/xoá id của A → 404);
  CRUD generic đã đóng; chuyển dữ liệu cũ (trước/sau, backup tồn tại, chạy lần 2 không làm gì); trade `401` khi chưa login (khi có trade).
- vitest: `requireLogin` (đã login → true không mở dialog; chưa → resolve theo kết quả; đóng dialog → false; gọi chồng nhau dùng chung 1 dialog);
  `memoryFetch` + `DrawingSync` (GET/PUT giả, không gọi mạng); quy tắc server-thắng/khách-thắng khi đăng nhập; `apiFetch` 401 → guest.
- Kiểm tay: đăng ký/đăng nhập/đăng xuất, reload giữ phiên, `localhost` vs `127.0.0.1`, watchlist khách↔user, Save lúc chưa login → popup → lưu đúng,
  hết phiên giữa lúc đang vẽ, tắt backend khi đang đăng nhập (UI báo lỗi, không văng thành khách rồi ghi đè), dropdown MT5 sau U5.
