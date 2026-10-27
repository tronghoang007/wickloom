# Cách xem CVD, Big Trades, Footprint, SVP, VRVP

Năm công cụ cùng đọc tick của MT5 nhưng trả lời năm câu hỏi khác nhau. Tài liệu này nói cách mở, cách đọc và giới hạn của từng cái, cho vàng (XAUUSDm) intraday. Cập nhật 2026-10-26.

| Công cụ | Trả lời câu hỏi | Dùng để | Mở từ |
|---|---|---|---|
| CVD | Bên mua hay bán đang chủ động trong phiên? | Xác nhận xu hướng, bắt phân kỳ và hấp thụ | Indicators |
| Big Trades | Mức giá nào có nhiều tick dồn lại? | Tìm vùng bị phòng thủ hoặc hấp thụ | Indicators |
| Footprint | Trong nến này, mỗi mức giá bên nào thắng? | Xác nhận tại vùng: imbalance, hấp thụ, kiệt sức | Menu loại chart → Volume footprint |
| SVP | Giá được chấp nhận ở đâu trong từng phiên? | POC, VAH, VAL của phiên trước làm mốc | Indicators |
| VRVP | Giá được chấp nhận ở đâu trong đoạn đang xem? | HVN, LVN của một swing hoặc vài ngày | Indicators |

## Dữ liệu chung (đọc trước)

- Mọi "volume" là **số tick**, vì MT5 CFD không có khối lượng lệnh. Một lệnh lớn và một lệnh nhỏ đều tính 1 tick.
- Mua/bán tách theo **tick rule**: giá lên là mua, giá xuống là bán, giá bằng nhau giữ hướng trước. Không có order book.
- Backend giữ tick **14 ngày**. Chart cũ hơn mức đó thì CVD và footprint trống, SVP/VRVP lùi về dùng nến (không báo).
- Số tuyệt đối không khớp TradingView hay sàn futures. Đọc hình dạng và tương quan hai bên, đừng đọc như số lot.
- Vàng nghỉ 1 giờ mỗi ngày, 21:00–22:00 UTC (04:00–05:00 giờ VN). Sau 01/11/2026 (Mỹ hết giờ mùa hè) giờ nghỉ dời sang 22:00–23:00 UTC.

## 1. CVD (Cumulative Volume Delta)

CVD cho biết bên chủ động nào đang thắng trong phiên: đi lên là mua chủ động nhiều hơn, đi xuống là bán nhiều hơn. Nó hiện thành pane riêng dưới chart, vẽ bằng nến: open là giá trị cuối nến trước, high/low gồm cả đỉnh/đáy tích lũy bên trong nến.

**Cách thêm.** Mở Indicators, chọn CVD (gần cuối nhóm Technicals). CVD chỉ có chế độ 1 tick nên không cần chọn nguồn dữ liệu.

**Cách đọc**

- Giá và CVD cùng đi một hướng: xu hướng có lực thật.
- Giá tạo đỉnh mới nhưng CVD thấp hơn đỉnh CVD trước: phân kỳ giảm, lực mua yếu dần. Đáy mới mà CVD cao hơn đáy trước thì ngược lại.
- Giá đứng yên mà CVD giảm mạnh: bên bán chủ động đang bị lệnh chờ mua hấp thụ. Giá chưa xuống nghĩa là có người chặn ở đó.

**Reset theo phiên.** CVD về 0 mỗi phiên, nên chỉ so sánh trong cùng một phiên. Mặc định Session start là "After break": vàng reset lúc 22:00 UTC (05:00 giờ VN), ngay sau giờ nghỉ. "After break" tự theo giờ nghỉ khi đổi giờ mùa hè; "Custom hour" thì phải sửa tay. "Broker midnight" cắt lúc 00:00 giờ sàn.

**Lưu ý**

- Từ H4 trở lên chart không thấy giờ nghỉ 1 giờ nên CVD reset lúc 00:00 giờ sàn. Với vàng dùng M1–H1.
- Legend hiện giá trị của nến đang rê chuột, không phải nến mới nhất.
- Có realtime theo từng tick (đã kiểm tra trên BTC; vàng đóng cửa lúc kiểm tra).

## 2. Big Trades

Mỗi bong bóng là **nhiều tick dồn vào một hàng giá trong một phút**, không phải một lệnh đơn lẻ. Bong bóng càng to thì số tick ở hàng đó càng nhiều; con số bên trong là số tick. Xanh là bên mua, đỏ là bên bán.

**Cách thêm.** Mở Indicators, chọn Big Trades. Bong bóng nằm trên chart chính.

**Cách đọc**

- Bong bóng to tại một mức mà giá dừng hoặc quay lại: vùng bị phòng thủ hoặc hấp thụ.
- Nhiều bong bóng cùng một mức: mức đó có hoạt động lớn, thường thành hỗ trợ/kháng cự khi giá quay lại.
- Bong bóng cùng hướng với cú phá vỡ: bên đó đang đẩy chủ động.
- Bong bóng đảo màu liên tục quanh một mức: hai bên giằng co, chờ bên nào thắng.

**Cài đặt hay chỉnh**

- Maximum bubbles (mặc định 100): số bong bóng tối đa trong vùng đang xem. Thấy rối thì giảm, hoặc tăng Minimum volume (mặc định 0).
- Price grouping (ticks): gộp bao nhiêu tick thành một hàng giá. Mặc định 0 = tự chọn, hàng bằng khoảng 1/20 biên độ nến trung vị (vàng: 0.5 trên M15, 0.2 trên M5, 0.05 trên M1). Hàng quá nhỏ thì bong bóng không đủ tick để hiện.
- Show volume (mặc định bật): bật/tắt số bên trong.
- Minimum size / Maximum size (5 / 50 px): đường kính bong bóng nhỏ nhất/lớn nhất.

**Lưu ý**

- Kích thước giữ nguyên khi zoom; bong bóng chỉ xuất hiện khi vào top N của vùng đang xem.
- Công cụ thiên về lúc giá đi chậm hoặc đi ngang (nhiều tick ở cùng một hàng), không bắt tốt cú chạy nhanh.
- Trên M5/M15, các phút trong cùng một nến được rải theo chiều ngang nến; bong bóng trùng hàng giá thì chỉ giữ một số cho dễ đọc.
- Realtime: bong bóng mới chỉ hiện khi hàng của phút đang chạy vượt ngưỡng top N, nên hiếm. Đó không phải lỗi.

## 3. Footprint

Footprint chia mỗi nến thành các hàng giá và cho thấy bên mua/bán thắng ở từng hàng.

**Cách mở.** Menu loại chart trên toolbar → Volume footprint. Chart chuyển sang candles và tự thêm indicator `footprint`; chọn loại chart khác thì indicator bị gỡ. Cũng có thể thêm `footprint` từ Indicators mà không đổi loại chart.

**Điều kiện thấy số**

- Zoom đủ gần: từ khoảng 30 px/nến mới có chữ; ở 11 px/nến ô quá nhỏ.
- Dưới 150 nến trên màn hình. Nhiều hơn thì chỉ vẽ nến thường và không tải tick.
- Dùng M1–M5.

**Cách đọc một ô.** Mỗi hàng giá có hai số ở giữa ô: sell bên trái, buy bên phải (kiểu ATAS, không có chữ "x"). Ô tô màu theo bên chiếm ưu thế.

**Bốn thứ nhìn theo thứ tự**

1. **Imbalance**: số được tô màu khi một bên ≥ 300% bên đối diện theo đường chéo (buy ở hàng này so với sell ở hàng dưới nó). **Stacked imbalance** là nhiều hàng liên tiếp cùng phía, vạch 2 px ở mép ô; số hàng chỉnh trong Settings. Imbalance lẻ ít ý nghĩa.
2. **POC**: hộp cam, hàng có nhiều tick nhất trong nến. POC sát đáy hoặc đỉnh nến cho thấy nến bị đẩy một chiều; nằm giữa là cân bằng.
3. **Delta** (buy − sell) và tổng nằm trong Info box dưới nến. Delta cùng chiều nến là khỏe; ngược chiều nến là bất thường.
4. **Value area**: hai đường nét đứt xanh ở VAH và VAL, chứa khoảng 70% tick của nến.

**Các mẫu hay dùng**

| Mẫu | Trông như thế nào | Ý nghĩa |
|---|---|---|
| Hấp thụ | Delta rất âm (hoặc rất dương) mà giá không đi tiếp, râu nến dài | Lệnh chủ động bị lệnh chờ chặn, dễ đảo chiều |
| Kiệt sức | Đỉnh/đáy nến mỏng, hàng cuối gần trống | Hết lực đẩy, giá hay quay lại |
| Delta phân kỳ | Giá đỉnh mới nhưng delta thấp hơn nến trước | Lực mua yếu dần |
| Stacked imbalance rồi test lại | Giá quay về vùng stacked rồi bật | Vào theo bên đang áp đảo |
| Hàng trống / single print | Vài hàng gần như không có tick | Giá đi quá nhanh, hay bị lấp lại |

Footprint chỉ có ích **tại vùng quan trọng**: đỉnh/đáy phiên, POC/VAH/VAL, trước và sau tin USD. Ở giữa vùng không có gì thì nó chỉ gây nhiễu.

**Cài đặt hay chỉnh**

| Mục | Mặc định | Ghi chú |
|---|---|---|
| Type | Bid x Ask | Còn Delta, Volume, Delta + Volume. Chỉ Bid x Ask có tô imbalance |
| Mode | Box | Profile là thanh bar |
| Row size | Auto | Trung vị 50 ATR gần nhất, bỏ nến đang chạy, nên hàng không đổi theo tick. Manual: chọn số tick mỗi hàng |
| Imbalance % | 300 | Min diff mặc định 1 |
| Include zero | Tắt | Bật thì 82% (M5) đến 99% (M1) cờ imbalance chỉ vì bên kia bằng 0, do tick rule gán mỗi tick vào một phía. Đừng bật rồi tin các ô imbalance |
| Text size | 14 | Số tự nhỏ lại theo chiều cao hàng |

## 4. SVP (Session Volume Profile)

SVP vẽ một histogram volume theo giá cho **từng phiên**, ngay trên chart.

**Cách thêm.** Mở Indicators, chọn SVP. Mặc định dùng Data aggregation = 1 tick (mỗi tick vào đúng hàng giá của nó).

**Ba mức cần nhìn**

- **POC**: mức có nhiều tick nhất, nơi giá được chấp nhận nhất.
- **VAH / VAL**: biên trên/dưới vùng chứa khoảng 70% volume. Theo luật của TradingView, vùng này dừng ở hoặc ngay dưới 70%, không vượt, nên thường ra 64–69%.
- Các đường POC/VAH/VAL có thể kéo dài sang phải (Extend) cho đến khi một nến cắt qua mức đó. Mức chưa bị cắt là mức còn "chưa kiểm tra".

**Cách dùng**

- Lấy POC/VAH/VAL của **phiên trước** làm mốc cho hôm nay.
- Giá mở trong value area của phiên trước thường đảo qua lại, hướng về phía bên kia của vùng.
- Giá phá khỏi VAH/VAL và được chấp nhận (nến đóng ngoài, quay lại test mà không vào) là dấu hiệu đi tiếp. Phá rồi quay vào lại thường trở về POC.
- Vùng volume dày (HVN) hút giá và làm giá đi ngang. Vùng volume mỏng (LVN) giá chạy qua nhanh và hay có phản ứng tại mép.

**Cài đặt hay chỉnh**

- Session: độ dài phiên (mặc định Day). Session start mặc định "After break", vàng cắt phiên lúc 22:00 UTC (xem mục dữ liệu chung). "Custom hour" tính theo giờ sàn, không phải giờ VN.
- Rows Layout + Row Size: "Number Of Rows" (mặc định 24 hàng) hoặc "Ticks Per Row" (số tick giá mỗi hàng). Bạn đang dùng Ticks Per Row = 240 cho vàng (tick 0.001, vậy mỗi hàng $0.24).
- Volume (mặc định Up/Down): Up/Down, Total, Delta, hoặc Delta + Total (delta bên trái, total bên phải, quanh một trục).
- Value Area Volume: mặc định 70%.
- Extend POC/VAH/VAL: mặc định tắt.

**Lưu ý**

- Trên D1 trở lên SVP để trống (chủ ý); dùng VRVP.
- Phiên cũ hơn 14 ngày tính từ nến cuối lùi về dùng nến, không có dấu hiệu nào báo.
- Với phiên đang chạy, vài nến đầu có thể thấy hình dạng nhảy một lúc rồi ổn định.

## 5. VRVP (Visible Range Volume Profile)

VRVP vẽ **một** histogram cho đoạn chart đang nhìn thấy, ghim ở mép phải. Kéo/zoom thì histogram tính lại theo đoạn mới.

**Cách thêm.** Mở Indicators, chọn VRVP. Cách đọc POC, VAH, VAL và HVN/LVN giống SVP.

| | SVP | VRVP |
|---|---|---|
| Phạm vi | Mỗi phiên một profile | Một profile cho cả đoạn đang xem |
| Vị trí | Gắn vào từng phiên | Ghim mép phải, đường POC/VAH/VAL chạy hết pane |
| Khi kéo/zoom | Giữ nguyên | Tính lại |
| Dùng khi | Mốc ngày/phiên | Một swing, một tuần, vùng tích lũy dài |

**Cách dùng**

- Zoom đúng đoạn muốn xem (một swing, vài ngày), rồi đọc POC và các HVN/LVN trong đó.
- So POC của VRVP vài ngày với POC của SVP hôm qua: hai mức gần nhau thì mức đó mạnh hơn.

**Lưu ý**

- Histogram Box không dùng được với VRVP (theo TradingView).
- Đoạn nhìn thấy dài quá 14 ngày hoặc trên D1 thì VRVP dùng nến thay vì tick.

## 6. Kết hợp cho vàng intraday

1. **Trước phiên**: đánh dấu POC/VAH/VAL của SVP phiên trước và các HVN/LVN trên VRVP vài ngày gần nhất. Đó là các vùng chờ.
2. **Đặt alert** ở mép gần các vùng đó (web + Telegram + MT5 push, hết hạn 22:00 giờ VN). `/xau-orderflow-intraday` làm bước 1–2 tự động.
3. **Khi alert nổ**: chuyển M1–M5 và mở checklist `docs/xau-orderflow-checklist.md`. Trong đó dùng CVD (phân kỳ, hấp thụ), Big Trades (bong bóng lớn tại vùng) và Footprint (hấp thụ, kiệt sức, stacked imbalance).
4. **Vào lệnh khi có ít nhất một dấu hiệu xác nhận**, tốt nhất là hấp thụ cộng phân kỳ CVD. SL đặt ngoài vùng bị hấp thụ hoặc ngoài mức làm kịch bản sai.
5. **Đứng ngoài** nếu giá xuyên vùng cùng delta và CVD mà không bị hấp thụ, hoặc đang sát giờ tin USD.

## Giới hạn cần nhớ

- Tick count và tick rule nhiễu: chỉ so sánh tương đối (cùng phiên, cùng vùng), không so với số của sàn khác.
- Tick tối đa 14 ngày; cuối tuần và giờ nghỉ của vàng không có dữ liệu.
- Big Trades và Footprint thiên về lúc giá đi chậm; ít cho thấy cú chạy nhanh.
- Chưa có: Ladder và bảng tổng kết cho Footprint, Developing POC/VA cho SVP/VRVP, alert theo footprint.
- Không phải lời khuyên đầu tư.
