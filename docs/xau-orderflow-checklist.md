# Checklist khi giá chạm vùng đã vẽ (XAUUSDm, intraday)

Dùng cho mọi vùng do `/xau-orderflow` tạo (hình `xau-of-*` + alert tên `XAU …`). Alert nổ ở **mép gần** của vùng: mép dưới vùng đỏ (Supply) hoặc mép trên vùng xanh (Demand). Lúc đó mới **bắt đầu quan sát**, chưa phải lúc vào lệnh.

Quyết định vào lệnh, SL/TP và khối lượng là của bạn. Skill chỉ chọn vùng và đặt alert, không đặt lệnh hộ.

## 1. Ngay khi alert nổ (10 giây)

- [ ] Đọc tên và nội dung alert: cơ sở của vùng (POC/VAH/hấp thụ…), điều kiện xác nhận, mức làm kịch bản sai.
- [ ] Xác định Supply (đỏ, giá đi lên chạm) hay Demand (xanh, giá đi xuống chạm).
- [ ] Còn trước 22:00 giờ VN không? Hết giờ thì không vào.
- [ ] Có tin USD mức ≥2 gần giờ này không? Vùng quanh giờ tin kém tin cậy.

## 2. Bối cảnh

- [ ] Giá đang trên, trong hay dưới value area hôm nay và phiên trước?
- [ ] Vào cùng hay ngược xu hướng intraday? Ngược xu hướng thì đòi xác nhận mạnh hơn.

## 3. Mở footprint / CVD và chờ phản ứng tại vùng

| | Supply (bán) | Demand (mua) |
|---|---|---|
| Hấp thụ | Delta dương, tick ≥2× bình thường mà giá không vượt lên được | Delta âm, tick ≥2× bình thường mà giá không xuống thêm |
| CVD | Giá lên đỉnh mới mà CVD thấp hơn đỉnh CVD trước (phân kỳ giảm) | Giá xuống đáy mới mà CVD cao hơn (phân kỳ tăng) |
| Giá sau đó | Bị đẩy ngược xuống, khoảng ≥10 điểm trong ~15 phút | Bật lên, khoảng ≥10 điểm trong ~15 phút |

- [ ] Có ít nhất một dấu hiệu xác nhận ở trên, tốt nhất là hấp thụ cộng phân kỳ.

## 4. Dấu hiệu vùng không giữ (đứng ngoài hoặc đổi kịch bản)

- [ ] Giá xuyên vùng với delta cùng hướng và tick lớn không bị hấp thụ.
- [ ] CVD tạo đỉnh/đáy mới cùng với giá (không có phân kỳ).
- [ ] Giá chạm mức làm kịch bản sai ghi trong alert.
- [ ] Giá quét qua vùng rồi lấy lại có thể là bẫy: nhìn orderflow thêm, nhất là ở đáy/đỉnh cực trị của lịch sử dữ liệu.

## 5. Trước khi vào lệnh

- [ ] SL đặt ngoài mức làm kịch bản sai, khoảng cách đó chấp nhận được.
- [ ] Khối lượng và TP do bạn quyết.

## 6. Sau đó

- [ ] Alert `trigger: once` nổ một lần rồi thôi. Muốn theo dõi tiếp thì dùng vùng còn lại hoặc đặt alert mới.
- [ ] Alert hết hạn lúc 22:00 VN, nhưng hình chữ nhật không tự mất. Hôm sau chạy lại `/xau-orderflow` để thay bộ vùng mới.

## Lưu ý

- Checklist chung cho mọi vùng. Phần riêng từng vùng (mức giá, lý do, mức làm kịch bản sai) nằm trong alert.
- Các ngưỡng (≥2×, ≥10 điểm, ~15 phút) chỉnh theo vàng và chỉ là mức tham chiếu, không phải quy tắc cứng. Symbol khác phải chỉnh lại.
- Volume là tick count của CFD, delta theo tick-rule nhiễu: chỉ so sánh tương đối (cùng phiên, cùng vùng).
- Không phải lời khuyên đầu tư.
