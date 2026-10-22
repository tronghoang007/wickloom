# TradingView: giao dịch trên chart (Paper Trading) - số liệu đã chụp

Chụp 2026-10-22 trên tab TV thật của người dùng (layout BTISRWLF, Paper Trading, Gold Spot / OANDA, 15m). Chỉ dùng bản nháp lệnh và Settings, KHÔNG đặt / sửa lệnh nào. Dùng để làm
`web/src/components/chart/TradeOverlay.tsx`, `OrderTicket.tsx`, `TradeWidget.tsx` (docs/trade-plan.md).

## Thẻ trên chart (DOM-like, nằm lệch trái khỏi trục giá ~66px, "Order and position alignment: Right")

- **Bản nháp** (chưa đặt): đường giá **nét đứt** màu hướng (Buy xanh dương `#2962ff`, Sell đỏ `#f23645`), thẻ gồm `[Buy]` (nút đặc, chữ trắng, bo 4px, cao ~22px) `[TP]` `[SL]` (nút mờ,
  viền chấm, chữ xanh lá / cam) rồi `[lot | loại lệnh | ×]` (3 ô ngăn bằng vạch dọc, viền + chữ màu hướng, nền tối trong suốt). Nhãn trục giá: ô viền màu hướng.
- **Lệnh đã đặt**: đường **liền**, cùng thẻ nhưng không có nút `Buy` và mờ hơn thì thôi; chỉ còn nút mờ cho mức chưa có (đã có TP thì chỉ còn `SL`). Vị thế: thẻ `[lot | lãi/lỗ USD | ×]`.
- **TP** xanh lá `#089981`, **SL** cam `#ff9800` (không phải đỏ), đường **chấm chấm**, thẻ `[lot | +17.36 USD | ×]` (lãi/lỗ dự kiến theo tiền, Settings "Profit and loss value: Brackets = Money"), nhãn trục
  cùng màu.
- Các mức của một lệnh nối bằng **đường dọc nét đứt** ở bên phải thẻ, đầu mỗi mức có vòng tròn (giá vào đặc, TP/SL rỗng).
- **Kéo nút TP / SL mờ ra giá cần đặt** = tạo TP/SL ở giá đó (bấm không kéo thì không có gì). Kéo thẻ / đường để sửa mức. Panel phải đổi theo: `Take profit price` + `ticks`, `Risk / Reward 8.41`.
- Hover vùng trục giá hiện nút `+` (menu đặt lệnh nhanh) và hai nút `A` / `L` (auto / log scale).

## Xác nhận khi sửa / huỷ (One-click trading TẮT) - chụp thật trên TV, có đặt 1 lệnh paper Buy limit xa giá rồi huỷ

- Đặt từ nút `Buy` của bản nháp thì **đặt ngay**, không hỏi (toast "Limit order placed on OANDA:XAUUSD Buy 1 at ...").
- Kéo nút `TP`/`SL` mờ ra giá, hoặc kéo thẻ / đường SL, TP, giá của lệnh ĐÃ đặt: thẻ lệnh chủ hiện **`[Discard]` (nền tối, viền xám, chữ trắng) và `[Confirm]` (xanh `#2962ff`, chữ trắng)** nằm
  TRƯỚC các nút mờ còn lại: `[Discard][Confirm][SL][1 | Buy limit | ×]`. Thẻ đang sửa **mờ đi** ở giá mới (`+16.88 USD`), có đường nối dọc. Discard trả về như cũ; Confirm gửi (đường biến mất vài giây
  rồi hiện lại khi sàn trả về).
- Bấm × trên thẻ lệnh chờ mở hộp thoại **"Cancel order"**: logo + `OANDA:XAUUSD` + `Buy Limit 1 @ 4,069.871`, hai nút `[Keep order]` (viền) và `[Cancel order]` (trắng).
- Giữ Shift khi kéo = kéo cả nhóm (toast gợi ý của TV).
- Menu nút `+` ở trục giá: Add alert / `Buy 1 XAUUSD @ giá limit` (Alt+Shift+B) / `Sell 1 @ giá stop` / `Add order on ...` (Shift+T) / Draw horizontal line; chọn Buy / Sell ở đây chỉ tạo bản nháp có nút `Buy`.

## Panel Order bên phải

- Tab `Order | DOM`. Hai ô Sell | Buy: nhãn nhỏ ở trên ("Sell" trái, "Buy" phải), giá lớn bên dưới, **ô đang chọn tô màu, ô kia xám**; **chip spread (pip, "45.0") nằm giữa**. Giá hiển thị 4,087.44 + chữ số cuối (pipette) nhỏ nâng lên.
- Tab `Market | Limit | Stop` gạch chân trắng. Nhãn trên ô nhập (`Price`, `Units`), ô nhập bo tròn, nút swap ⇄ và gợi ý bên phải (`Ask − 420`, `81.75 USD`).
- Khối thông tin nền xám: Trade value (50x), Available margin, Tick value.
- `Exits`: `Take profit price ▾` + **công tắc**, ô giá + ⇄ + `14935 ticks`; `Stop loss price` tương tự; `Risk / Reward`; `+ Add level`; `Extra settings`: Time in force (Week).
- Nút đặt lệnh dưới cùng hai dòng: `Buy` / `1 XAUUSD @ 4,087.470 STOP`.
- Đổi giá vào qua mốc thị trường thì nút Buy chuyển enabled / disabled (hợp lệ theo Stop / Limit); TV bắt người dùng chọn tab Limit hay Stop, Wickloom **tự suy ra** từ giá.

## Settings > Trading

`Buy/sell buttons` (bật) | `One-click trading` (**tắt**: đặt, sửa, huỷ, đóng đều hỏi xác nhận) | `Multiple exit levels` (tắt) | `Positions and orders` + `Reverse position button` | `Project order for
market orders` (bật: hiện lệnh market dự kiến trên chart trước khi gửi) | `Profit and loss value` (Positions = Money, Brackets = Money) | `Extended price lines across the entire chart width` (bật) |
`Order and position alignment: Right`.

## Khác biệt có chủ ý của Wickloom

- Limit / Stop tự suy ra; kéo đường qua giá thị trường đổi loại và nhãn.
- Nút Buy/Sell của bản nháp đặt **ở cuối bên phải** cụm thẻ (TV để bên trái, sát nút TP/SL nên dễ bấm nhầm).
- Sửa SL/TP bằng kéo áp dụng ngay khi thả + toast "Hoàn tác" (TV tắt one-click thì hỏi xác nhận); đóng vị thế bằng × thì hỏi lại bằng toast.
- Widget SELL | spread | BUY trên chart không có ô lot (lot chỉ ở panel Order).
