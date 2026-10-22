import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { PendingOrder, Position } from "@/lib/mt5Api";
import { drawingGlobal } from "@/drawings/store";
import { chartGlobal } from "@/store/chart";
import { useAuthStore } from "@/store/auth";
import { useSettingsStore } from "@/store/settings";
import { useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { moveOrder, moveStop } from "./actions";
import { DRAFT_IDS, defaultStop, draftLines, parseNum } from "./draft";
import { fmtLot, isStale, orderLabel, type DragPreview, type StopTitleFn, type TagOwner } from "./format";
import { tradeBlock } from "./gate";
import { LineDrag } from "./lineDrag";
import { checkStopMove, isPendingType, pendingLabel, resolveOrderType, sideOfType, tooClose } from "./orderType";
import { estimatePnl, fmtPnlCcy, pnlSpec, stopTitle } from "./pnl";
import { useQuoteStore } from "./quote";
import { seedDraftStop } from "./submit";
import { useTradeStore } from "./store";
import { useTicketStore } from "./ticket";

/** Nhãn đường SL/TP kèm lãi/lỗi dự kiến theo tiền account (đọc store lúc gọi, nên dùng được cho mọi chart). */
export function makeStopTitle(): StopTitleFn {
  return (kind, side, lot, entry, price, symbol) => {
    const sym = chartGlobal.getState().symbols.find((s) => s.name === symbol);
    const ccy = useMt5Store.getState().accounts.find((a) => a.active)?.currency ?? "";
    return stopTitle(kind, side, lot, entry, price, pnlSpec(sym, ccy), ccy);
  };
}

/** Đang được sửa / huỷ / đóng lệnh trên chart không: đã đăng nhập, account demo, EA bật giao dịch. Khách / real / EA tắt thì chỉ xem (bản nháp vẫn kéo được). */
export function canModifyTrades(): boolean {
  const status = useAuthStore.getState().status;
  const account = useMt5Store.getState().accounts.find((a) => a.active);
  return status === "user" && tradeBlock({ replay: false, status, loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true }) === null;
}

export type ChartDrag = { destroy: () => void; beginStop: (owner: TagOwner, kind: "sl" | "tp", e: PointerEvent) => void; confirmEdit: () => void; cancelEdit: () => void };

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

const STOP_ID = /^(psl|ptp|osl|otp):(\d+)$/;

/** Lắp LineDrag cho một chart. Kéo được: (1) entry / SL / TP của bảng đặt lệnh đang mở, ghi thẳng vào bản nháp; (2) khi giao dịch được (khách / real / EA tắt đều không): đường lệnh chờ
 *  (thả tay → `moveOrder`: cùng loại sửa giá, qua giá thị trường thì đặt mới đúng loại rồi xoá cũ) và đường SL/TP của vị thế / lệnh chờ (thả tay → `moveStop`, có "Hoàn tác").
 *  Mọi chỗ thả đều kiểm tra phía + vùng cấm của broker trước khi gửi. Đang Replay hoặc đang chọn công cụ vẽ thì không kéo gì. */
export function createLineDrag(o: Opts): ChartDrag {
  const stopTitleFn = makeStopTitle();
  const symbolInfo = () => chartGlobal.getState().symbols.find((s) => s.name === o.getSymbol());
  const tradeData = () => {
    const d = useTradeStore.getState().data;
    return d && !isStale(d, Date.now() / 1000) ? d : null;
  };
  const ordersHere = (): PendingOrder[] => tradeData()?.orders.filter((x) => x.symbol === o.getSymbol() && x.price_open > 0 && isPendingType(x.type)) ?? [];
  const positionsHere = (): Position[] => tradeData()?.positions.filter((x) => x.symbol === o.getSymbol() && x.type !== "other") ?? [];
  const canMove = canModifyTrades;
  const labelAt = (order: PendingOrder, price: number) => {
    const q = useQuoteStore.getState().quotes[order.symbol];
    const t = isPendingType(order.type) && q ? resolveOrderType(sideOfType(order.type), price, q.bid, q.ask) : null;
    return t ? pendingLabel(t) : orderLabel(order.type);
  };
  const orderOf = (ticket: number) => ordersHere().find((x) => x.ticket === ticket);
  // Kéo đường giá vào của bản nháp Market đi chỗ khác thì bản nháp thành lệnh chờ ở giá đó (Limit / Stop tự suy ra theo phía so với thị trường); huỷ kéo (Esc) thì trả về Market
  let wasMarket = false;
  const patchDraft = (id: string, price: number | null, from?: number) => {
    const field = DRAFT_IDS[id];
    const v = price ?? from;
    if (!field || v === undefined) return;
    const { draft, patch } = useTicketStore.getState();
    if (field === "price" && draft?.mode === "market") {
      if (price === null) return; // chưa dời đi đâu
      wasMarket = true;
      return patch({ mode: "pending", price: v.toFixed(o.getDigits()) });
    }
    if (field === "price" && price === null && wasMarket) {
      wasMarket = false;
      return patch({ mode: "market", price: "" });
    }
    patch({ [field]: v > 0 ? v.toFixed(o.getDigits()) : "" });
  };

  // Đường SL/TP đang kéo -> thông tin vị thế / lệnh chứa nó (nguồn: dữ liệu EA báo gần nhất)
  const stopOf = (id: string) => {
    const m = STOP_ID.exec(id);
    if (!m) return null;
    const ticket = Number(m[2]);
    const field = m[1].endsWith("sl") ? ("sl" as const) : ("tp" as const);
    if (m[1][0] === "p") {
      const p = positionsHere().find((x) => x.ticket === ticket);
      return p ? { target: "position" as const, ticket, field, symbol: p.symbol, side: p.type as "buy" | "sell", lot: p.volume, entry: p.price_open, from: field === "sl" ? p.sl : p.tp } : null;
    }
    const od = orderOf(ticket);
    return od && isPendingType(od.type) ? { target: "order" as const, ticket, field, symbol: od.symbol, side: sideOfType(od.type), lot: od.volume, entry: od.price_open, from: field === "sl" ? od.sl : od.tp } : null;
  };

  // Sửa lệnh đã đặt bằng kéo thả (SL/TP, giá lệnh chờ): thả tay xong, nếu One-click trading (Settings > Trading) đang tắt thì đường DỪNG ở giá mới và thẻ hiện ✓ / ✕ (như TradingView khi tắt one-click);
  // bấm ✓ (hoặc Enter trên thẻ) mới gửi, ✕ / Esc / kéo đường khác thì trả về giá cũ. Bật One-click thì gửi ngay khi thả.
  let pending: { preview: DragPreview; run: () => Promise<boolean> } | null = null;
  const finish = (p: Promise<boolean>) =>
    void p.then((ok) => {
      if (!ok) o.setPreview(null);
      else setTimeout(() => o.setPreview(null), 1500); // đủ thời gian để dữ liệu mới của EA về
    });
  const settle = (preview: DragPreview, run: () => Promise<boolean>) => {
    if (!useSettingsStore.getState().s.oneClick) {
      pending = { preview, run };
      o.setPreview({ ...preview, pending: true });
      return;
    }
    o.setPreview(preview); // giữ đường ở giá mới trong lúc chờ sàn
    finish(run());
  };
  const confirmEdit = () => {
    const p = pending;
    if (!p) return;
    pending = null;
    o.setPreview(p.preview);
    finish(p.run());
  };
  const cancelEdit = () => {
    if (!pending) return;
    pending = null;
    o.setPreview(null);
  };
  const onEsc = (e: KeyboardEvent) => e.key === "Escape" && cancelEdit();
  window.addEventListener("keydown", onEsc);

  const drag = new LineDrag({
    chart: o.chart,
    container: o.container,
    listenOn: o.listenOn,
    getSeries: o.getSeries,
    getTargets: () => {
      if (o.isReplay() || drawingGlobal.getState().tool) return [];
      const symbol = o.getSymbol();
      const quote = useQuoteStore.getState().quotes[symbol];
      const draft = draftLines(useTicketStore.getState().draft, symbol, quote).map((l) => ({ id: l.key, price: l.price }));
      if (!canMove()) return draft;
      const orders = ordersHere().flatMap((x) => [
        { id: `o:${x.ticket}`, price: x.price_open },
        ...(x.sl > 0 ? [{ id: `osl:${x.ticket}`, price: x.sl }] : []),
        ...(x.tp > 0 ? [{ id: `otp:${x.ticket}`, price: x.tp }] : []),
      ]);
      const positions = positionsHere().flatMap((x) => [
        ...(x.sl > 0 ? [{ id: `psl:${x.ticket}`, price: x.sl }] : []),
        ...(x.tp > 0 ? [{ id: `ptp:${x.ticket}`, price: x.tp }] : []),
      ]);
      return [...draft, ...orders, ...positions];
    },
    digits: o.getDigits,
    tickSize: () => symbolInfo()?.tick_size || 10 ** -o.getDigits(),
    onMove: (id, price) => {
      if (id in DRAFT_IDS) return patchDraft(id, price);
      if (pending && pending.preview.key !== id) pending = null; // kéo đường khác: thay đổi đang chờ xác nhận bị bỏ
      const stop = stopOf(id);
      if (stop) return o.setPreview({ key: id, price, title: stopTitleFn(stop.field, stop.side, stop.lot, stop.entry, price, stop.symbol) });
      const order = orderOf(Number(id.slice(2)));
      if (order) o.setPreview({ key: id, price, title: `${labelAt(order, price)} ${fmtLot(order.volume)}`.toUpperCase(), label: labelAt(order, price) });
    },
    onAbort: (id, from) => {
      if (id in DRAFT_IDS) return patchDraft(id, null, from); // trả ô nhập về giá cũ
      pending = null;
      o.setPreview(null);
    },
    onDrop: (id, price) => {
      if (id in DRAFT_IDS) {
        wasMarket = false; // bản nháp đã nhận giá mới lúc kéo
        return;
      }
      const digits = o.getDigits();
      const q = useQuoteStore.getState().quotes[o.getSymbol()];
      const stop = stopOf(id);
      if (stop) {
        const why = checkStopMove({ target: stop.target, side: stop.side, kind: stop.field, price, entry: stop.entry, bid: q?.bid ?? 0, ask: q?.ask ?? 0, digits, stopsLevel: symbolInfo()?.stops_level });
        if (why) {
          toast(why, { ms: 6000 });
          return o.setPreview(null);
        }
        const ccy = useMt5Store.getState().accounts.find((a) => a.active)?.currency ?? "";
        const spec = pnlSpec(symbolInfo(), ccy);
        const pnlText = spec ? ` (${fmtPnlCcy(estimatePnl(stop.side, stop.lot, stop.entry, price, spec), ccy)})` : "";
        const preview = { key: id, price, title: stopTitleFn(stop.field, stop.side, stop.lot, stop.entry, price, stop.symbol) };
        return settle(preview, () => moveStop({ target: stop.target, ticket: stop.ticket, symbol: stop.symbol, field: stop.field, from: stop.from }, price, digits, pnlText));
      }

      const order = orderOf(Number(id.slice(2)));
      if (!order) return o.setPreview(null);
      const t = isPendingType(order.type) && q ? resolveOrderType(sideOfType(order.type), price, q.bid, q.ask) : null;
      const level = symbolInfo()?.stops_level;
      if (t && q && tooClose(t, price, q.bid, q.ask, level, digits)) {
        toast(`Quá gần giá thị trường (tối thiểu ${level} điểm)`, { ms: 6000 }); // không âm thầm đổi sang market
        return o.setPreview(null);
      }
      settle({ key: id, price, title: `${labelAt(order, price)} ${fmtLot(order.volume)}`.toUpperCase(), label: labelAt(order, price) }, () => moveOrder(order, price, digits));
    },
  });

  /** Kéo nút TP / SL mờ trên thẻ lệnh ra giá cần đặt (như TradingView). Bản nháp: ghi thẳng vào bản nháp; vị thế / lệnh chờ đã đặt: đường hiện ra ở mức gợi ý rồi theo con trỏ, thả tay mới gửi.
   *  Bấm không kéo thì nhận luôn mức gợi ý (cách giá tham chiếu 0.25%). */
  const beginStop = (owner: TagOwner, kind: "sl" | "tp", e: PointerEvent) => {
    if (owner.t === "draft") {
      seedDraftStop(kind);
      const d = useTicketStore.getState().draft;
      const v = d ? parseNum(d[kind]) : 0;
      if (v > 0) drag.begin(e, `d:${kind}`, 0, v);
      return;
    }
    if (!canMove()) return;
    pending = null;
    const sym = symbolInfo();
    const q = useQuoteStore.getState().quotes[o.getSymbol()];
    const digits = o.getDigits();
    const tick = sym?.tick_size || 10 ** -digits;
    const key = `${owner.t === "position" ? "p" : "o"}${kind}:${owner.ticket}`;
    const stop = stopOf(key);
    if (!stop) return;
    // vị thế đo từ giá ĐÓNG (Buy ở Bid, Sell ở Ask), lệnh chờ đo từ giá vào
    const ref = stop.target === "position" ? (q ? (stop.side === "buy" ? q.bid : q.ask) : 0) : stop.entry;
    if (!(ref > 0)) return;
    const seed = defaultStop(kind, stop.side, ref, tick, digits, sym?.stops_level);
    o.setPreview({ key, price: seed, title: stopTitleFn(kind, stop.side, stop.lot, stop.entry, seed, stop.symbol) });
    drag.begin(e, key, 0, seed);
  };

  return {
    destroy: () => {
      window.removeEventListener("keydown", onEsc);
      drag.destroy();
    },
    beginStop,
    confirmEdit,
    cancelEdit,
  };
}
