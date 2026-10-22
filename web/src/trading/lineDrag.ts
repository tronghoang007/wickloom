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
  onAbort: (id: string, from: number) => void; // huỷ (Esc / mất con trỏ) hoặc thả mà chưa dời đi đâu
};

const TOL = 6;

export class LineDrag {
  private drag: { id: string; from: number; price: number } | null = null;
  private lock: { handleScroll: unknown; handleScale: unknown } | null = null;
  private hovering = false;

  constructor(private h: LineDragHost) {
    h.listenOn.addEventListener("pointerdown", this.onDown, true);
    h.listenOn.addEventListener("pointermove", this.onMoveEv, true);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
  }

  destroy() {
    this.h.listenOn.removeEventListener("pointerdown", this.onDown, true);
    this.h.listenOn.removeEventListener("pointermove", this.onMoveEv, true);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    this.finish();
  }

  private local(e: PointerEvent) {
    const r = this.h.container.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
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

  private start(e: PointerEvent, id: string, from: number, price: number) {
    this.consume(e);
    try {
      this.h.container.setPointerCapture(e.pointerId); // nhả chuột ngoài chart vẫn nhận được pointerup
    } catch {
      /* pointer đã biến mất */
    }
    this.lockChart();
    this.drag = { id, from, price };
    this.h.container.style.cursor = "grabbing";
  }

  private onDown = (e: PointerEvent) => {
    if (e.button !== 0 || this.drag) return;
    const t = this.pick(e);
    if (t) this.start(e, t.id, t.price, t.price);
  };

  /** Bắt đầu kéo một đường CHƯA có trên chart (nút TP/SL mờ trên thẻ lệnh): `from` = mức hiện có (0 = chưa đặt), `price` = giá khởi đầu (thả ngay không kéo thì nhận giá này). */
  begin(e: PointerEvent, id: string, from: number, price: number) {
    if (e.button !== 0 || this.drag) return;
    this.start(e, id, from, price);
  }

  private onMoveEv = (e: PointerEvent) => {
    if (this.drag) {
      this.consume(e);
      const raw = this.h.getSeries()?.coordinateToPrice(this.local(e).y);
      if (raw == null) return;
      const price = snapPrice(raw as number, this.h.tickSize(), this.h.digits());
      if (price <= 0) return;
      this.drag.price = price;
      this.h.onMove(this.drag.id, price);
      return;
    }
    if (this.pick(e)) {
      e.stopPropagation(); // DrawingManager không được ghi đè con trỏ / tô sáng hình bên dưới
      this.h.container.style.cursor = "grab"; // bàn tay mở: đường này kéo thả được
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
    if (Math.abs(d.price - d.from) < this.h.tickSize() / 2) this.h.onAbort(d.id, d.from); // chưa dời đi đâu
    else this.h.onDrop(d.id, d.price, d.from);
  };

  private onCancel = () => {
    const d = this.drag;
    if (!d) return;
    this.finish();
    this.h.onAbort(d.id, d.from);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.drag) this.onCancel();
  };
}
