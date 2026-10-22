# Lịch kinh tế từ MT5 (thay widget TradingView)

Ngày: 2026-10-22. Lý do: widget TradingView (script `s3.tradingview.com` + iframe `www.tradingview-widget.com`) bị DNS của nhà mạng chặn từng lúc (trả 127.0.0.1). Hướng chọn: EA đọc lịch có sẵn của MT5,
backend cache SQLite, web tự vẽ.

## Luồng
1. **EA TVBridge ≥ 2.15** (`PostCalendar`): `CalendarValueHistory` cho cửa sổ [now − CalendarDaysBack, now + CalendarDaysAhead] (mặc định 1 / 14 ngày), mỗi sự kiện kèm
   `CalendarEventById` (tên, mức quan trọng, đơn vị, hệ số, digits, time_mode) và `CalendarCountryById` (mã nước, tiền tệ). Gửi thông điệp `calendar` {from, to, events[]} lúc kết nối rồi mỗi
   `CalendarRefreshSec` (300s); lịch MT5 chưa đồng bộ (lỗi / rỗng) thì KHÔNG gửi và thử lại sau 30s. Giờ MT5 (giờ server) đổi sang UTC bằng `ToUtc` như mọi thời gian khác.
   Tắt bằng input `SendCalendar=false`. **Cần biên dịch lại (F7) và gắn lại EA.**
2. **Backend** `app/economic.py`: bảng `calendar_events` trong `meta.sqlite` (KHÔNG thuộc `TABLES` vì CRUD generic của chúng mở cho ai cũng ghi). `ingest` thay sạch sự kiện trong cửa sổ EA
   gửi (sự kiện bị huỷ biến mất), giữ lịch cũ hơn cửa sổ tới 45 ngày, danh sách rỗng không xoá gì. `GET /calendar?from&to&min_importance&currencies` công khai, chỉ đọc, kèm `updated_at`
   và `ea {online, version, supports}` để web giải thích khi chưa có dữ liệu.
3. **Web**: `store/calendar.ts` (kho dùng chung + prefs), `lib/calendarFormat.ts` (định dạng, nhóm ngày, lọc, rút gọn tên kiểu Forex Factory), `EconomicCalendarPanel` (bảng ở thanh phải),
   `CalendarMarkers` (cờ nước sát trục thời gian trên chart, bấm ra chi tiết), Settings > Events (bật/tắt + mức quan trọng tối thiểu).

## Quyết định của người dùng
- Chỉ vẽ lịch SẮP TỚI (sự kiện đã qua không hiện ở cả bảng lẫn chart).
- Không đánh số khi gộp nhiều sự kiện cùng chỗ; bấm vào là xem hết.
- Tên sự kiện rút gọn như Forex Factory (`shortEventName`); tên đầy đủ nằm ở `title`.

## Chưa kiểm chứng
- EA chưa được biên dịch / chạy trên MT5 thật (không có headless compile): các hàm Calendar* và `MqlCalendarValue.Has*Value/Get*Value` theo tài liệu MQL5. Nếu broker / bản MT5 trên Wine
  không có lịch, EA log "lich kinh te ... rong" và bảng báo "EA chưa gửi lịch".
- Giờ sự kiện đổi sang UTC bằng chênh lệch HIỆN TẠI của server (lệch tối đa 1 giờ nếu sự kiện nằm sau ngày đổi giờ mùa hè).
