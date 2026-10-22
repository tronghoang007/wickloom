import { create } from "zustand";
import { createPane, type Pane, type PaneInit } from "./paneStores";

// Registry các chart (pane) đang có + pane active. Toolbar, thanh vẽ, hộp tìm symbol... luôn tác động lên pane active
// (như TradingView); chỉ Chart/DrawingManager của từng pane gắn thẳng vào store của pane đó.
export const PRIMARY_PANE_ID = "p1";

type State = {
  order: string[]; // thứ tự pane (theo layout)
  panes: Record<string, Pane>;
  activeId: string;
  setActive: (id: string) => void;
  add: (id: string, init?: PaneInit) => Pane;
  remove: (id: string) => void;
};

export const useLayoutStore = create<State>()((set, get) => ({
  order: [PRIMARY_PANE_ID],
  panes: { [PRIMARY_PANE_ID]: createPane(PRIMARY_PANE_ID) },
  activeId: PRIMARY_PANE_ID,
  setActive: (id) => {
    if (get().panes[id] && get().activeId !== id) set({ activeId: id });
  },
  add: (id, init) => {
    const pane = createPane(id, init);
    set((s) => ({ order: [...s.order, id], panes: { ...s.panes, [id]: pane } }));
    return pane;
  },
  remove: (id) =>
    set((s) => {
      if (id === PRIMARY_PANE_ID || !s.panes[id]) return s;
      const { [id]: _gone, ...panes } = s.panes;
      void _gone;
      const order = s.order.filter((x) => x !== id);
      return { panes, order, activeId: s.activeId === id ? order[0] : s.activeId };
    }),
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
