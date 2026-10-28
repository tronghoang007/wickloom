---
name: xau-intraday-monitor
description: Theo dõi các vùng Supply / Demand mà /xau-orderflow-intraday đã vẽ (XAUUSDm) bằng delta / CVD / tick từng phút; khi một vùng đủ xác nhận thì dựng lệnh nháp (entry, SL, TP) trên chart và gửi Telegram để user tự bấm Buy/Sell. Không bao giờ tự đặt lệnh. Dùng khi user gõ /xau-intraday-monitor hoặc nhờ "theo dõi vùng", "theo dõi delta", "báo tôi khi có xác nhận", "tạo lệnh nháp", "gửi tele khi có tín hiệu".
---

# Theo dõi vùng + lệnh nháp + Telegram

**Người dùng:** chỉ trade vàng (XAUUSDm), intraday, hết giờ trade **22:00 giờ VN (= 15:00 UTC)**, tự bấm Buy/Sell. Skill này chỉ: (1) theo dõi, (2) dựng **lệnh nháp** có SL/TP trên chart, (3) gửi Telegram. Giờ in ra của script là VN; báo user bằng giờ VN.

**Tuyệt đối không:** bấm nút đặt lệnh (nút submit dưới đáy bảng Place order, nút Buy/Sell / Confirm / Place trên thẻ lệnh ở chart, Sell/Buy trong Positions/Orders), nhấn **Enter** trong ô của bảng lệnh (Enter gửi form = đặt lệnh), đổi lot, đụng lệnh đã đặt. Không hỏi lại user về symbol, giờ, kênh; chỉ dừng khi dữ liệu có vấn đề (bước 0).

## Bước 0 — Điều kiện

1. Có vùng: hình `xau-of-*` do `/xau-orderflow-intraday` vẽ (bước 1 sẽ đọc). Chưa có hình nào → nói user chạy `/xau-orderflow-intraday` trước, dừng.
2. Backend `:8000` trả lời và M1 cuối không trễ quá ~5 phút (`curl -s "http://localhost:8000/bars?symbol=XAUUSDm&tf=M1&limit=1"`, so `t` với giờ hiện tại). Trễ nhiều (thị trường đóng / EA tắt) → nói rõ, hỏi user có muốn đợi không, dừng. Không theo dõi dữ liệu cũ.
3. Còn trước 22:00 VN. Hết giờ thì không bật.

## Bước 1 — Lấy vùng từ app (Chrome, dùng phiên đã đăng nhập)

1. Nạp công cụ trong **một** `ToolSearch`: `select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__tabs_close_mcp,Monitor,TaskStop`.
2. `tabs_context_mcp` (`createIfEmpty:true`) → `navigate` tab tới `http://localhost:3000`. **Giữ tab này mở suốt lần theo dõi**: lệnh nháp chỉ sống trong tab nó được dựng (state trình duyệt), tab khác của user không thấy.
3. `javascript_tool` đọc vùng (side theo màu, `against` theo viền đứt `dash:1` = ngược bias trong ngày lúc vẽ, mức sai kịch bản `bad` rút từ nội dung alert `Sai nếu …`; không khớp thì để `null`, script tự dùng hi+1 / lo−1):
   ```js
   const B="http://localhost:8000";
   const lk=Object.keys(localStorage).find(k=>k.startsWith("wickloom-layout-current")); let layoutId="default"; try{layoutId=JSON.parse(localStorage[lk]).id||"default"}catch(e){}
   const docs=await (await fetch(B+"/me/drawings",{credentials:"include"})).json();
   const doc=docs.find(d=>d.id===`XAUUSDm__${layoutId}`);
   const alerts=await (await fetch(B+"/alerts",{credentials:"include"})).json();
   const rx=/Sai nếu (?:chấp nhận (?:trên|dưới)|thủng|M5 đóng|đóng M5) ?[<>]? ?([0-9]+(?:\.[0-9]+)?)/;
   const zs=((doc&&doc.data.items)||[]).filter(i=>String(i.id).startsWith("xau-of-")&&i.type==="rect").map(i=>{
     const [p,q]=i.points.map(x=>x.price), lo=Math.min(p,q), hi=Math.max(p,q), side=i.color==="#f23645"?"S":"D";
     const a=alerts.find(x=>String(x.name).startsWith("XAU ")&&x.level>=lo-1&&x.level<=hi+1&&x.cond===(side==="S"?"cross_up":"cross_down"));
     const m=a&&rx.exec(a.message||"");
     return {side,lo,hi,bad:m?parseFloat(m[1]):null,against:i.dash===1,text:i.text};});
   const S=zs.filter(z=>z.side==="S").sort((a,b)=>a.lo-b.lo).map((z,i)=>({name:"S"+(i+1),...z}));   // Supply S1.. từ thấp lên cao
   const D=zs.filter(z=>z.side==="D").sort((a,b)=>b.hi-a.hi).map((z,i)=>({name:"D"+(i+1),...z}));   // Demand D1.. từ cao xuống thấp
   JSON.stringify([...S,...D])
   ```
   Không có vùng → như bước 0.1. Ghi kết quả bằng `Write` vào file tạm của phiên (scratchpad) tên `xau-zones.json`.
4. **Bias trong ngày hiện tại:** `python3 -I .claude/skills/xau-orderflow-intraday/scripts/analyze.py --bias-only | tail -1` → `BIAS=up|down|none`. Cờ `against` trong `xau-zones.json` (viền đứt) chỉ là bias lúc vẽ; bias trong ngày đổi theo diễn biến nên monitor dùng bias **hiện tại** (truyền `--bias` ở bước 2, đọc lại mỗi lần bật lại). Hình vẽ lệch với bias hiện tại (có vùng nào mà viền đứt ≠ ngược bias hiện tại) thì nói user một câu: bias đã đổi từ lúc vẽ, nên chạy lại `/xau-orderflow-intraday` để chọn vùng theo bias mới; trong lúc chờ monitor vẫn chạy với bias hiện tại.
5. (Nhanh, nên làm) kiểm tra script và luật bằng dữ liệu thật: `python3 -I .claude/skills/xau-intraday-monitor/scripts/watch.py --zones <xau-zones.json> --bias <BIAS> --replay 60` chạy xong không lỗi là được (in lại 60 phút gần nhất như thể vừa xảy ra).

## Bước 2 — Bật Monitor

`Monitor` với `command: python3 -I .claude/skills/xau-intraday-monitor/scripts/watch.py --zones <xau-zones.json> --bias <BIAS> --minutes <M> 2>&1` (chạy từ gốc repo hoặc dùng đường dẫn tuyệt đối), `timeout_ms: 1800000`, `M = min(29, số phút còn tới 22:00 VN)`. Chỉ một monitor tại một thời điểm: có monitor cũ thì `TaskStop` trước. Monitor hết hạn mà user còn muốn theo dõi và còn trước 22:00 VN thì bật lại, **đọc lại bias (bước 1.4)** và đọc lại vùng ở bước 1.3 nếu `/xau-orderflow-intraday` đã chạy lại.

Luật của script (ngưỡng thô, chỉnh ở đầu `watch.py`, không phải quy tắc cứng):
- Vùng **armed** khi giá đóng cửa ở phía tiếp cận (Supply: dưới vùng, Demand: trên vùng). Nến xuyên qua vùng từ phía sai không tính; giá quay lại phía tiếp cận thì bắt đầu lần tới vùng mới.
- **Hấp thụ:** nến trong vùng có tick ≥ 2× trung vị 90 phút (tương đối, vì số tick của CFD tuỳ broker và giờ), delta cùng hướng với bên bị hấp thụ (Supply: delta dương, Demand: âm) và |delta| ≥ 5% số tick, nến **không đóng theo hướng bên đó đẩy** (Supply: đóng ≤ mở; Demand: đóng ≥ mở), giá bị đẩy ngược ≥1,5 điểm khỏi đỉnh / đáy nến. Nến tăng mạnh có delta dương là phá vùng, không phải hấp thụ (27/10 20:00: +4 điểm, Δ +40 / 842 tick).
- **Phân kỳ:** đỉnh / đáy mới trong vùng mà CVD phiên kém lần trước ≥15 (chênh nhỏ hơn là nhiễu của tick-rule).
- **M5 từ chối (quét rồi bị từ chối):** nến M5 có râu vào vùng (Supply: đỉnh M5 ≥ mép dưới vùng; Demand: đáy M5 ≤ mép trên vùng) nhưng **đóng cửa ngoài mép vùng** phía tiếp cận (Supply: dưới mép dưới; Demand: trên mép trên) **và tổng delta của nến M5 cùng chiều từ chối** (Supply: âm; Demand: dương). Delta còn theo phía đẩy thì chỉ là chạm vùng, script in cờ `chưa tính từ chối`. Tính khi M5 đóng, nên trễ tối đa 5 phút so với râu.
- Backtest 28/10 (12 ngày 13–28/10, vùng giả lập từ `analyze.py --asof`, chấm SL / TP1): luật hiện tại +42R / 118 lệnh (58 TP1, 58 SL) khi bỏ qua spread, **+35R khi tính spread 0,3** (con số nên dùng). Trước các sửa đổi 28/10 là +29R / 135 lệnh. Ngày tăng / giảm một chiều vẫn lỗ (27/10 vùng thật: 5 lệnh, 5 SL). Nghỉ sau SL, lọc xung lực, một lệnh mỗi vùng, R:R ≥ 1 đều đã thử, không cải thiện nên không dùng.
- **Đủ xác nhận:** vùng theo bias trong ngày cần **một** trong ba dấu hiệu (hấp thụ, phân kỳ, M5 từ chối); vùng ngược bias cần **hai** trong ba. Theo / ngược tính từ `--bias` (Supply ngược khi `up`, Demand ngược khi `down`, `none` = không vùng nào ngược); không truyền `--bias` thì dùng viền vẽ (`dash:1` = ngược). Khi đó script in `** XÁC NHẬN … **` / `** ĐỦ ĐIỀU KIỆN … **` kèm dòng `>>> TÍN HIỆU {json}` (side, entry, sl, tp1, tp2, rr1, risk, why, warn).
- **Sai kịch bản:** nến M5 **đóng cửa** trên `bad` (Supply) / dưới `bad` (Demand), đúng như alert ghi "Sai nếu M5 đóng …" (cờ `SAI kịch bản`); nếu vùng đã có tín hiệu thì in `>>> HUỶ {json}`. Xét cả khi giá đã đóng qua hẳn vùng (vùng hết armed), nên vùng bị phá lên / xuống luôn có `SAI kịch bản` / `HUỶ`. Râu quét qua `bad` mà M5 đóng lại phía trong chỉ ra cờ `râu … chờ M5 đóng`, vùng vẫn sống và vẫn xét hấp thụ / phân kỳ (quét rồi lấy lại không bị loại).
- Gợi ý của `>>> TÍN HIỆU`: SL = ngoài cùng của `bad`, mép vùng và đỉnh / đáy giá đã quét trong vùng, thêm 0,3 (giá đã qua SL thì không ra tín hiệu); TP1 / TP2 = mép gần của hai vùng đối diện kế tiếp ∓ 0,3 (không có thì 2× / 3× rủi ro); entry = giá đóng nến tín hiệu.

## Bước 3 — Báo khi có sự kiện

- Chỉ báo user các dòng `!!` và `>>>`; dòng `·` (trạng thái 5 phút) và `[trong vùng]` không cần báo từng dòng, gộp thành một câu khi user hỏi hoặc khi vùng thay đổi. Mỗi báo cáo: giờ VN, giá, delta / tick / CVD của nến, đang ở vùng nào, còn thiếu gì để đủ xác nhận. Không lặp lại điều đã báo, không nói "chưa có tín hiệu" liên tục.
- Cờ `ĐÁY/ĐỈNH MỚI … nhiễu, chưa tính phân kỳ` = không phải xác nhận, đừng báo như xác nhận.

## Bước 4 — Khi có `>>> TÍN HIỆU`

1. **Kiểm tra trước khi dựng:**
   - Còn trước 22:00 VN.
   - Giá hiện tại (nến M1 mới nhất) so với `entry`: giữ nguyên `sl`, `tp1`, `tp2` của tín hiệu, tính lại `rr1` theo giá hiện tại. `rr1` mới < 1,0 hoặc giá đã chạm `sl` / `tp1` → **không dựng nháp**, chỉ gửi Telegram nói tín hiệu đã qua (bước 4.3 với nội dung đó).
   - Tin USD mức ≥2 trong ±5 phút (`GET /calendar?from=<now>&to=<now+900>&min_importance=2&currencies=USD`): vẫn dựng nhưng ghi cảnh báo trong Telegram.
   - `warn` của tín hiệu (R:R thấp, SL quá gần) đưa vào Telegram.
2. **Dựng lệnh nháp** trong tab đã giữ (bước 1.2), chỉ bằng `javascript_tool`, không gõ phím (nút SELL / BUY ở header chỉ **mở bảng Place order**, không đặt lệnh):
   ```js
   const sleep=ms=>new Promise(r=>setTimeout(r,ms));
   const setV=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value").set.call(el,v);el.dispatchEvent(new Event("input",{bubbles:true}));};
   const hdr=l=>document.querySelector(`[aria-label="${l}"]`);
   // SIDE = "SELL" | "BUY", SL / TP = số từ tín hiệu (TP dùng tp1, tp2 chỉ ghi trong Telegram)
   (hdr(SIDE==="SELL"?"Sell at market":"Buy at market")||{}).click(); await sleep(600);
   const dlg=document.querySelector('[role="dialog"][aria-label="Place order"]');
   if(!dlg) return "KHÔNG mở được bảng lệnh (chưa đăng nhập / account MT5 không cho đặt / không có giá)";
   const q=l=>dlg.querySelector(`[aria-label="${l}"]`);   // tìm trong đúng bảng Place order (bảng Modify cũng có ô cùng tên)
   for(const l of ["Enable Take profit","Enable Stop loss"]){const s=q(l); if(s&&s.getAttribute("aria-checked")!=="true") s.click();}
   await sleep(300);
   setV(q("Take profit price"),TP.toFixed(2)); setV(q("Stop loss price"),SL.toFixed(2)); await sleep(400);
   const on=[...dlg.querySelectorAll("button[aria-pressed=true]")].map(b=>b.textContent.trim().split(/\s+/)[0]);
   return JSON.stringify({side:on,tp:q("Take profit price").value,sl:q("Stop loss price").value,rr:(dlg.textContent.match(/1 : [0-9.]+/)||[""])[0],risk:(dlg.textContent.match(/Rủi ro[0-9.,]+ ?[A-Z]* ?\([0-9.]+%\)/)||[""])[0],err:(dlg.querySelector('[role="alert"]')||{}).textContent||""})
   ```
   (Công cụ chỉ tự trả về biểu thức cuối khi script **không** có `return` nào; script có `return` sớm như trên thì phải `return` cả dòng cuối, không thì kết quả là `undefined`.) Kiểm tra kết quả: hướng bật đúng `SIDE` (Sell/Buy), `tp` / `sl` đúng số, `err` rỗng. `err` khác rỗng (vd "TP của lệnh Sell phải thấp hơn giá thị trường" khi giá đã chạy qua TP, SL sai phía, quá gần giá) thì nút đặt lệnh của bảng tự khoá: ghi lỗi vào Telegram và vào báo cáo, không cố sửa bằng cách khác. `rr` và `risk` (rủi ro bằng tiền và % equity ở lot hiện tại của user) đưa vào báo cáo để user tự cân nhắc lot; skill không đổi lot. Chụp màn hình (`computer` screenshot) để thấy đường TP / SL trên chart. **Không bấm gì khác** trong bảng.
   Có sẵn nháp của tín hiệu trước thì bước trên ghi đè SL/TP và đổi hướng; muốn bỏ nháp thì bấm `Cancel` trong bảng (nút đó chỉ đóng bảng).
3. **Gửi Telegram** qua API alert của app (backend chưa có endpoint gửi tin tuỳ ý): tạo một alert nổ ngay ở tick đầu (`gt` với mức xa dưới giá), kênh `telegram` + `web`:
   ```js
   // T = JSON của >>> TÍN HIỆU, price = giá hiện tại, extra = cảnh báo (tin USD, R:R...) hoặc ""
   const name=`XAU ${T.side} ${T.zone} nháp @${T.entry}`;                      // ≤60 ký tự, tiền tố "XAU " để /xau-orderflow-intraday dọn lần sau
   const message=`${T.side} ${T.zone}${T.against?" (ngược XH)":""} vào ~${T.entry} SL ${T.sl} TP1 ${T.tp1} TP2 ${T.tp2} R:R ${T.rr1}. ${T.why}. ${extra} Nháp ở tab Chrome của Claude, bạn tự bấm.`.slice(0,200);
   await fetch("http://localhost:8000/alerts",{method:"POST",credentials:"include",headers:{"Content-Type":"application/json"},
     body:JSON.stringify({symbol:"XAUUSDm",cond:"gt",level:Math.round(price)-100,trigger:"once",tf:"M1",expires_at:Math.floor(Date.now()/1000)+3600,name,message,channels:{web:true,telegram:true,mt5:false}})});
   ```
   Hai giây sau `GET /alerts/log?limit=5`: dòng có `name` vừa tạo phải có `results.telegram === "ok"` (`results` là `{kênh: "ok" | lý do lỗi}`). Không phải `ok` → nói user ngay trong chat kèm lý do (chưa nối Telegram, bot chưa cấu hình, mạng…). Telegram sẽ hiện thêm một dòng điều kiện kiểu "Giá > … · giá …" do cách gửi này, bình thường. Không đọc hay in token bot.
4. **Báo user trong chat** (ngắn): vùng nào, hướng, vào / SL / TP1 / TP2 / R:R / rủi ro điểm, lý do (`why`), đã dựng nháp ở tab nào chưa (hoặc vì sao không), Telegram đã gửi chưa, và nhắc **user tự kiểm tra lại giá rồi bấm**. Vùng ngược bias nhắc thêm là ngược bias trong ngày (nói bias hiện tại là gì). SL/TP/khối lượng cuối cùng là quyết định của user.
5. Monitor vẫn chạy, các vùng khác tiếp tục theo dõi.

## Bước 5 — Khi có `>>> HUỶ` hoặc cờ `SAI kịch bản` của vùng đã có nháp

Bỏ nháp (bấm `Cancel` trong bảng Place order của tab đã giữ nếu nháp còn là của vùng đó), gửi Telegram theo cách bước 4.3 (tên `XAU HUỶ <zone> nháp`, nội dung: giá đã chấp nhận ngoài mức sai kịch bản `bad`, nháp đã bỏ), và báo user trong chat.

## Bước 6 — Kết thúc

Khi user nói dừng, hoặc sau 22:00 VN: `TaskStop` monitor, bỏ nháp còn lại, `tabs_close_mcp` tab đã giữ, và nói user rõ đã dừng. Không để monitor / nháp chạy sang ngày sau.

## Giới hạn thật (nói với user nếu họ hỏi)

- Chỉ hoạt động khi phiên Claude Code này còn mở và monitor còn chạy (tối đa 30 phút mỗi lần, phải bật lại). Phiên đóng thì không có Telegram.
- Script chỉ xử lý nến M1 **đã đóng**, nên có độ trễ ~1 phút; entry trong Telegram là giá lúc tính, user xem lại giá trước khi bấm.
- Lệnh nháp nằm trong tab Chrome do Claude mở (nhóm tab MCP), không hiện ở tab chart khác của user; Telegram nói rõ điều này.
- **Dữ liệu là CFD, không phải orderflow sàn** (đo 28/10 trên 10.283 nến M1 giờ trade): EA đếm mỗi lần **Bid** đổi là 1 tick, Bid lên = "mua", xuống = "bán". Delta M1 tương quan 0,88 với (đóng − mở) của chính nến (≈ 12 tick mỗi điểm giá), cùng dấu 86% số nến; phần delta không do giá không báo trước giá 5 / 15 phút sau (tương quan ≈ 0). Vì vậy "hấp thụ", "phân kỳ CVD", "delta M5" ở đây chủ yếu là hình dạng giá + số lần báo giá, không phải lệnh chủ động thật; nói với user như vậy, đừng mô tả là "phe mua bị hấp thụ" như trên footprint sàn. Backtest: delta thật cho kết quả tốt hơn cả 20 lần xáo trộn phần dư của delta, và tốt hơn bản thay delta bằng màu nến M5 (+42R so với +34R, chưa tính spread), nên delta vẫn được giữ, nhưng phần nó đóng góp nhỏ và chưa chắc chắn. 120 / 148 tín hiệu (luật cũ) đến từ M5 từ chối.
- **Spread:** chart là Bid. Lệnh Sell chạm SL / TP theo **Ask** (Bid + spread, vàng Exness ~0,15–0,40), nên SL Sell thực chất chỉ cách đỉnh vùng 0,3 − spread. Đã thử đệm 0,6 và 1,0: kết quả kém hơn, giữ 0,3. Lệnh Buy vào ở Ask.
- Ngưỡng hấp thụ / phân kỳ / SL / TP là mức tham chiếu thô. Replay cho thấy luật chạy đúng chứ không chứng minh hiệu quả giao dịch. Không phải lời khuyên đầu tư.
- Telegram đi qua alert của app nên mỗi tin để lại một alert đã nổ tên `XAU … nháp …` trong danh sách; `/xau-orderflow-intraday` lần sau tự xoá chúng.

## Ghi chú kỹ thuật

- `scripts/watch.py --replay N` dùng để thử luật trên N phút gần nhất; `--zones` nhận JSON `[{name, side:"S"|"D", lo, hi, bad?, against?, text?}]`; `--bias up|down|none` ghi đè `against` theo bias hiện tại (lấy bằng `analyze.py --bias-only`).
- Bảng đặt lệnh: `web/src/components/chart/OrderTicket.tsx` (aria-label `Place order`, `Enable Take profit` / `Enable Stop loss`, `Take profit price`, `Stop loss price`), nút header: `web/src/components/chart/TradeWidget.tsx` (`Sell at market` / `Buy at market`, chỉ mở bảng). Nếu UI đổi, đọc lại hai file này trước khi sửa bước 4.2.
- Alert `gt` nổ ở tick đầu vì `hit("gt")` chỉ so `giá > mức` (xem `backend/app/alerts.py`). Kết quả gửi từng kênh nằm ở `results` của `GET /alerts/log`.
- Giờ giao dịch vàng mở lại 22:00 UTC; `session_start()` trong script lấy mốc đó để tính CVD phiên.
