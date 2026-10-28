---
name: xau-orderflow-intraday
description: Phân tích orderflow intraday cho vàng (XAUUSDm) từ dữ liệu tick của backend Wickloom (volume profile, CVD, hấp thụ, tin USD) rồi đặt alert các vùng quan trọng qua web + Telegram + MT5 push (hết hạn 22:00 giờ VN) và vẽ các vùng phản ứng (reaction) lên chart; mỗi lần gọi lại sẽ xoá alert và vùng cũ của skill rồi đặt bộ mới. Dùng khi user gõ /xau-orderflow-intraday hoặc nhờ "phân tích orderflow vàng", "đặt alert vùng", "soi vàng hôm nay", "vẽ vùng cho tôi trade", "vẽ vùng reaction".
---

# Orderflow vàng + đặt alert

**Người dùng:** chỉ trade vàng (XAUUSDm), theo **intraday**, **hết giờ trade 22:00 giờ VN (= 15:00 UTC)**. Khi alert nổ, user tự nhìn footprint / CVD rồi tự vào lệnh. Việc của skill là chọn vùng, đặt alert và vẽ vùng lên chart (bước 4b), không đặt lệnh hộ.
Không cần hỏi lại user về symbol, giờ trade, kênh thông báo; chỉ hỏi khi dữ liệu có vấn đề (xem bước 1).

**Mỗi lần gọi là làm lại từ đầu:** skill xoá sạch alert `XAU ` (mọi trạng thái) và hình `xau-of-*` (mọi layout) của lần chạy trước rồi đặt bộ mới, **không hỏi user**. Chỉ xoá những gì skill tự tạo (tiền tố tên `XAU ` / id `xau-of-`), không đụng alert hay hình user tự tạo. Xoá chỉ diễn ra ở bước 4 / 4b, sau khi đã có bộ vùng mới: dữ liệu lỗi hoặc user dừng ở bước 1 thì bộ cũ giữ nguyên.

## Bước 1 — Lấy dữ liệu (chỉ đọc, không cần đăng nhập)

Chạy từ thư mục gốc repo (`/Users/tronghoang/Workplace/wickloom`):

```
python3 -I .claude/skills/xau-orderflow-intraday/scripts/analyze.py            # mặc định: XAUUSDm, cấu trúc 5 ngày xong + hôm nay, profile riêng 4 ngày, ±90 điểm
python3 -I .claude/skills/xau-orderflow-intraday/scripts/analyze.py --week 8 --sessions 6 --range 120   # nếu cần rộng hơn
```

`--asof "MM-DD HH:MM"` (UTC) chạy lại như thể bây giờ là mốc đó, dùng để kiểm chứng bias của một buổi đã qua (vd `--asof "10-27 04:51"`).

Script in: ngày giao dịch (M1 liền mạch, nhãn `T5 22/10`), **mục BIAS TRONG NGÀY** (4 phiếu từ phiên đang chạy, dòng `=> BIAS TRONG NGÀY` và dòng **HƯỚNG THEO BIAS TRONG NGÀY** cho biết phía nào là Supply / Demand theo bias), đáy/đỉnh lịch sử, **bảng cấu trúc nhiều ngày** (POC / VA từng ngày, VA so với ngày trước: cao hơn / thấp hơn / chồng lấn) + composite tuần + dòng **KẾT LUẬN CẤU TRÚC NHIỀU NGÀY** (chỉ là bối cảnh; cú xả / bơm cũ mà 3 ngày gần nhất đã cân bằng lại thì không còn tính là xu hướng), POC/VAH/VAL/HVN/LVN từng ngày, CVD phiên hiện tại từng 15 phút + so sánh CVD tại đỉnh/đáy giá, các cửa sổ 5 phút tick lớn ở đáy/đỉnh cục bộ (hấp thụ), ô tick lớn, **danh sách mức ứng viên có điểm trùng (★ ≥3, mỗi mức gắn `[theo XH]` hoặc `[ngược XH]`)**, tin USD trong cửa sổ trade, và dòng `expires_at=...` (22:00 VN) dùng cho alert. Giờ in ra là UTC; **báo cáo cho user bằng giờ VN (UTC+7)**.

Xử lý khi dữ liệu có vấn đề, KHÔNG tự đặt alert theo giá cũ:
- Backend không trả lời → báo user bật backend (`dev.sh`), dừng.
- Dòng `!! M1 cuối trễ ...` (thị trường đóng, cuối tuần, EA tắt) → nói rõ, hỏi user có muốn vẫn đặt alert cho phiên mở cửa tới không.
- `độ phủ TD` < 90% → CVD chỉ tương đối, nói rõ.
- Phiên cũ hơn tick history (TD chỉ có từ 2026-10-09 cho vàng) có profile rỗng — bình thường.

## Bước 2 — Đọc theo phương pháp orderflow

1. **Bias (ưu tiên: bias trong ngày):** user đánh intraday nên hướng của hôm nay quyết định vùng nào là theo / ngược. Lấy từ dòng `=> BIAS TRONG NGÀY` của script (không dùng SMC / cấu trúc swing): tổng 4 phiếu từ phiên đang chạy (giá so với VA hôm qua, ≥80% nến đóng ngoài value đã hình thành trong 30 phút cuối, POC 3 giờ cuối dịch ≥0,25× biên trung vị so với đầu ngày, xung lực 2 giờ có delta đồng thuận); `|tổng| ≥ 2` mới có hướng, còn lại là **CÂN BẰNG** (kể cả "nghiêng nhẹ"). **CÂN BẰNG nghĩa là chưa đủ phiếu, không phải dự báo đi ngang:** kiểm tra 28/10 trên 12 ngày (mỗi giờ 01–14 UTC, 158 mốc) cho thấy 68% số mốc là cân bằng, và 65/108 mốc đó giá vẫn chạy ≥15 điểm tới 22:00 VN. Khi báo cáo, viết "chưa rõ hướng", không viết "đi ngang". Khi có hướng thì bias đúng tới 22:00 VN 68% số mốc (tăng 70%, giảm 67%), nhưng bias tăng chỉ đúng 43% trong 2 giờ sau đó (hay ra sau một cú bơm rồi giá hồi), nên khi bias tăng đừng mua đuổi, chờ giá lùi về Demand. Bias vẫn trễ trên ngày một chiều: 27/10 thành TĂNG lúc 20:00 VN (trước đây 21:30), cú tăng bắt đầu từ 18:00. Biên hôm nay so với trung vị (nén / mở rộng) chỉ là bối cảnh. Phía theo bias lấy từ dòng `HƯỚNG THEO BIAS TRONG NGÀY` (bias giảm: Supply theo bias, Demand ngược; bias tăng: ngược lại; cân bằng: không phía nào được ưu tiên, mép VA hôm nay / hôm qua là nơi phản ứng). **Nhãn `XH` trong skill = hướng bias trong ngày**, không phải xu hướng nhiều ngày.
   **Cấu trúc nhiều ngày** (dòng `KẾT LUẬN CẤU TRÚC NHIỀU NGÀY`) chỉ là bối cảnh: value cũ / POC composite là vùng cung cầu để tham khảo khi giá chạm, không quyết định hướng. Nếu lệch với bias trong ngày (script in dòng `Lệch:`) thì theo bias trong ngày và nói rõ lệch trong báo cáo. **Không được báo "bias giảm / tăng" chỉ dựa trên cấu trúc nhiều ngày**: bias bị cú xả / bơm cũ trong cửa sổ kéo lệch là lỗi đã gặp sáng 27/10 (cú xả 22/10 làm ra "giảm" trong khi ba ngày sau đi ngang).
2. **CVD vs giá:** đỉnh giá mới mà CVD thấp hơn đỉnh CVD = phân kỳ giảm; đáy giá mới mà CVD cao hơn = phân kỳ tăng. Dòng "Đỉnh/Đáy phiên … CVD khi đó" trong output cho đúng so sánh này.
3. **Hấp thụ:** cửa sổ 5 phút tick ≥2× trung vị nằm ở đáy/đỉnh cục bộ, delta ≈ 0 và giá bị đẩy ngược ≥ ~10 điểm trong 15 phút sau = bên chủ động bị hấp thụ → vùng đó là cầu / cung thật.
4. **Node:** HVN / POC = nơi giá được chấp nhận (nam châm, kháng cự / hỗ trợ). **LVN là vùng giá chạy nhanh, không phải hỗ trợ**, chỉ dùng làm mốc "gốc breakout" để tìm pullback về HVN / VAH ngay bên dưới (hoặc VAL ngay bên trên khi breakout xuống).
5. **Gốc cú xả / cú bơm:** cụm tick lớn và đỉnh / đáy ngay trước một cú chạy mạnh là nơi bên kia nằm chờ.
6. **Đáy / đỉnh cực trị của lịch sử dữ liệu:** bên ngoài không còn profile (vùng trống). Đặt mốc ngay ngoài mức đó: thủng / quét rồi lấy lại (bẫy) đều cần nhìn orderflow.

## Bước 3 — Chọn vùng

- 6–8 alert, ưu tiên ★ (điểm ≥3), thêm vùng điểm thấp hơn nếu có lý do orderflow rõ (hấp thụ, gốc breakout). Hai alert cách nhau <5 điểm chỉ khi ý nghĩa khác nhau (vùng vào vs quét đỉnh).
- **Chọn theo bias trong ngày:** khi script có hướng (bias giảm / tăng), vùng `[theo XH]` chiếm ít nhất 2/3 số vùng (vd 5 trong 7) và được phép nằm xa hơn nếu ★; vùng `[ngược XH]` tối đa 2 và chỉ khi ★ ≥3 hoặc có hấp thụ / đáy-đỉnh cực trị lịch sử. Khi script ghi "không có" hướng (cân bằng, phổ biến ở ngày biên nén): bỏ hạn mức, chọn đều hai phía, ưu tiên mép VA hôm nay / hôm qua và các mức gần giá; mức xa chỉ lấy khi ★.
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
   - Từ kết quả `GET /alerts`, ghi lại **id mọi alert cũ của skill**: `symbol==="XAUUSDm" && name.startsWith("XAU ")`, bất kể `state` (active, paused, triggered, expired). Đây là bộ sẽ xoá; alert không có tiền tố `XAU ` là của user, không đụng.
   - `POST /alerts` từng mức (luôn tạo mới, không bỏ qua mức nào dù đã có alert cũ gần đó):
     ```js
     fetch("http://localhost:8000/alerts",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
       body:JSON.stringify({symbol:"XAUUSDm",cond:"cross_up"/*hoặc cross_down*/,level:4023.5,trigger:"once",tf:"M1",
         expires_at:EXPIRES_AT /* số in ở dòng "expires_at=" của script = 22:00 VN */,
         name:"XAU 4023.5 · BÁN 1 POC T6" /* ≤60 ký tự */,
         message:"…" /* ≤200 ký tự */,
         /* không gửi on_chart: mặc định false = chỉ hiện trong danh sách alert, vùng đã có hình chữ nhật ở bước 4b nên không vẽ thêm đường giá */
         channels:{web:true,telegram:true,mt5:true}})})
     ```
   - **Xoá bộ cũ:** khi mọi `POST` trả 201, `DELETE /alerts/{id}` từng id đã ghi ở trên (không hỏi user). Có `POST` nào lỗi thì **không xoá** bộ cũ, báo lỗi cho user. Tạo bộ mới trước rồi mới xoá cũ để lỗi giữa chừng không để user trắng alert; id mới khác id cũ nên không xoá nhầm.
   - Sửa một alert cụ thể (chỉ khi user nhờ): `PATCH /alerts/{id}` (vd `{expires_at:…}`, `{level:…}`).
   - Cuối cùng `GET /alerts` để xác nhận: alert `XAU ` còn lại đúng bằng số vừa tạo, mọi alert `active`, đúng kênh, hạn và `on_chart:false`.
4. Giữ tab này cho bước 4b, đóng bằng `tabs_close_mcp` sau khi vẽ xong.

**Tên:** `XAU <giá> · <nhãn ngắn>` (tiền tố `XAU ` bắt buộc, dùng để nhận ra alert của skill).
**Nội dung (≤200 ký tự):** cơ sở orderflow của vùng (POC/VAH/HVN/hấp thụ…) + điều kiện xác nhận khi giá tới (delta, CVD, hấp thụ, phân kỳ) + mức làm kịch bản sai. Viết là điều kiện quan sát, không viết thành mệnh lệnh. Vùng `[ngược XH]`: nội dung mở đầu bằng `Ngược XH:` và điều kiện xác nhận phải đủ hai trong ba dấu hiệu (hấp thụ, phân kỳ CVD, M5 từ chối có delta cùng chiều), khớp luật của `/xau-intraday-monitor`.

## Bước 4b — Vẽ vùng phản ứng lên chart

Mỗi alert tương ứng một hình chữ nhật (Rectangle) trên chart để user nhìn vùng trên chart. Alert của skill để `on_chart` mặc định `false` (chỉ nằm trong danh sách alert, không có đường giá cam trên chart) nên hình chữ nhật là thứ duy nhất skill để lại trên chart, và nó còn nguyên sau khi alert nổ. Vẫn dùng tab đã đăng nhập ở bước 4. Hình vẽ lưu ở `/me/drawings/<SYMBOL>__<layoutId>?scope=<SYMBOL>`, body `{version:1, items:[…]}`; ghi trực tiếp bằng PUT rồi tải lại trang (không cần bấm UI).

1. Lấy `layoutId`: `localStorage["wickloom-layout-current:<uid>"]` (khoá bắt đầu bằng `wickloom-layout-current`) → `JSON.parse(...).id`; không có thì `default`.
2. **Xoá hình cũ:** `GET http://localhost:8000/me/drawings` trả mọi doc dạng `[{id, data:{version, items}}]`. Với **mọi** doc có `id` bắt đầu `XAUUSDm__` (mọi layout, không chỉ layout hiện tại): bỏ các hình có id bắt đầu `xau-of-`, **giữ nguyên mọi hình khác** (hình user tự vẽ) và các field khác của `data`. Doc của layout hiện tại thì thêm bộ mới vào sau khi bỏ cũ; doc layout khác chỉ `PUT` lại khi thật sự có hình `xau-of-` bị bỏ. Không bao giờ PUT mảng chỉ có hình của skill. Layout hiện tại chưa có doc thì tạo doc mới `{version:1, items:[…]}`.
3. Mỗi vùng = 1 hình `rect`: đỉnh vùng, đáy vùng lấy từ output script (vùng trùng nhau của mức ứng viên, vd 4003.5–4000.8). Vùng trên giá là supply, màu đỏ `#f23645`; dưới giá là demand, màu xanh `#089981` (màu theo vị trí, không theo bias). Vùng `[theo XH]` viền liền (`dash:0`), vùng `[ngược XH]` viền đứt (`dash:1`); khi cân bằng (không có hướng) mọi vùng viền liền. Hình bắt đầu từ đầu phiên (22:00 UTC hôm trước) và kéo dài sang phải:
   ```js
   const t0=Date.UTC(Y,M-1,D,22,0)/1000, t1=Math.floor(Date.now()/1000/60)*60-180; // t0 = 22:00 UTC của phiên đang chạy
   const mk=([hi,lo,c,text,vAlign,against],i)=>({id:"xau-of-"+(i+1),type:"rect",points:[{time:t0,price:hi},{time:t1,price:lo}],
     color:c,width:1,dash:against?1:0 /* ngược XH = viền đứt */,textColor:c,text,locked:false,hidden:false,
     opts:{extend:"right",middleLine:false,background:true,backgroundColor:c,hAlign:"center",vAlign,fontSize:11}});
   await fetch(`http://localhost:8000/me/drawings/XAUUSDm__${layoutId}?scope=XAUUSDm`,{method:"PUT",credentials:"include",
     headers:{"Content-Type":"application/json"},body:JSON.stringify({version:1,items:[...keep,...zones.map(mk)]})});
   ```
4. **Chữ trên hình:** ngắn (≤ ~26 ký tự, vd `Supply · POC T6 4023.75`, `Demand · hấp thụ + VAL nay`), `hAlign:"center"`. Chữ mở đầu luôn là `Supply` (vùng trên giá, đỏ) hoặc `Demand` (vùng dưới giá, xanh), **không viết `Cung` / `Cầu` trên hình**; phần mô tả sau dấu `·` vẫn viết tiếng Việt. `vAlign` đặt ở mép **đối diện** với mức alert: alert nằm mép dưới vùng (cross_up) → `"top"`; alert nằm mép trên vùng (cross_down) → `"bottom"`; alert nằm ngoài mép dưới vùng (vd quét đáy) → `"top"`.
5. Kiểm tra: `GET` lại doc, rồi `navigate` lại `http://localhost:3000`, đợi ~3 giây, chụp màn hình và nhìn các vùng đã hiện (cần nạp thêm `mcp__claude-in-chrome__computer`). Không bấm nút `auto`, không kéo chart (đổi view có thể lưu vào layout của user).
6. Hình vẽ **không tự hết hạn** như alert nên việc dọn là của skill: mỗi lần chạy xoá sạch `xau-of-*` cũ (bước 2) rồi mới thêm bộ mới, vùng của hôm qua không bao giờ nằm lại chart. Tab chart user đang mở phải **tải lại (F5)** mới thấy; nếu user vẽ thêm trước khi tải lại, hình của skill có thể bị ghi đè, nói user tải lại ngay.

Sau đó `tabs_close_mcp` đóng tab.

## Bước 5 — Báo cáo cho user (ngắn, tiếng Việt, giờ VN)

1. 3–5 dòng bối cảnh, **dòng đầu là bias trong ngày** (nhãn + tổng phiếu + 1 câu lý do, vd "CÂN BẰNG (tổng 0): biên 0.76× trung vị, giá quay quanh POC 4011"), rồi giá hiện tại và vị trí so với VA hôm nay / hôm qua; CVD / hấp thụ đáng chú ý; cuối cùng một dòng cấu trúc nhiều ngày làm bối cảnh (rút từ `KẾT LUẬN CẤU TRÚC NHIỀU NGÀY`, ghi rõ nó không quyết định hướng hôm nay). Bias trong ngày đổi theo diễn biến giá: nhắc user chạy lại skill khi giá thoát khỏi VA hôm nay hoặc sau tin lớn.
2. Bảng alert: mức | chiều cắt | vùng | theo / ngược XH (bỏ cột khi cân bằng) | cơ sở orderflow.
3. Khi alert nổ cần xác nhận gì: 3–5 dòng rút từ `docs/xau-orderflow-checklist.md` (gốc repo) gắn với các vùng vừa đặt (Supply cần hấp thụ mua / phân kỳ giảm, Demand cần hấp thụ bán / phân kỳ tăng; mức làm kịch bản sai của từng vùng), rồi nói user checklist đầy đủ nằm ở `docs/xau-orderflow-checklist.md`. Không in lại cả file.
4. Tin USD trong cửa sổ trade (giờ VN), hoặc nói rõ không có.
5. Nêu hạn alert (22:00 VN hôm nay), các kênh đã bật, và nhắc alert nằm trong danh sách alert (không vẽ đường trên chart) và đã vẽ N vùng lên chart (xanh = demand, đỏ = supply, viền đứt = ngược bias trong ngày, id `xau-of-*`; tải lại trang để thấy). Ghi một dòng đã dọn gì của lần trước: "đã xoá X alert + Y vùng cũ" (X = số alert `XAU ` cũ, Y = số hình `xau-of-*` cũ; nếu không có gì cũ thì bỏ dòng này).
6. Nhắc user có `/xau-intraday-monitor`: theo dõi delta / CVD các vùng vừa vẽ và, khi một vùng đủ xác nhận, dựng lệnh nháp (SL/TP) trên chart + gửi Telegram. Alert chỉ báo giá chạm vùng, không báo orderflow có xác nhận hay không. Vừa đặt bộ vùng mới xong thì **bật monitor ngay** nếu user đang theo dõi (đừng để khoảng trống như lúc 11:13–11:23 ngày 27/10, vùng bị chạm khi chưa có ai theo dõi).
7. Giới hạn: volume là tick count của CFD, delta tick-rule nhiễu nên chỉ so sánh tương đối; không phải cố vấn đầu tư, quyết định vào lệnh, SL/TP, khối lượng là của user (chỉ đưa lot / SL / TP cụ thể khi user hỏi).

## Ghi chú kỹ thuật

- `docs/xau-orderflow-checklist.md` (gốc repo, để user tự đọc): checklist khi giá chạm vùng (nguồn duy nhất, chung cho mọi vùng). Nếu user sửa ngưỡng hay quy trình, sửa ở file này và giữ bước 5 khớp.

- Backend `:8000` (public: `/bars`, `/tickvp`, `/tickbig`, `/tickfp`, `/calendar`; cần đăng nhập: `/alerts*`). Nến JSON dạng `{t,o,h,l,c,v}`; tf `TD` là tick delta từng phút (`c` = delta phút, `v` = số tick).
- `cond` hợp lệ: `cross`, `cross_up`, `cross_down`, `gt`, `lt`. Cắt lên = giá trước < mức ≤ giá mới (xem `backend/app/alerts.py` `hit`).
- Hình vẽ: `Drawing` = `{id,type,points:[{time(epoch giây),price}],color,width,dash(0 liền, 1 đứt, 2 chấm),text,textColor,opts,locked,hidden}` (xem `web/src/drawings/types.ts`); `rect` có `opts.extend` (`none|left|right|both`), `background`, `backgroundColor` (nền alpha 0.15 theo màu), `hAlign`/`vAlign`/`fontSize` (xem `tools.ts` `rectangle`, `boxText`). Lưu tại `/me/drawings/<symbol>__<layoutId>` (xem `web/src/drawings/doc.ts`).
- `on_chart` (mặc định `false`): `true` thì web vẽ price line (kéo được) của alert trên chart; `false` thì alert chỉ hiện trong danh sách. Alert tạo từ dialog trên chart gửi `true` (xem `web/src/alerts/model.ts` `lineAlerts`).
- Tối đa 100 alert đang chạy mỗi tài khoản. `trigger:"once"`: nổ một lần rồi thôi. `state` của alert: `active | paused | triggered | expired`; `DELETE /alerts/{id}` xoá được ở mọi trạng thái (trả `{ok:true}`, id lạ 404).
- `GET /me/drawings` liệt kê mọi doc hình vẽ của tài khoản (`[{id, data}]`), `PUT /me/drawings/{id}` ghi đè cả doc (xem `backend/app/me.py`); vì vậy luôn GET → sửa → PUT, không ghi mảng rút gọn.
- Chỉ phiên đang chạy có tick realtime; BTC và symbol khác không nằm trong skill này.
