import type { TradeData } from "@/lib/mt5Api";

/** Lệnh chờ `order:<ticket>` vừa khớp: MT5 giữ nguyên ticket cho vị thế mở ra từ nó, nên lệnh biến mất khỏi danh sách mà vị thế cùng ticket xuất hiện. Trả về chủ lệnh mới
 *  ("position:<ticket>") để bảng Modify đổi sang vị thế (có thanh đóng một phần) thay vì đóng lại; không phải trường hợp đó thì null. */
export function filledAs(owner: string, data: TradeData): string | null {
  const [kind, tk] = owner.split(":");
  if (kind !== "order") return null;
  const ticket = Number(tk);
  if (data.orders.some((o) => o.ticket === ticket)) return null;
  return data.positions.some((p) => p.ticket === ticket) ? `position:${ticket}` : null;
}
