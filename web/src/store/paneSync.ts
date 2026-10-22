import { allPanes, useLayoutStore } from "./layout";
import type { ChartPane, Pane } from "./paneStores";

// "Sync in layout" (layout.sync): đổi ở một chart thì các chart còn lại đổi theo.
//  - Symbol / Interval: lắng nghe store `chart` của từng pane (startPaneSync), chỉ ghi vào pane đang KHÁC giá trị nên không vòng lặp.
//  - Crosshair / Time / Date range: Chart đăng ký một PaneView (góc nhìn + crosshair của nó), báo sự kiện qua syncCrosshair /
//    syncTime / syncRange; thời gian là đơn vị chung giữa các chart khác khung (chỉ số logic của mỗi chart khác nhau).
//    Theo TV: Time = BẤM vào một chart thì mọi chart hiện cùng thời điểm đó; Date range = cuộn/zoom thì mọi chart hiện cùng khoảng.
// Chart không có dữ liệu trong khoảng đó thì chỉ để trống, KHÔNG kích backfill (isSyncedRange cho Chart biết để bỏ qua).

type HasTime = { t: number };

/** Thời gian (giây) ứng với chỉ số logic `idx` (số thực) của dãy nến; ngoài hai đầu thì ngoại suy theo độ dài một nến. */
export function timeAt(bars: readonly HasTime[], tfSec: number, idx: number): number | null {
  const n = bars.length;
  if (n === 0 || !Number.isFinite(idx)) return null;
  if (idx <= 0) return bars[0].t + idx * tfSec;
  if (idx >= n - 1) return bars[n - 1].t + (idx - (n - 1)) * tfSec;
  const i = Math.floor(idx);
  return bars[i].t + (idx - i) * (bars[i + 1].t - bars[i].t);
}

/** Ngược của timeAt: chỉ số logic (số thực) ứng với thời gian `t`; qua cuối tuần/lỗ dữ liệu thì nội suy tuyến tính giữa hai nến. */
export function indexAt(bars: readonly HasTime[], tfSec: number, t: number): number | null {
  const n = bars.length;
  if (n === 0 || !Number.isFinite(t)) return null;
  if (t <= bars[0].t) return (t - bars[0].t) / tfSec;
  if (t >= bars[n - 1].t) return n - 1 + (t - bars[n - 1].t) / tfSec;
  let lo = 0;
  let hi = n - 1; // bars[lo].t <= t < bars[hi].t
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return lo + (t - bars[lo].t) / (bars[hi].t - bars[lo].t);
}

/** Chỉ số nến chứa thời gian `t` (nến mở ≤ t < mở + khung); -1 nếu ngoài dữ liệu. */
export function barIndexAt(bars: readonly HasTime[], tfSec: number, t: number): number {
  const n = bars.length;
  if (n === 0 || t < bars[0].t || t >= bars[n - 1].t + tfSec) return -1;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].t <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export type LogicalRange = { lf: number; lt: number };
/** Góc nhìn của một chart: mép trái/phải theo thời gian (giây) và theo chỉ số logic của chính nó. */
export type PaneRange = LogicalRange & { from: number; to: number };

export type PaneView = {
  getRange(): PaneRange | null;
  /** Hiện đúng khoảng thời gian [from, to]. Trả về góc nhìn thực tế sau khi đặt (LWC có thể giới hạn lại). */
  setRange(to: number, from: number): LogicalRange | null;
  /** Cuộn để thời gian `t` nằm ở vị trí `frac` (0..1) theo bề ngang chart, giữ số nến đang hiện. Trả về góc nhìn thực tế. */
  showTime(t: number, frac: number): LogicalRange | null;
  /** Vẽ crosshair dọc tại thời gian `t` (null = xoá). */
  setCrosshair(t: number | null): void;
  /** Chuột đang ở trong chart này: nó là nguồn crosshair, không nhận crosshair từ chart khác. */
  hovered(): boolean;
};

const views = new Map<string, PaneView>();
const echo = new Map<string, LogicalRange>(); // góc nhìn mà đồng bộ vừa đặt cho mỗi chart: sự kiện dội lại có đúng giá trị này thì bỏ qua
let applying = 0;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
const sameRange = (a: LogicalRange, b: LogicalRange) => near(a.lf, b.lf) && near(a.lt, b.lt);

export function registerPaneView(id: string, v: PaneView): () => void {
  views.set(id, v);
  return () => {
    if (views.get(id) !== v) return;
    views.delete(id);
    echo.delete(id);
  };
}

/** Góc nhìn này do đồng bộ đặt (không phải người dùng kéo): Chart không được coi nó là "đã cuộn tới đầu dữ liệu" để đi tải thêm. */
export function isSyncedRange(id: string, r: LogicalRange): boolean {
  const e = echo.get(id);
  return !!e && sameRange(e, r);
}

/** Chart `sourceId` vừa đổi góc nhìn (cuộn/zoom): với "Date range", đưa các chart còn lại về cùng khoảng thời gian. */
export function syncRange(sourceId: string) {
  const { sync, order } = useLayoutStore.getState();
  if (applying > 0 || !sync.dateRange) return;
  const r = views.get(sourceId)?.getRange();
  if (!r) return;
  if (isSyncedRange(sourceId, r)) return;
  echo.delete(sourceId);
  applying++;
  try {
    for (const id of order) {
      if (id === sourceId) continue;
      const res = views.get(id)?.setRange(r.to, r.from);
      if (res) echo.set(id, res);
    }
  } finally {
    applying--;
  }
}

/** Bấm vào chart `sourceId` ở thời gian `t` (tại vị trí ngang `frac`): với "Time", các chart còn lại cuộn tới cùng thời điểm đó, cùng vị trí ngang. */
export function syncTime(sourceId: string, t: number, frac: number) {
  const { sync, order } = useLayoutStore.getState();
  if (applying > 0 || !sync.time) return;
  applying++;
  try {
    for (const id of order) {
      if (id === sourceId) continue;
      const res = views.get(id)?.showTime(t, Math.min(1, Math.max(0, frac)));
      if (res) echo.set(id, res);
    }
  } finally {
    applying--;
  }
}

/** Con trỏ của chart `sourceId` ở thời gian `t` (null = rời chart). */
export function syncCrosshair(sourceId: string, t: number | null) {
  const { sync, order } = useLayoutStore.getState();
  if (!sync.crosshair) return;
  for (const id of order) {
    if (id === sourceId) continue;
    const v = views.get(id);
    if (v && !v.hovered()) v.setCrosshair(t);
  }
}

const chartPatch = (src: ChartPane, dst: ChartPane, keys: (keyof ChartPane)[]): Partial<ChartPane> =>
  Object.fromEntries(keys.filter((k) => src[k] !== dst[k]).map((k) => [k, src[k]]));

/** Cho mọi chart khác lấy symbol / khung của `src` (chỉ ghi chart đang khác). */
function adopt(src: Pane, keys: (keyof ChartPane)[]) {
  const s = src.chart.getState();
  for (const p of allPanes()) {
    if (p === src) continue;
    const patch = chartPatch(s, p.chart.getState(), keys);
    if (Object.keys(patch).length) p.chart.setState(patch);
  }
}

/** Bật đồng bộ (gọi 1 lần ở ChartGrid): theo dõi symbol/khung của từng pane và việc bật/tắt công tắc. Trả về hàm huỷ. */
export function startPaneSync(): () => void {
  let offs: (() => void)[] = [];
  const bind = () => {
    offs.forEach((f) => f());
    offs = allPanes().map((p) =>
      p.chart.subscribe((s, prev) => {
        const { sync } = useLayoutStore.getState();
        const keys: (keyof ChartPane)[] = [];
        if (sync.symbol && s.symbol !== prev.symbol) keys.push("symbol");
        if (sync.interval && s.tf !== prev.tf) keys.push("tf");
        if (keys.length) adopt(p, keys);
      }),
    );
  };
  bind();
  const off = useLayoutStore.subscribe((s, prev) => {
    if (s.panes !== prev.panes) bind();
    // mở layout khác: công tắc lấy từ layout, state các chart giữ như đã lưu (không ép về chart active)
    if (s.revision !== prev.revision || s.sync === prev.sync) return;
    const active = s.panes[s.activeId];
    if (!active) return;
    const on = (k: keyof typeof s.sync) => s.sync[k] && !prev.sync[k];
    const keys: (keyof ChartPane)[] = [];
    if (on("symbol")) keys.push("symbol");
    if (on("interval")) keys.push("tf");
    if (keys.length) adopt(active, keys);
    if (on("dateRange")) syncRange(s.activeId);
  });
  return () => {
    offs.forEach((f) => f());
    off();
  };
}
