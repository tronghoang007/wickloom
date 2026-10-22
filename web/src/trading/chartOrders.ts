import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { PendingOrder } from "@/lib/mt5Api";
import { drawingGlobal } from "@/drawings/store";
import { chartGlobal } from "@/store/chart";
import { useAuthStore } from "@/store/auth";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { moveOrder } from "./actions";
import { isStale, orderLabel, type DragPreview } from "./format";
import { tradeBlock } from "./gate";
import { OrderDrag } from "./orderDrag";
import { isPendingType, pendingLabel, resolveOrderType, sideOfType, tooClose } from "./orderType";
import { useQuoteStore } from "./quote";
import { useTradeStore } from "./store";

type Opts = {
  chart: IChartApi;
  container: HTMLElement;
  listenOn: HTMLElement;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getSymbol: () => string;
  getDigits: () => number;
  isReplay: () => boolean;
  setPreview: (p: DragPreview | null) => void;
};

/** Lắp OrderDrag cho một chart: lệnh chờ của symbol đang xem kéo được khi giao dịch được (khách / real / EA tắt / đang Replay / đang chọn công cụ vẽ thì không).
 *  Thả tay: kiểm tra vùng cấm của broker rồi `moveOrder` (cùng loại → sửa giá; qua giá thị trường → đặt mới đúng loại rồi xoá cũ). */
export function createOrderDrag(o: Opts): OrderDrag {
  const symbolInfo = () => chartGlobal.getState().symbols.find((s) => s.name === o.getSymbol());
  const labelAt = (order: PendingOrder, price: number) => {
    const q = useQuoteStore.getState().quotes[order.symbol];
    const t = isPendingType(order.type) && q ? resolveOrderType(sideOfType(order.type), price, q.bid, q.ask) : null;
    return t ? pendingLabel(t) : orderLabel(order.type);
  };
  return new OrderDrag({
    chart: o.chart,
    container: o.container,
    listenOn: o.listenOn,
    getSeries: o.getSeries,
    getOrders: () => {
      const d = useTradeStore.getState().data;
      if (!d || isStale(d, Date.now() / 1000)) return [];
      const symbol = o.getSymbol();
      return d.orders.filter((x) => x.symbol === symbol && x.price_open > 0 && isPendingType(x.type));
    },
    canDrag: () => {
      if (o.isReplay() || drawingGlobal.getState().tool) return false;
      const status = useAuthStore.getState().status;
      const account = useMt5Store.getState().accounts.find((a) => a.active);
      return status === "user" && tradeBlock({ replay: false, status, loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true }) === null;
    },
    digits: o.getDigits,
    tickSize: () => symbolInfo()?.tick_size || 10 ** -o.getDigits(),
    labelAt,
    onPreview: o.setPreview,
    onDrop: (order, price) => {
      const q = useQuoteStore.getState().quotes[order.symbol];
      const t = isPendingType(order.type) && q ? resolveOrderType(sideOfType(order.type), price, q.bid, q.ask) : null;
      const level = symbolInfo()?.stops_level;
      if (t && q && tooClose(t, price, q.bid, q.ask, level, o.getDigits())) {
        toast(`Quá gần giá thị trường (tối thiểu ${level} điểm)`, { ms: 6000 }); // không âm thầm đổi sang market
        o.setPreview(null);
        return;
      }
      o.setPreview({ ticket: order.ticket, price, label: labelAt(order, price) }); // giữ đường ở giá mới trong lúc chờ sàn
      void moveOrder(order, price, o.getDigits()).then((ok) => {
        if (!ok) o.setPreview(null);
        else setTimeout(() => o.setPreview(null), 1500); // đủ thời gian để dữ liệu lệnh mới của EA về
      });
    },
  });
}
