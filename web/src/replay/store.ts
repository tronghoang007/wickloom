import { create } from "zustand";

// Số ms giữa hai lần cập nhật
export const SPEEDS: Record<string, number> = {
  "10x": 100, "7x": 143, "5x": 200, "3x": 333, "1x": 1000, "0.5x": 2000, "0.3x": 3333, "0.1x": 10000,
};

type State = {
  selecting: boolean; // đang chọn bar bắt đầu
  active: boolean; // đã vào chế độ replay
  playing: boolean;
  speed: string;
  interval: string; // "" = theo TF của chart
};

export const useReplayStore = create<State>(() => ({
  selecting: false,
  active: false,
  playing: false,
  speed: "1x",
  interval: "",
}));

export const exitReplay = () => useReplayStore.setState({ selecting: false, active: false, playing: false });

export function toggleReplay() {
  const s = useReplayStore.getState();
  if (s.active || s.selecting) exitReplay();
  else useReplayStore.setState({ selecting: true });
}
