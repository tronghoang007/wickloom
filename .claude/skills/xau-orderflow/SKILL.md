---
name: xau-orderflow
description: Phân tích orderflow intraday cho vàng (XAUUSDm) từ dữ liệu tick của backend Wickloom (volume profile, CVD, hấp thụ, tin USD) rồi đặt alert các vùng quan trọng qua web + Telegram + MT5 push (hết hạn 22:00 giờ VN) và vẽ các vùng phản ứng (reaction) lên chart. Dùng khi user gõ /xau-orderflow hoặc nhờ "phân tích orderflow vàng", "đặt alert vùng", "soi vàng hôm nay", "vẽ vùng cho tôi trade", "vẽ vùng reaction".
---

# Orderflow vàng + đặt alert

**Người dùng:** chỉ trade vàng (XAUUSDm), theo **intraday**, **hết giờ trade 22:00 giờ VN (= 15:00 UTC)**. Khi alert nổ, user tự nhìn footprint / CVD rồi tự vào lệnh. Việc của skill là chọn vùng, đặt alert và vẽ vùng lên chart (bước 4b), không đặt lệnh hộ.
Không cần hỏi lại user về symbol, giờ trade, kênh thông báo; chỉ hỏi khi dữ liệu có vấn đề (xem bước 1).

## Bước 1 — Lấy dữ liệu (chỉ đọc, không cần đăng nhập)

Chạy từ thư mục gốc repo (`/Users/tronghoang/Workplace/wickloom`):

```
python3 -I .claude/skills/xau-orderflow/scripts/analyze.py            # mặc định: XAUUSDm, 4 phiên, ±90 điểm
python3 -I .claude/skills/xau-orderflow/scripts/analyze.py --sessions 6 --range 120   # nếu cần rộng hơn
```

Script in: phiên (tách theo khoảng nghỉ M1 ≥45 phút), đáy/đỉnh lịch sử, POC/VAH/VAL/HVN/LVN từng phiên + composite, CVD phiên hiện tại từng 15 phút + so sánh CVD tại đỉnh/đáy giá, các cửa sổ 5 phút tick lớn ở đáy/đỉnh cục bộ (hấp thụ), ô tick lớn, **danh sách mức ứng viên có điểm trùng (★ ≥3)**, tin USD trong cửa sổ trade, và dòng `expires_at=...` (22:00 VN) dùng cho alert. Giờ in ra là UTC; **báo cáo cho user bằng giờ VN (UTC+7)**.

Xử lý khi dữ liệu có vấn đề, KHÔNG tự đặt alert theo giá cũ:
- Backend không trả lời → báo user bật backend (`dev.sh`), dừng.
- Dòng `!! M1 cuối trễ ...` (thị trường đóng, cuối tuần, EA tắt) → nói rõ, hỏi user có muốn vẫn đặt alert cho phiên mở cửa tới không.
- `độ phủ TD` < 90% → CVD chỉ tương đối, nói rõ.
- Phiên cũ hơn tick history (TD chỉ có từ 2026-10-09 cho vàng) có profile rỗng — bình thường.

## Bước 2 — Đọc theo phương pháp orderflow

1. **Bối cảnh:** xu hướng (chuỗi phiên, đáy/đỉnh), giá nằm trên / trong / dưới value area hôm nay và phiên trước. Trên VA + CVD cao nhất phiên = chấp nhận lên; trong VA = cân bằng; dưới VA = chấp nhận xuống.
2. **CVD vs giá:** đỉnh giá mới mà CVD thấp hơn đỉnh CVD = phân kỳ giảm; đáy giá mới mà CVD cao hơn = phân kỳ tăng. Dòng "Đỉnh/Đáy phiên … CVD khi đó" trong output cho đúng so sánh này.
3. **Hấp thụ:** cửa sổ 5 phút tick ≥2× trung vị nằm ở đáy/đỉnh cục bộ, delta ≈ 0 và giá bị đẩy ngược ≥ ~10 điểm trong 15 phút sau = bên chủ động bị hấp thụ → vùng đó là cầu / cung thật.
4. **Node:** HVN / POC = nơi giá được chấp nhận (nam châm, kháng cự / hỗ trợ). **LVN là vùng giá chạy nhanh, không phải hỗ trợ**, chỉ dùng làm mốc "gốc breakout" để tìm pullback về HVN / VAH ngay bên dưới (hoặc VAL ngay bên trên khi breakout xuống).
5. **Gốc cú xả / cú bơm:** cụm tick lớn và đỉnh / đáy ngay trước một cú chạy mạnh là nơi bên kia nằm chờ.
6. **Đáy / đỉnh cực trị của lịch sử dữ liệu:** bên ngoài không còn profile (vùng trống). Đặt mốc ngay ngoài mức đó: thủng / quét rồi lấy lại (bẫy) đều cần nhìn orderflow.

## Bước 3 — Chọn vùng

- 6–8 alert, ưu tiên ★ (điểm ≥3), thêm vùng điểm thấp hơn nếu có lý do orderflow rõ (hấp thụ, gốc breakout). Hai alert cách nhau <5 điểm chỉ khi ý nghĩa khác nhau (vùng vào vs quét đỉnh).
- Intraday: phần lớn trong ±50 điểm quanh giá (biên phiên vàng ~40–120 điểm); 1–2 mức xa hơn nếu mạnh.
- Vùng **trên** giá → `cross_up` ở mép gần của vùng. Vùng **dưới** giá → `cross_down` ở mép gần. Mức đặt = mép đầu tiên giá sẽ chạm, không phải giữa vùng.
- Tin USD mức ≥2 nằm trong cửa sổ trade: ghi giờ VN trong báo cáo, nói vùng quanh giờ tin kém tin cậy. Không tự tạo alert cho tin (app đã có rule tin ở Settings → Alerts).

## Bước 4 — Đặt alert

Alert cần đăng nhập và skill KHÔNG có mật khẩu của user, nên dùng đúng phiên đã đăng nhập trong Chrome của user (như bấm trên UI). Không tạo session thủ công trong DB, không dò mật khẩu.

1. Nạp công cụ Chrome trong **một** `ToolSearch`: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__tabs_close_mcp`.
2. `tabs_context_mcp` với `createIfEmpty: true` → `navigate` tab đó tới `http://localhost:3000` (cùng profile Chrome nên đã đăng nhập).
3. Qua `javascript_tool` (cùng một lần chạy cho mọi bước):
   - `GET http://localhost:8000/alerts` (`credentials:"include"`). Nếu 401 `Chưa đăng nhập` → dừng, in danh sách vùng dạng bảng để user tự đặt hoặc đăng nhập rồi chạy lại.
   - `GET /alerts/channels`: dùng `web` luôn; thêm `telegram` chỉ khi `telegram.linked`, thêm `mt5` chỉ khi `mt5.online && mt5.push_enabled`. Kênh nào thiếu thì nói rõ.
   - Bỏ qua mức mới nếu đã có alert `XAUUSDm` đang `active` có tên bắt đầu `XAU ` trong vòng ±2 điểm (alert cũ đó có `on_chart:true` thì `PATCH {on_chart:false}` cho nó). Alert `XAU ` cũ còn active ở mức không còn trong danh sách mới thì **liệt kê và hỏi user có xoá không** (xoá = `DELETE /alerts/{id}`), không tự xoá.
   - `POST /alerts` từng mức:
     ```js
     fetch("http://localhost:8000/alerts",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({symbol:"XAUUSDm",cond:"cross_up"/*hoặc cross_down*/,level:4023.5,trigger:"once",tf:"M1",
         expires_at:EXPIRES_AT /* số in ở dòng "expires_at=" của script = 22:00 VN */,
         name:"XAU 4023.5 · BÁN 1 POC T6" /* ≤60 ký tự */,
         message:"…" /* ≤200 ký tự */,
         /* không gửi on_chart: mặc định false = chỉ hiện trong danh sách alert, vùng đã có hình chữ nhật ở bước 4b nên không vẽ thêm đường giá */
         channels:{web:true,telegram:true,mt5:true}})})
     ```
   - Sửa alert đã có: `PATCH /alerts/{id}` (vd `{expires_at:…}`, `{level:…}`, `{on_chart:false}`).
   - Cuối cùng `GET /alerts` để xác nhận mọi alert `active`, đúng kênh, hạn và `on_chart:false`.
4. Giữ tab này cho bước 4b, đóng bằng `tabs_close_mcp` sau khi vẽ xong.

**Tên:** `XAU <giá> · <nhãn ngắn>` (tiền tố `XAU ` bắt buộc, dùng để nhận ra alert của skill).
**Nội dung (≤200 ký tự):** cơ sở orderflow của vùng (POC/VAH/HVN/hấp thụ…) + điều kiện xác nhận khi giá tới (delta, CVD, hấp thụ, phân kỳ) + mức làm kịch bản sai. Viết là điều kiện quan sát, không viết thành mệnh lệnh.

## Bước 4b — Vẽ vùng phản ứng lên chart

Mỗi alert tương ứng một hình chữ nhật (Rectangle) trên chart để user nhìn vùng trên chart. Alert của skill để `on_chart` mặc định `false` (chỉ nằm trong danh sách alert, không có đường giá cam trên chart) nên hình chữ nhật là thứ duy nhất skill để lại trên chart, và nó còn nguyên sau khi alert nổ. Vẫn dùng tab đã đăng nhập ở bước 4. Hình vẽ lưu ở `/me/drawings/<SYMBOL>__<layoutId>?scope=<SYMBOL>`, body `{version:1, items:[…]}`; ghi trực tiếp bằng PUT rồi tải lại trang (không cần bấm UI).

1. Lấy `layoutId`: `localStorage["wickloom-layout-current:<uid>"]` (khoá bắt đầu bằng `wickloom-layout-current`) → `JSON.parse(...).id`; không có thì `default`.
2. `GET` doc hiện có, **giữ nguyên mọi hình không có id bắt đầu `xau-of-`** (hình user tự vẽ), bỏ các `xau-of-*` cũ rồi thêm bộ mới. Không bao giờ PUT mảng chỉ có hình của skill.
3. Mỗi vùng = 1 hình `rect`: đỉnh vùng, đáy vùng lấy từ output script (vùng trùng nhau của mức ứng viên, vd 4003.5–4000.8). Vùng trên giá là supply, màu đỏ `#f23645`; dưới giá là demand, màu xanh `#089981`. Hình bắt đầu từ đầu phiên (22:00 UTC hôm trước) và kéo dài sang phải:
   ```js
   const t0=Date.UTC(Y,M-1,D,22,0)/1000, t1=Math.floor(Date.now()/1000/60)*60-180; // t0 = 22:00 UTC của phiên đang chạy
   const mk=([hi,lo,c,text,vAlign],i)=>({id:"xau-of-"+(i+1),type:"rect",points:[{time:t0,price:hi},{time:t1,price:lo}],
     color:c,width:1,dash:0,textColor:c,text,locked:false,hidden:false,
     opts:{extend:"right",middleLine:false,background:true,backgroundColor:c,hAlign:"center",vAlign,fontSize:11}});
   await fetch(`http://localhost:8000/me/drawings/XAUUSDm__${layoutId}?scope=XAUUSDm`,{method:"PUT",credentials:"include",
     headers:{"Content-Type":"application/json"},body:JSON.stringify({version:1,items:[...keep,...zones.map(mk)]})});
   ```
4. **Chữ trên hình:** ngắn (≤ ~26 ký tự, vd `Supply · POC T6 4023.75`, `Demand · hấp thụ + VAL nay`), `hAlign:"center"`. Chữ mở đầu luôn là `Supply` (vùng trên giá, đỏ) hoặc `Demand` (vùng dưới giá, xanh), **không viết `Cung` / `Cầu` trên hình**; phần mô tả sau dấu `·` vẫn viết tiếng Việt. `vAlign` đặt ở mép **đối diện** với mức alert: alert nằm mép dưới vùng (cross_up) → `"top"`; alert nằm mép trên vùng (cross_down) → `"bottom"`; alert nằm ngoài mép dưới vùng (vd quét đáy) → `"top"`.
5. Kiểm tra: `GET` lại doc, rồi `navigate` lại `http://localhost:3000`, đợi ~3 giây, chụp màn hình và nhìn các vùng đã hiện (cần nạp thêm `mcp__claude-in-chrome__computer`). Không bấm nút `auto`, không kéo chart (đổi view có thể lưu vào layout của user).
6. Hình vẽ **không tự hết hạn** như alert; mỗi lần chạy skill thay bộ `xau-of-*` cũ bằng bộ mới. Tab chart user đang mở phải **tải lại (F5)** mới thấy; nếu user vẽ thêm trước khi tải lại, hình của skill có thể bị ghi đè, nói user tải lại ngay.

Sau đó `tabs_close_mcp` đóng tab.

## Bước 5 — Báo cáo cho user (ngắn, tiếng Việt, giờ VN)

1. 3–5 dòng bối cảnh: giá hiện tại, xu hướng, vị trí so với value area, CVD / hấp thụ đáng chú ý.
2. Bảng alert: mức | chiều cắt | vùng | cơ sở orderflow.
3. Khi alert nổ cần xác nhận gì (vùng bán vs vùng mua; mức làm kịch bản sai).
4. Tin USD trong cửa sổ trade (giờ VN), hoặc nói rõ không có.
5. Nêu hạn alert (22:00 VN hôm nay), các kênh đã bật, và nhắc alert nằm trong danh sách alert (không vẽ đường trên chart) và đã vẽ N vùng lên chart (xanh = demand, đỏ = supply, id `xau-of-*`; tải lại trang để thấy).
6. Giới hạn: volume là tick count của CFD, delta tick-rule nhiễu nên chỉ so sánh tương đối; không phải cố vấn đầu tư, quyết định vào lệnh, SL/TP, khối lượng là của user (chỉ đưa lot / SL / TP cụ thể khi user hỏi).

## Ghi chú kỹ thuật

- Backend `:8000` (public: `/bars`, `/tickvp`, `/tickbig`, `/tickfp`, `/calendar`; cần đăng nhập: `/alerts*`). Nến JSON dạng `{t,o,h,l,c,v}`; tf `TD` là tick delta từng phút (`c` = delta phút, `v` = số tick).
- `cond` hợp lệ: `cross`, `cross_up`, `cross_down`, `gt`, `lt`. Cắt lên = giá trước < mức ≤ giá mới (xem `backend/app/alerts.py` `hit`).
- Hình vẽ: `Drawing` = `{id,type,points:[{time(epoch giây),price}],color,width,dash,text,textColor,opts,locked,hidden}` (xem `web/src/drawings/types.ts`); `rect` có `opts.extend` (`none|left|right|both`), `background`, `backgroundColor` (nền alpha 0.15 theo màu), `hAlign`/`vAlign`/`fontSize` (xem `tools.ts` `rectangle`, `boxText`). Lưu tại `/me/drawings/<symbol>__<layoutId>` (xem `web/src/drawings/doc.ts`).
- `on_chart` (mặc định `false`): `true` thì web vẽ price line (kéo được) của alert trên chart; `false` thì alert chỉ hiện trong danh sách. Alert tạo từ dialog trên chart gửi `true` (xem `web/src/alerts/model.ts` `lineAlerts`).
- Tối đa 100 alert đang chạy mỗi tài khoản. `trigger:"once"`: nổ một lần rồi thôi.
- Chỉ phiên đang chạy có tick realtime; BTC và symbol khác không nằm trong skill này.
