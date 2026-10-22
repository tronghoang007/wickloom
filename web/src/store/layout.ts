import { create } from "zustand";
import { buildTemplate, retarget, templateById, withSizes, type Node } from "./layoutTree";
import { createPane, type Pane } from "./paneStores";

// Registry các chart (pane) đang có + pane active. Toolbar, thanh vẽ, hộp tìm symbol... luôn tác động lên pane active
// (như TradingView); chỉ Chart/DrawingManager của từng pane gắn thẳng vào store của pane đó.
export const PRIMARY_PANE_ID = "p1";

type State = {
  panes: Record<string, Pane>;
  tree: Node; // cách chia ô (store/layoutTree.ts)
  order: string[]; // id pane theo thứ tự trong cây
  templateId: string;
  activeId: string;
  maximized: string | null; // chart đang phóng to (chỉ là trạng thái UI, không lưu)
  setActive: (id: string) => void;
  /** Đổi mẫu chia ô: giữ pane theo thứ tự, thiếu thì thêm (nhân bản symbol/khung/loại nến của pane active), thừa thì bỏ các ô cuối. */
  setTemplate: (templateId: string) => void;
  /** Kéo splitter: đổi tỉ lệ các con của nhóm tại `path`. */
  resizeAt: (path: number[], sizes: number[]) => void;
  setMaximized: (id: string | null) => void;
};

const exitReplayOf = (p: Pane | undefined) => {
  const r = p?.replay.getState();
  if (r && (r.active || r.selecting || r.playing)) p!.replay.setState({ selecting: false, active: false, playing: false });
};

export const useLayoutStore = create<State>()((set, get) => ({
  panes: { [PRIMARY_PANE_ID]: createPane(PRIMARY_PANE_ID) },
  tree: buildTemplate("1", [PRIMARY_PANE_ID]),
  order: [PRIMARY_PANE_ID],
  templateId: "1",
  activeId: PRIMARY_PANE_ID,
  maximized: null,

  setActive: (id) => {
    const { panes, activeId } = get();
    if (!panes[id] || activeId === id) return;
    exitReplayOf(panes[activeId]); // Replay chỉ chạy trên chart active: rời chart thì thoát Replay của nó
    set({ activeId: id });
  },

  setTemplate: (templateId) => {
    const { panes, order, activeId, templateId: cur } = get();
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
}));

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
