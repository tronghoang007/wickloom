import { drawingGlobal } from "@/drawings/store";
import { chartGlobal } from "@/store/chart";
import { toast } from "@/store/toast";
import { LineDrag } from "@/trading/lineDrag";
import { LineStyle, type IChartApi, type IPriceLine, type ISeriesApi, type SeriesType } from "lightweight-charts";
import { useEffect } from "react";
import { lineAlerts, lineTitle } from "./model";
import { useAlertStore } from "./store";

const COLOR = "#ff9800"; // khác xanh / đỏ của lệnh Buy / Sell
const COLOR_PAUSED = "#787b86";

type Opts = {
  symbol: string;
  chartType: string; // đổi loại nến thì series mới: đường giá cũ mất theo series cũ
  replay: boolean; // đang Replay: không vẽ alert (giá chart không còn là giá thật)
  getChart: () => IChartApi | null;
  getBox: () => HTMLElement | null;
  getSeries: () => ISeriesApi<SeriesType> | null;
  getDigits: () => number;
};

/** Đường alert đang chạy / tạm dừng của `symbol` trên chart: price line nét đứt màu cam kèm nhãn giá trên trục. Kéo đường lên xuống để đổi giá (thả tay thì lưu, lỗi thì đường nhảy về chỗ cũ).
 *  Dùng chung LineDrag với đường lệnh; giá sửa được cả khi alert tạm dừng. Danh sách lấy từ useAlertStore (backend là nguồn thật), nên chart nào cùng symbol cũng thấy. */
export function useAlertLines({ symbol, chartType, replay, getChart, getBox, getSeries, getDigits }: Opts) {
  useEffect(() => {
    const lines = new Map<string, { line: IPriceLine; sig: string }>();
    let series: ISeriesApi<SeriesType> | null = null;
    const clear = () => {
      for (const { line } of lines.values()) {
        try {
          series?.removePriceLine(line);
        } catch {
          /* series đã bị gỡ cùng đường */
        }
      }
      lines.clear();
    };
    const wanted = () => (replay ? [] : lineAlerts(useAlertStore.getState().alerts, symbol));
    const sync = () => {
      const cur = getSeries();
      if (cur !== series) {
        clear();
        series = cur;
      }
      if (!series) return;
      const want = wanted();
      const ids = new Set(want.map((a) => a.id));
      for (const [id, { line }] of lines) {
        if (ids.has(id)) continue;
        series.removePriceLine(line);
        lines.delete(id);
      }
      for (const a of want) {
        const opts = { price: a.level, color: a.state === "paused" ? COLOR_PAUSED : COLOR, title: `🔔 ${lineTitle(a)}`, lineWidth: 1 as const, lineStyle: LineStyle.Dashed, axisLabelVisible: true };
        const sig = `${a.level}|${opts.color}|${opts.title}`;
        const have = lines.get(a.id);
        if (!have) lines.set(a.id, { line: series.createPriceLine(opts), sig });
        else if (have.sig !== sig) {
          have.line.applyOptions(opts);
          have.sig = sig;
        }
      }
    };
    sync();
    const unsub = useAlertStore.subscribe(sync);

    const chart = getChart();
    const box = getBox();
    const drag =
      chart && box?.parentElement
        ? new LineDrag({
            chart,
            container: box,
            listenOn: box.parentElement,
            getSeries,
            getTargets: () => (drawingGlobal.getState().tool || replay ? [] : wanted().map((a) => ({ id: a.id, price: a.level }))),
            digits: getDigits,
            tickSize: () => chartGlobal.getState().symbols.find((s) => s.name === symbol)?.tick_size || 10 ** -getDigits(),
            onMove: (id, price) => lines.get(id)?.line.applyOptions({ price }), // xem trước trong lúc kéo
            onDrop: (id, price) => {
              void useAlertStore.getState().update(id, { level: price }, { level: price }).then((r) => {
                if (!r.ok) toast(r.error, { title: "Không đổi được giá alert", kind: "error" });
              });
            },
            onAbort: (id) => {
              const a = useAlertStore.getState().alerts.find((x) => x.id === id);
              if (a) lines.get(id)?.line.applyOptions({ price: a.level }); // huỷ kéo: về giá đã lưu
            },
          })
        : null;

    return () => {
      drag?.destroy();
      unsub();
      clear();
    };
    // getChart / getBox / getSeries / getDigits ổn định (đọc ref); chỉ dựng lại khi symbol, loại nến hay Replay đổi
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, chartType, replay]);
}
