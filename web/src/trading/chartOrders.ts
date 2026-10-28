import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { PendingOrder, Position } from "@/lib/mt5Api";
import { drawingGlobal } from "@/drawings/store";
import { chartGlobal } from "@/store/chart";
import { useAuthStore } from "@/store/auth";
import { useSettingsStore } from "@/store/settings";
import { toast } from "@/store/toast";
import { moveOrder, moveStops, type StopChange } from "./actions";
import { DRAFT_IDS, defaultStop, draftLines, parseNum } from "./draft";
import { registerEditHandlers, useEditBridge } from "./editBridge";
import { useTradeFocus } from "./focus";
import { fmtLot, isStale, orderLabel, type DragPreview, type StopTitleFn, type TagOwner } from "./format";
import { tradeBlock } from "./gate";
import { LineDrag, type DragTarget } from "./lineDrag";
import { checkStopMove, isPendingType, pendingLabel, resolveOrderType, sideOfType, tooClose } from "./orderType";
import { estimatePnl, fmtPnlCcy, pnlSpec, stopTitle } from "./pnl";
import { useQuoteStore } from "./quote";
import { SIM_ACCOUNT_ID } from "./simId";
import { seedDraftStop } from "./submit";
import { tradeAccount, useTradeStore } from "./store";
import { useTicketStore } from "./ticket";

/** Nhãn đường SL/TP kèm lãi/lỗi dự kiến theo tiền account (đọc store lúc gọi, nên dùng được cho mọi chart). */
export function makeStopTitle(): StopTitleFn {
  return (kind, side, lot, entry, price, symbol) => {
    const sym = chartGlobal.getState().symbols.find((s) => s.name === symbol);
    const ccy = tradeAccount()?.currency ?? "";
    return stopTitle(kind, side, lot, entry, price, pnlSpec(sym, ccy), ccy);
  };
}

/** Đang được sửa / huỷ / đóng lệnh trên chart không: đã đăng nhập, account demo, EA bật giao dịch. Khách / real / EA tắt thì chỉ xem (bản nháp vẫn kéo được). Account giả lập của Replay: luôn được. */
export function canModifyTrades(): boolean {
  const account = tradeAccount();
  if (account?.id === SIM_ACCOUNT_ID) return true;
  const status = useAuthStore.getState().status;
  return status === "user" && tradeBlock({ status, loaded: true, account, spec: { min: 0, max: 0, step: 0 }, hasQuote: true }) === null;
}

/** `owner` của confirmEdit / cancelEdit = "position:<ticket>" | "order:<ticket>" (cùng khoá với nhóm thẻ trên chart); cancelEdit không tham số bỏ mọi thay đổi đang chờ. */
export type ChartDrag = { destroy: () => void; beginStop: (owner: TagOwner, kind: "sl" | "tp", e: PointerEvent) => void; confirmEdit: (owner: string) => void; cancelEdit: (owner?: string) => void };

type Opts = {
  chart: IChartApi;
  container: HTMLElement;
  listenOn: HTMLElement;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getSymbol: () => string;
  getDigits: () => number;
  isReplay: () => boolean; // chart đang Replay: chỉ kéo lệnh của account giả lập (trading/simStore.ts), chart thường chỉ kéo lệnh của account MT5
  paneId: string;
  setPreview: (p: DragPreview[]) => void; // mọi đường đang kéo / chờ xác nhận / đã gửi chờ EA báo
};

const STOP_ID = /^(psl|ptp|osl|otp):(\d+)$/;

/** Lắp LineDrag cho một chart. Kéo được: (1) entry / SL / TP của bảng đặt lệnh đang mở, ghi thẳng vào bản nháp; (2) khi giao dịch được (khách / real / EA tắt đều không): đường lệnh chờ
 *  (thả tay → `moveOrder`: cùng loại sửa giá, qua giá thị trường thì đặt mới đúng loại rồi xoá cũ) và đường SL/TP của vị thế / lệnh chờ (thả tay → `moveStops`, có "Hoàn tác").
 *  Mọi chỗ thả đều kiểm tra phía + vùng cấm của broker trước khi gửi. Đang chọn công cụ vẽ, hoặc chart không cùng phía với account đang nhận lệnh (Replay / thật), thì không kéo gì. */
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

  // Sửa lệnh đã đặt bằng kéo thả (SL/TP, giá lệnh chờ): thả tay xong, nếu One-click trading (Settings > Trading) đang tắt thì đường DỪNG ở giá mới và thẻ giá vào hiện Discard / Confirm
  // (như TradingView khi tắt one-click). Mỗi đường đã thả là một "edit" chờ; SL, TP và giá vào của cùng một vị thế / lệnh chờ sửa độc lập, Confirm gửi MỘT yêu cầu cho cả nhóm
  // (backend ghép trường vắng với số liệu cũ của EA nên hai yêu cầu liền nhau sẽ đè nhau). Discard / Esc trả về giá cũ. Bật One-click thì gửi ngay khi thả.
  type Edit = { preview: DragPreview; owner: string; pnlText: string };
  const edits = new Map<string, Edit>(); // chờ xác nhận, theo khoá đường
  const sent = new Map<string, DragPreview>(); // đã gửi, giữ đường ở giá mới tới khi dữ liệu mới của EA về
  let live: DragPreview | null = null; // đang kéo
  const publish = () => {
    o.setPreview([...sent.values(), ...[...edits.values()].map((e) => ({ ...e.preview, pending: true })), ...(live ? [live] : [])]);
    const byOwner: Record<string, DragPreview[]> = {};
    for (const e of edits.values()) (byOwner[e.owner] ??= []).push(e.preview);
    useEditBridge.getState().setPane(o.paneId, byOwner);
  };
  const ownerOf = (id: string) => {
    const m = /^(p|o)(?:sl|tp)?:(\d+)$/.exec(id);
    return m ? `${m[1] === "p" ? "position" : "order"}:${m[2]}` : null;
  };

  const runEdits = (owner: string, mine: Edit[]): Promise<boolean> => {
    const ticket = Number(owner.split(":")[1]);
    const digits = o.getDigits();
    const changes: StopChange[] = [];
    let target: { target: "position" | "order"; symbol: string } | null = null;
    for (const e of mine) {
      const stop = stopOf(e.preview.key);
      if (!stop) continue;
      target = { target: stop.target, symbol: stop.symbol };
      changes.push({ field: stop.field, from: stop.from, to: e.preview.price });
    }
    const entry = mine.find((e) => e.preview.key === `o:${ticket}`);
    if (entry) {
      const order = orderOf(ticket);
      return order ? moveOrder(order, entry.preview.price, digits, Object.fromEntries(changes.map((c) => [c.field, c.to]))) : Promise.resolve(false);
    }
    return target ? moveStops({ ...target, ticket }, changes, digits, changes.length === 1 ? mine.find((e) => e.preview.key !== `o:${ticket}`)?.pnlText : "") : Promise.resolve(false);
  };
  const confirmEdit = (owner: string) => {
    const mine = [...edits.values()].filter((e) => e.owner === owner);
    if (mine.length === 0) return;
    for (const e of mine) {
      edits.delete(e.preview.key);
      sent.set(e.preview.key, e.preview);
    }
    publish();
    void runEdits(owner, mine).then((ok) => {
      const drop = () => {
        for (const e of mine) if (sent.get(e.preview.key) === e.preview) sent.delete(e.preview.key);
        publish();
      };
      if (ok) setTimeout(drop, 1500); // đủ thời gian để dữ liệu mới của EA về
      else drop();
    });
  };
  const cancelEdit = (owner?: string) => {
    for (const [k, e] of edits) if (!owner || e.owner === owner) edits.delete(k);
    publish();
    if (owner && useTradeFocus.getState().owner === owner) useTradeFocus.getState().set(null); // Discard = bỏ chọn lệnh luôn (bảng Modify đóng theo focus)
  };
  const settle = (preview: DragPreview, pnlText = "", auto = true) => {
    const owner = ownerOf(preview.key);
    if (!owner) return publish();
    edits.set(preview.key, { preview, owner, pnlText });
    if (auto && useSettingsStore.getState().s.oneClick) confirmEdit(owner);
    else publish();
  };
  const onEsc = (e: KeyboardEvent) => {
    if (e.key !== "Escape" || live) return; // đang kéo thì Esc chỉ huỷ cú kéo (LineDrag), không bỏ các thay đổi đã thả
    cancelEdit();
    useTradeFocus.getState().set(null);
  };
  window.addEventListener("keydown", onEsc);
  // Focus: kéo / bấm vào một đường (hoặc thẻ, xem TradeOverlay) = focus lệnh của đường đó; bấm nền chart hoặc Esc = bỏ focus. Đường bị LineDrag nhận thì LWC không thấy cú bấm nên không bỏ focus nhầm.
  const focusLine = (id: string) => {
    const owner = id in DRAFT_IDS ? "draft" : ownerOf(id);
    if (owner) useTradeFocus.getState().set(owner);
    if (owner && owner !== "draft") useTicketStore.getState().follow(owner); // thanh bên phải đang mở bảng đặt lệnh thì đổi theo lệnh đang kéo
  };
  const onChartClick = () => {
    if (drag.consumeTap()) return; // cú bấm vừa chọn lệnh qua đường chỉ-bấm: chart cũng báo click, đừng bỏ chọn ngay
    useTradeFocus.getState().set(null);
  };
  o.chart.subscribeClick(onChartClick);

  // Đặt giá mới cho một đường của lệnh đã đặt (kiểm tra phía + vùng cấm của broker, rồi thành thay đổi chờ xác nhận): dùng cho thả tay (auto: One-click bật thì gửi ngay) và cho ô nhập ở bảng Modify (không tự gửi, có nút Modify)
  const applyEdit = (id: string, price: number, auto: boolean) => {
    const digits = o.getDigits();
    const q = useQuoteStore.getState().quotes[o.getSymbol()];
    const stop = stopOf(id);
    if (stop) {
      const why = checkStopMove({ target: stop.target, side: stop.side, kind: stop.field, price, entry: stop.entry, bid: q?.bid ?? 0, ask: q?.ask ?? 0, digits, stopsLevel: symbolInfo()?.stops_level });
      if (why) {
        toast(why, { ms: 6000 });
        return publish();
      }
      const ccy = tradeAccount()?.currency ?? "";
      const spec = pnlSpec(symbolInfo(), ccy);
      const pnlText = spec ? ` (${fmtPnlCcy(estimatePnl(stop.side, stop.lot, stop.entry, price, spec), ccy)})` : "";
      const preview = { key: id, price, title: stopTitleFn(stop.field, stop.side, stop.lot, stop.entry, price, stop.symbol) };
      return settle(preview, pnlText, auto);
    }

    const order = orderOf(Number(id.slice(2)));
    if (!order) return publish();
    const t = isPendingType(order.type) && q ? resolveOrderType(sideOfType(order.type), price, q.bid, q.ask) : null;
    const level = symbolInfo()?.stops_level;
    if (t && q && tooClose(t, price, q.bid, q.ask, level, digits)) {
      toast(`Quá gần giá thị trường (tối thiểu ${level} điểm)`, { ms: 6000 }); // không âm thầm đổi sang market
      return publish();
    }
    settle({ key: id, price, title: `${labelAt(order, price)} ${fmtLot(order.volume)}`.toUpperCase(), label: labelAt(order, price) }, "", auto);
  };

  const drag = new LineDrag({
    chart: o.chart,
    container: o.container,
    listenOn: o.listenOn,
    getSeries: o.getSeries,
    getTargets: () => {
      if (drawingGlobal.getState().tool || o.isReplay() !== useTradeStore.getState().sim) return [];
      const symbol = o.getSymbol();
      const quote = useQuoteStore.getState().quotes[symbol];
      const draft = draftLines(useTicketStore.getState().draft, symbol, quote).map((l) => ({ id: l.key, price: l.price }));
      // đường đã thả (chờ xác nhận / đã gửi) đứng ở giá mới nên phải bắt chuột ở giá mới, và SL/TP vừa kéo ra từ nút mờ (dữ liệu EA chưa có) cũng phải kéo lại được
      const shown = (id: string, price: number) => edits.get(id)?.preview.price ?? sent.get(id)?.price ?? price;
      const orders = ordersHere().flatMap((x) => [
        { id: `o:${x.ticket}`, price: shown(`o:${x.ticket}`, x.price_open) },
        ...(x.sl > 0 ? [{ id: `osl:${x.ticket}`, price: shown(`osl:${x.ticket}`, x.sl) }] : []),
        ...(x.tp > 0 ? [{ id: `otp:${x.ticket}`, price: shown(`otp:${x.ticket}`, x.tp) }] : []),
      ]);
      const positions: DragTarget[] = positionsHere().flatMap((x) => [
        { id: `p:${x.ticket}`, price: x.price_open, fixed: true }, // giá vào của vị thế đã khớp: bấm để chọn, không kéo được
        ...(x.sl > 0 ? [{ id: `psl:${x.ticket}`, price: shown(`psl:${x.ticket}`, x.sl) }] : []),
        ...(x.tp > 0 ? [{ id: `ptp:${x.ticket}`, price: shown(`ptp:${x.ticket}`, x.tp) }] : []),
      ]);
      // khách / real / EA tắt: chỉ xem, nhưng vẫn bấm vào đường để chọn lệnh (hai thẻ đè lên nhau thì bấm đường là cách duy nhất)
      if (!canMove()) return [...draft, ...[...orders, ...positions].map((t) => ({ ...t, fixed: true }))];
      const have = new Set([...orders, ...positions].map((t) => t.id));
      const created = [...new Set([...edits.keys(), ...sent.keys()])].filter((k) => STOP_ID.test(k) && !have.has(k) && stopOf(k) !== null).map((k) => ({ id: k, price: shown(k, 0) }));
      return [...draft, ...orders, ...positions, ...created];
    },
    digits: o.getDigits,
    tickSize: () => symbolInfo()?.tick_size || 10 ** -o.getDigits(),
    onMove: (id, price) => {
      focusLine(id);
      if (id in DRAFT_IDS) return patchDraft(id, price);
      const stop = stopOf(id);
      if (stop) live = { key: id, price, title: stopTitleFn(stop.field, stop.side, stop.lot, stop.entry, price, stop.symbol) };
      else {
        const order = orderOf(Number(id.slice(2)));
        if (order) live = { key: id, price, title: `${labelAt(order, price)} ${fmtLot(order.volume)}`.toUpperCase(), label: labelAt(order, price) };
      }
      publish();
    },
    onHover: (id) => useTradeFocus.getState().setHover(id === null ? null : id in DRAFT_IDS ? "draft" : ownerOf(id)),
    onAbort: (id, from, click) => {
      // bấm vào đường mà không kéo = chọn lệnh đó (mở bảng Modify ở thanh bên phải); kéo (kể cả thả lại đúng giá cũ) hay Esc thì chỉ focus, không mở bảng
      const clicked = click && !(id in DRAFT_IDS) ? ownerOf(id) : null;
      if (clicked) useTicketStore.getState().select(clicked);
      else focusLine(id);
      if (id in DRAFT_IDS) return patchDraft(id, null, from); // trả ô nhập về giá cũ
      live = null; // đường quay về giá đang chờ xác nhận (nếu có) hoặc giá thật
      publish();
    },
    onDrop: (id, price) => {
      if (id in DRAFT_IDS) {
        wasMarket = false; // bản nháp đã nhận giá mới lúc kéo
        return;
      }
      live = null;
      applyEdit(id, price, true);
    },
  });

  /** Kéo nút TP / SL mờ trên thẻ lệnh ra giá cần đặt (như TradingView). Bản nháp: ghi thẳng vào bản nháp; vị thế / lệnh chờ đã đặt: đường hiện ra ở mức gợi ý rồi theo con trỏ, thả tay mới gửi.
   *  Đường chỉ hiện ra khi con trỏ bắt đầu kéo (nhấn chuột chưa làm gì); bấm không kéo thì không đặt gì. */
  const beginStop = (owner: TagOwner, kind: "sl" | "tp", e: PointerEvent) => {
    if (owner.t === "draft") {
      drag.begin(e, `d:${kind}`, 0, 0, () => {
        seedDraftStop(kind);
        const d = useTicketStore.getState().draft;
        return (d ? parseNum(d[kind]) : 0) > 0;
      });
      return;
    }
    if (!canMove()) return;
    const sym = symbolInfo();
    const q = useQuoteStore.getState().quotes[o.getSymbol()];
    const digits = o.getDigits();
    const tick = sym?.tick_size || 10 ** -digits;
    const key = `${owner.t === "position" ? "p" : "o"}${kind}:${owner.ticket}`;
    focusLine(key);
    const stop = stopOf(key);
    if (!stop) return;
    // vị thế đo từ giá ĐÓNG (Buy ở Bid, Sell ở Ask), lệnh chờ đo từ giá vào
    const ref = stop.target === "position" ? (q ? (stop.side === "buy" ? q.bid : q.ask) : 0) : stop.entry;
    if (!(ref > 0)) return;
    const seed = defaultStop(kind, stop.side, ref, tick, digits, sym?.stops_level);
    drag.begin(e, key, 0, seed, () => {
      live = { key, price: seed, title: stopTitleFn(kind, stop.side, stop.lot, stop.entry, seed, stop.symbol) };
      publish();
      return true;
    });
  };

  // Bảng Modify (ô nhập / công tắc SL, TP): mức gợi ý như nút TP / SL mờ trên thẻ (vị thế đo từ giá đóng, lệnh chờ từ giá vào)
  const seedEdit = (key: string) => {
    const stop = stopOf(key);
    if (!stop) return;
    const sym = symbolInfo();
    const q = useQuoteStore.getState().quotes[o.getSymbol()];
    const digits = o.getDigits();
    const ref = stop.target === "position" ? (q ? (stop.side === "buy" ? q.bid : q.ask) : 0) : stop.entry;
    if (ref > 0) applyEdit(key, defaultStop(stop.field, stop.side, ref, sym?.tick_size || 10 ** -digits, digits, sym?.stops_level), false);
  };
  const clearEdit = (key: string) => {
    edits.delete(key);
    publish();
  };

  const unregister = registerEditHandlers(o.paneId, { confirm: confirmEdit, cancel: cancelEdit, set: (key, price) => applyEdit(key, price, false), seed: seedEdit, clear: clearEdit });
  return {
    destroy: () => {
      unregister();
      window.removeEventListener("keydown", onEsc);
      o.chart.unsubscribeClick(onChartClick);
      drag.destroy();
    },
    beginStop,
    confirmEdit,
    cancelEdit,
  };
}
