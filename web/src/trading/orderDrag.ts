import type { IChartApi, ISeriesApi, SeriesType } from "lightweight-charts";
import type { PendingOrder } from "@/lib/mt5Api";
import type { DragPreview } from "./format";
import { snapPrice } from "./orderType";

// Kéo đường lệnh chờ trên chart để đổi giá (docs/trade-plan.md T3). Đường lệnh chờ là price line của lightweight-charts nên không tự kéo được: lớp này nghe
// chuột ở phần tử bao quanh chart (pha capture, chạy TRƯỚC DrawingManager), nhận ra chuột đang ở gần đường nào, theo dõi giá dưới con trỏ và báo cho Chart vẽ lại
// đường xem trước. Không biết gì về gửi lệnh: thả tay thì gọi `onDrop`.

/** Đường gần `y` nhất trong ngưỡng `tol` px (null nếu không có). Hai đường cách nhau gần hơn ngưỡng thì lấy đường sát hơn. */
export function hitLine(y: number, lines: { ticket: number; y: number }[], tol = 6): number | null {
  let best: { ticket: number; d: number } | null = null;
  for (const l of lines) {
    const d = Math.abs(l.y - y);
    if (d <= tol && (!best || d < best.d)) best = { ticket: l.ticket, d };
  }
  return best ? best.ticket : null;
}

export type OrderDragHost = {
  chart: IChartApi;
  container: HTMLElement; // phần tử chứa chart: gốc toạ độ của y
  listenOn: HTMLElement; // phần tử bao quanh (nghe pha capture)
  getSeries: () => ISeriesApi<SeriesType> | null;
  getOrders: () => PendingOrder[]; // lệnh chờ của symbol đang xem, dữ liệu còn mới
  canDrag: () => boolean; // chỉ kéo khi giao dịch được (demo, EA bật, không Replay, không đang vẽ)
  digits: () => number;
  tickSize: () => number;
  labelAt: (order: PendingOrder, price: number) => string; // tên loại lệnh sẽ thành nếu thả tay ở `price`
  onPreview: (p: DragPreview | null) => void;
  onDrop: (order: PendingOrder, price: number) => void;
};

const TOL = 6;

export class OrderDrag {
  private drag: { order: PendingOrder; price: number } | null = null;
  private lock: { handleScroll: unknown; handleScale: unknown } | null = null;
  private hovering = false;

  constructor(private h: OrderDragHost) {
    h.listenOn.addEventListener("pointerdown", this.onDown, true);
    h.listenOn.addEventListener("pointermove", this.onMove, true);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
  }

  destroy() {
    this.h.listenOn.removeEventListener("pointerdown", this.onDown, true);
    this.h.listenOn.removeEventListener("pointermove", this.onMove, true);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    this.finish();
  }

  private local(e: PointerEvent) {
    const r = this.h.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  // Lệnh chờ có đường nằm sát con trỏ (chỉ trong vùng vẽ, không phải trục giá / widget SELL-BUY đè lên chart)
  private pick(e: PointerEvent): PendingOrder | null {
    if (!this.h.container.contains(e.target as Node) || !this.h.canDrag()) return null;
    const series = this.h.getSeries();
    if (!series) return null;
    const { x, y } = this.local(e);
    if (x < 0 || x > this.h.chart.timeScale().width()) return null;
    const orders = this.h.getOrders();
    const lines = orders.flatMap((o) => {
      const ly = series.priceToCoordinate(o.price_open);
      return ly === null ? [] : [{ ticket: o.ticket, y: ly as number }];
    });
    const t = hitLine(y, lines, TOL);
    return t === null ? null : (orders.find((o) => o.ticket === t) ?? null);
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

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.drag) return;
    const order = this.pick(e);
    if (!order) return;
    this.consume(e);
    try {
      this.h.container.setPointerCapture(e.pointerId); // nhả chuột ngoài chart vẫn nhận được pointerup
    } catch {
      /* pointer đã biến mất */
    }
    this.lockChart();
    this.drag = { order, price: order.price_open };
    this.h.container.style.cursor = "ns-resize";
  };

  private onMove = (e: PointerEvent) => {
    if (this.drag) {
      this.consume(e);
      const series = this.h.getSeries();
      const raw = series?.coordinateToPrice(this.local(e).y);
      if (raw == null) return;
      const price = snapPrice(raw as number, this.h.tickSize(), this.h.digits());
      if (price <= 0) return;
      this.drag.price = price;
      this.h.onPreview({ ticket: this.drag.order.ticket, price, label: this.h.labelAt(this.drag.order, price) });
      return;
    }
    if (this.pick(e)) {
      e.stopPropagation(); // DrawingManager không được ghi đè con trỏ / tô sáng hình bên dưới
      this.h.container.style.cursor = "ns-resize";
      this.hovering = true;
    } else if (this.hovering) {
      this.hovering = false;
      this.h.container.style.cursor = "";
    }
  };

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
    if (Math.abs(d.price - d.order.price_open) < this.h.tickSize() / 2) this.h.onPreview(null); // chưa dời đi đâu
    else this.h.onDrop(d.order, d.price);
  };

  private onCancel = () => {
    if (!this.drag) return;
    this.finish();
    this.h.onPreview(null);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.drag) this.onCancel();
  };
}
