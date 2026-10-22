import { composeStore } from "@/store/compose";

// Số ms giữa hai lần cập nhật
export const SPEEDS: Record<string, number> = {
  "10x": 100, "7x": 143, "5x": 200, "3x": 333, "1x": 1000, "0.5x": 2000, "0.3x": 3333, "0.1x": 10000,
};

export const useReplayStore = composeStore({
  pane: (p) => p.replay,
  paneKeys: ["selecting", "active", "playing", "speed", "interval"],
});

type ReplayTarget = { setState: (p: { selecting?: boolean; active?: boolean; playing?: boolean }) => void };

/** Thoát Replay của một pane (Chart truyền `pane.replay`); không truyền = pane đang active (Toolbar). */
export const exitReplay = (target: ReplayTarget = useReplayStore) =>
  target.setState({ selecting: false, active: false, playing: false });

export function toggleReplay() {
  const s = useReplayStore.getState();
  if (s.active || s.selecting) exitReplay();
  else useReplayStore.setState({ selecting: true });
}
