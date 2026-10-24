import { create } from "zustand";
import { DEFAULT_SYNC, buildDoc, cleanName, type LayoutDoc, type SyncFlags } from "./layoutDoc";
import { buildTemplate, canonicalTemplateId, paneIds, retarget, templateById, withSizes, type Node } from "./layoutTree";
import { createPane, type Pane } from "./paneStores";
import { mergeSettings, useSettingsStore } from "./settings";

// Registry các chart (pane) đang có + pane active. Toolbar, thanh vẽ, hộp tìm symbol... luôn tác động lên pane active
// (như TradingView); chỉ Chart/DrawingManager của từng pane gắn thẳng vào store của pane đó.
export const PRIMARY_PANE_ID = "p1";

// Layout mặc định / của khách: id "default" (giữ hình vẽ cũ `<symbol>__default`, không cần migrate).
export const DEFAULT_LAYOUT_ID = "default";

type State = {
  layoutId: string; // layout đang mở: khoá của hình vẽ `<symbol>__<layoutId>` và của `/me/layouts/<id>`
  name: string;
  revision: number; // tăng mỗi lần mở layout khác: ChartGrid dùng làm key để dựng lại mọi Chart với pane mới
  panes: Record<string, Pane>;
  tree: Node; // cách chia ô (store/layoutTree.ts)
  order: string[]; // id pane theo thứ tự trong cây
  templateId: string;
  activeId: string;
  maximized: string | null; // chart đang phóng to (chỉ là trạng thái UI, không lưu)
  sync: SyncFlags; // "Sync in layout" (lưu cùng layout); việc đồng bộ thật nằm ở store/paneSync.ts
  setActive: (id: string) => void;
  setSync: (patch: Partial<SyncFlags>) => void;
  /** Đổi mẫu chia ô: giữ pane theo thứ tự, thiếu thì thêm (nhân bản symbol/khung/loại nến của pane active), thừa thì bỏ các ô cuối. */
  setTemplate: (templateId: string) => void;
  /** Kéo splitter: đổi tỉ lệ các con của nhóm tại `path`. */
  resizeAt: (path: number[], sizes: number[]) => void;
  setMaximized: (id: string | null) => void;
  setName: (name: string) => void;
  /** Layout hiện tại được lưu dưới id/tên mới (vd khách đăng nhập và Save): đổi khoá hình vẽ nên dựng lại các Chart. */
  setIdentity: (layoutId: string, name: string) => void;
  /** Mở một layout: thay toàn bộ pane/cây/tên bằng nội dung của `doc` (các Chart cũ bị huỷ, Chart mới dựng theo pane mới). */
  applyLayout: (doc: LayoutDoc, layoutId: string) => void;
};

const exitReplayOf = (p: Pane | undefined) => {
  const r = p?.replay.getState();
  if (r && (r.active || r.selecting || r.playing)) p!.replay.setState({ selecting: false, active: false, playing: false });
};

export const useLayoutStore = create<State>()((set, get) => ({
  layoutId: DEFAULT_LAYOUT_ID,
  name: "Default",
  revision: 0,
  panes: { [PRIMARY_PANE_ID]: createPane(PRIMARY_PANE_ID) },
  tree: buildTemplate("s", [PRIMARY_PANE_ID]),
  order: [PRIMARY_PANE_ID],
  templateId: "s",
  activeId: PRIMARY_PANE_ID,
  maximized: null,
  sync: DEFAULT_SYNC,

  setSync: (patch) =>
    set((s) => {
      const sync = { ...s.sync, ...patch };
      return (Object.keys(sync) as (keyof SyncFlags)[]).every((k) => sync[k] === s.sync[k]) ? s : { sync };
    }),

  setActive: (id) => {
    const { panes, activeId } = get();
    if (!panes[id] || activeId === id) return;
    exitReplayOf(panes[activeId]); // Replay chỉ chạy trên chart active: rời chart thì thoát Replay của nó
    set({ activeId: id });
  },

  setTemplate: (id) => {
    const { panes, order, activeId, templateId: cur } = get();
    const templateId = canonicalTemplateId(id); // id cũ của bản app trước → id TV
    if (!templateById(templateId)) return;
    if (templateId === cur) return;
    const { ids, added, removed, tree } = retarget(order, templateId);
    const next = { ...panes };
    const src = panes[activeId]?.chart.getState();
    for (const id of added) {
      next[id] = createPane(id, src ? { chart: { symbol: src.symbol, tf: src.tf, chartType: src.chartType } } : {});
    }
    for (const id of removed) {
      exitReplayOf(next[id]);
      delete next[id];
    }
    set({
      panes: next,
      tree,
      order: ids,
      templateId,
      activeId: ids.includes(activeId) ? activeId : ids[0],
      maximized: null,
    });
  },

  resizeAt: (path, sizes) => set((s) => ({ tree: withSizes(s.tree, path, sizes) })),

  setMaximized: (id) => {
    const { panes, maximized } = get();
    const next = id !== null && panes[id] ? id : null;
    if (next !== maximized) set({ maximized: next });
  },

  setName: (name) => set({ name: cleanName(name) }),

  setIdentity: (layoutId, name) =>
    set((s) => (s.layoutId === layoutId ? { name: cleanName(name) } : { layoutId, name: cleanName(name), revision: s.revision + 1 })),

  applyLayout: (doc, layoutId) => {
    const order = paneIds(doc.tree);
    const panes: Record<string, Pane> = {};
    for (const id of order) {
      const saved = doc.panes[id];
      panes[id] = createPane(id, {
        chart: saved.chart,
        indicators: saved.indicators,
        legendCollapsed: saved.legendCollapsed,
        volume: saved.volume,
      });
    }
    // doc cũ chưa có setting: giữ nguyên setting đang hiện (người dùng khỏi mất cách chỉnh của mình)
    if (doc.settings) useSettingsStore.getState().replace(mergeSettings(doc.settings));
    set((s) => ({
      layoutId,
      name: doc.name,
      panes,
      tree: doc.tree,
      order,
      templateId: canonicalTemplateId(doc.templateId),
      activeId: order.includes(doc.active) ? doc.active : order[0],
      maximized: null,
      sync: doc.sync,
      revision: s.revision + 1,
    }));
  },
}));

/** Document của layout đang mở (để lưu / tạo bản sao). */
export const snapshotLayout = () => {
  const s = useLayoutStore.getState();
  return buildDoc({
    name: s.name, templateId: s.templateId, tree: s.tree, order: s.order, panes: s.panes, activeId: s.activeId, sync: s.sync,
    settings: useSettingsStore.getState().s,
  });
};

export const getPane = (id: string): Pane => useLayoutStore.getState().panes[id];
export const activePane = (): Pane => {
  const s = useLayoutStore.getState();
  return s.panes[s.activeId];
};
export const allPanes = (): Pane[] => {
  const s = useLayoutStore.getState();
  return s.order.map((id) => s.panes[id]);
};
export const isActivePane = (id: string) => useLayoutStore.getState().activeId === id;

/** Lưu nốt hình vẽ của mọi chart và đợi server trả lời (đăng nhập/đăng xuất đổi nơi lưu). */
export const flushAllDrawings = () => Promise.all(allPanes().map((p) => p.draw.getState().api?.flushSave())).then(() => {});
