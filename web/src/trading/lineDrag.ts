import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import { snapPrice } from "./orderType";

// Kéo các đường giao dịch trên chart để đổi giá (docs/trade-plan.md T3-T4): đường lệnh chờ, entry/SL/TP của bảng đặt lệnh. Đường là price line của lightweight-charts nên không
// tự kéo được: lớp này nghe chuột ở phần tử bao quanh chart (pha capture, chạy TRƯỚC DrawingManager), nhận ra chuột đang ở gần đường nào, theo dõi giá dưới con trỏ và báo
// cho bên dùng. Không biết gì về lệnh hay gửi lệnh: ai dùng quyết định cái gì kéo được và làm gì khi thả.

/** Đường gần `y` nhất trong ngưỡng `tol` px (null nếu không có). Hai đường cách nhau gần hơn ngưỡng thì lấy đường sát hơn. */
export function hitLine(y: number, lines: { id: string; y: number }[], tol = 6): string | null {
  let best: { id: string; d: number } | null = null;
  for (const l of lines) {
    const d = Math.abs(l.y - y);
    if (d <= tol && (!best || d < best.d)) best = { id: l.id, d };
  }
  return best ? best.id : null;
}

export type DragTarget = { id: string; price: number };

export type LineDragHost = {
  chart: IChartApi;
  container: HTMLElement; // phần tử chứa chart: gốc toạ độ của y
  listenOn: HTMLElement; // phần tử bao quanh (nghe pha capture)
  getSeries: () => ISeriesApi<SeriesType> | null;
  getTargets: () => DragTarget[]; // các đường kéo được lúc này (rỗng = không kéo gì)
  digits: () => number;
  tickSize: () => number;
  onMove: (id: string, price: number) => void; // giá xem trước trong lúc kéo
  onDrop: (id: string, price: number, from: number) => void; // thả tay ở giá khác giá ban đầu
  onHover?: (id: string | null) => void; // đường kéo được đang được trỏ gần (null = không còn)
  onAbort: (id: string, from: number, click: boolean) => void; // huỷ (Esc / mất con trỏ), kéo rồi thả lại đúng giá cũ, hoặc bấm không kéo (`click` = true: chỉ trường hợp này mới là "chọn")
};

const TOL = 6;
/** Chấm tròn kéo được nằm trên đường giá, cách mép phải vùng vẽ bấy nhiêu px (TradeOverlay vẽ chấm ở đó). */
export const HANDLE_INSET = 34;
const CLICK_SLOP = 4; // px: bấm tay thường rung 1-3px, mà 1px trên chart có thể là cả chục tick, nên chưa dời quá ngần này thì vẫn là "bấm", không phải kéo. Chỉ tính chiều dọc: đường chỉ kéo lên xuống, tay rung ngang bao nhiêu cũng không đổi giá nên không biến cú bấm thành cú kéo (thẻ lệnh chờ bấm lệch ngang vài px thì chỉ focus mà không mở bảng)

export class LineDrag {
  private drag: { id: string; from: number; price: number; y: number; moved: boolean; arm?: () => boolean } | null = null;
  private lock: { handleScroll: unknown; handleScale: unknown } | null = null;
  private hovering = false;
  private hoverId: string | null = null;

  constructor(private h: LineDragHost) {
    h.listenOn.addEventListener("pointerdown", this.onDown, true);
    h.listenOn.addEventListener("pointermove", this.onMoveEv, true);
    h.listenOn.addEventListener("pointerleave", this.onLeave);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
  }

  destroy() {
    this.h.listenOn.removeEventListener("pointerdown", this.onDown, true);
    this.h.listenOn.removeEventListener("pointermove", this.onMoveEv, true);
    this.h.listenOn.removeEventListener("pointerleave", this.onLeave);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    this.finish();
  }

  // Pane chứa series chính (nằm trên cùng hoặc đã bị đổi chỗ với pane indicator): toạ độ y của series là theo mép trên pane đó
  private paneRect(): { top: number; height: number } | null {
    try {
      const el = this.h.getSeries()?.getPane?.()?.getHTMLElement();
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    } catch {
      return null; // series vừa bị gỡ
    }
  }

  private local(e: PointerEvent) {
    const r = this.h.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - (this.paneRect()?.top ?? r.top) };
  }

  // Đường sát con trỏ (chỉ trong vùng vẽ, không phải trục giá / widget SELL-BUY đè lên chart). Con trỏ ở trên thẻ của một đường (`data-line-key`) thì kéo đúng đường đó, bất kể
  // lệch tâm bao nhiêu; nút trên thẻ (`data-tag-btn`) tự xử lý chuột nên không kéo gì.
  private pick(e: PointerEvent): DragTarget | null {
    const el = e.target instanceof Element ? e.target : null;
    if (el?.closest("[data-tag-btn]")) return null;
    const tagKey = el?.closest("[data-line-key]")?.getAttribute("data-line-key");
    if (tagKey) return this.h.getTargets().find((t) => t.id === tagKey) ?? null;
    if (!this.h.container.contains(e.target as Node)) return null;
    const targets = this.h.getTargets();
    if (targets.length === 0) return null;
    const series = this.h.getSeries();
    if (!series) return null;
    const { x, y } = this.local(e);
    if (x < 0 || x > this.h.chart.timeScale().width()) return null;
    const pr = this.paneRect();
    if (pr && (y < 0 || y > pr.height)) return null; // con trỏ ở pane khác (indicator) hoặc đường ngăn: không kéo đường lệnh
    const lines = targets.flatMap((t) => {
      const ly = series.priceToCoordinate(t.price);
      return ly === null ? [] : [{ id: t.id, y: ly as number }];
    });
    const id = hitLine(y, lines, TOL);
    return id === null ? null : (targets.find((t) => t.id === id) ?? null);
  }

  private consume(e: Event) {
    e.preventDefault();
    e.stopPropagation();
  }

  // LWC nghe mouse*/touch*: preventDefault pointerdown chặn được chuột, còn cảm ứng thì phải tắt pan/zoom trong lúc kéo (giống DrawingManager)
  private lockChart() {
    if (this.lock) return;
    const { handleScroll, handleScale } = this.h.chart.options();
    this.lock = structuredClone({ handleScroll, handleScale });
    this.h.chart.applyOptions({ handleScroll: false, handleScale: false });
  }

  private finish() {
    if (this.lock) {
      this.h.chart.applyOptions(this.lock as never);
      this.lock = null;
    }
    if (this.hovering || this.drag) this.h.container.style.cursor = "";
    this.hovering = false;
    this.drag = null;
  }

  private start(e: PointerEvent, id: string, from: number, price: number, moved = false, arm?: () => boolean) {
    this.consume(e);
    try {
      this.h.container.setPointerCapture(e.pointerId); // nhả chuột ngoài chart vẫn nhận được pointerup
    } catch {
      /* pointer đã biến mất */
    }
    this.lockChart();
    this.drag = { id, from, price, y: e.clientY, moved, arm };
    this.h.container.style.cursor = "ns-resize";
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.drag) return;
    const t = this.pick(e);
    if (t) this.start(e, t.id, t.price, t.price);
  };

  /** Bắt đầu kéo một đường CHƯA có trên chart (nút TP/SL mờ trên thẻ lệnh): `from` = mức hiện có (0 = chưa đặt), `price` = giá khởi đầu (thả ngay không kéo thì nhận giá này).
   *  Có `arm`: đường chỉ được tạo (arm chạy, trả false = bỏ) khi con trỏ đã dời quá ngưỡng "bấm"; nhấn rồi thả không kéo thì không làm gì cả (như TradingView: "Drag to add"). */
  begin(e: PointerEvent, id: string, from: number, price: number, arm?: () => boolean) {
    if (e.button !== 0 || this.drag) return;
    this.start(e, id, from, price, !arm, arm); // không `arm`: bấm không kéo vẫn nhận mức gợi ý, không qua ngưỡng "bấm"
  }

  private onMoveEv = (e: PointerEvent) => {
    if (this.drag) {
      this.consume(e);
      if (!this.drag.moved && Math.abs(e.clientY - this.drag.y) < CLICK_SLOP) return;
      if (!this.drag.moved && this.drag.arm && !this.drag.arm()) {
        this.finish();
        return;
      }
      this.drag.moved = true;
      const raw = this.h.getSeries()?.coordinateToPrice(this.local(e).y);
      if (raw == null) return;
      const price = snapPrice(raw as number, this.h.tickSize(), this.h.digits());
      if (price <= 0) return;
      this.drag.price = price;
      this.h.onMove(this.drag.id, price);
      return;
    }
    const t = this.pick(e);
    this.setHoverId(t ? t.id : null);
    if (t) {
      e.stopPropagation(); // DrawingManager không được ghi đè con trỏ / tô sáng hình bên dưới
      this.h.container.style.cursor = "ns-resize"; // trỏ vào đường (bất kỳ chỗ nào trên đường, không riêng chấm tròn): kéo lên xuống được
      this.hovering = true;
    } else if (this.hovering) {
      this.hovering = false;
      this.h.container.style.cursor = "";
    }
  };

  private setHoverId(id: string | null) {
    if (this.hoverId === id) return;
    this.hoverId = id;
    this.h.onHover?.(id);
  }

  private onLeave = () => this.setHoverId(null);

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d) return;
    this.consume(e);
    try {
      this.h.container.releasePointerCapture(e.pointerId);
    } catch {
      /* đã nhả */
    }
    this.finish();
    if (!d.moved && d.arm) return; // đường chưa được tạo: không có gì để thả hay huỷ
    if (!d.moved) this.h.onAbort(d.id, d.from, true); // nhấn xuống rồi thả ra, không dời: bấm
    else if (Math.abs(d.price - d.from) < this.h.tickSize() / 2) this.h.onAbort(d.id, d.from, false); // đã kéo nhưng thả lại đúng giá cũ: vẫn là kéo, không phải chọn
    else this.h.onDrop(d.id, d.price, d.from);
  };

  private onCancel = () => {
    const d = this.drag;
    if (!d) return;
    this.finish();
    if (!d.moved && d.arm) return;
    this.h.onAbort(d.id, d.from, false);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.drag) this.onCancel();
  };
}
