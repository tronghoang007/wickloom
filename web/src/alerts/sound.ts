import type { AlertSound } from "./store";

// Âm báo tự sinh bằng Web Audio (không tải file). Trình duyệt chỉ cho phát âm sau khi người dùng đã bấm / gõ phím trong trang, nên `unlockAudio` gắn vào cú tương tác đầu tiên.

let ctx: AudioContext | null = null;

function context(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    ctx = AC ? new AC() : null;
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Gọi từ một sự kiện của người dùng để về sau alert nổ (không có cử chỉ nào) vẫn phát được tiếng. */
export function unlockAudio(): void {
  const c = context();
  if (c && c.state === "suspended") void c.resume().catch(() => {});
}

type Note = { f: number; at: number; len: number; type?: OscillatorType };
const PATTERNS: Record<Exclude<AlertSound, "off">, Note[]> = {
  chime: [{ f: 880, at: 0, len: 0.22 }, { f: 1320, at: 0.16, len: 0.4 }],
  beep: [{ f: 1000, at: 0, len: 0.25, type: "square" }],
  alarm: [0, 0.3, 0.6].map((at) => ({ f: 1200, at, len: 0.18, type: "square" as const })),
};

export function playAlertSound(kind: AlertSound): void {
  if (kind === "off") return;
  const c = context();
  if (!c) return;
  try {
    if (c.state === "suspended") void c.resume().catch(() => {});
    const t0 = c.currentTime + 0.02;
    for (const n of PATTERNS[kind]) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = n.type ?? "sine";
      osc.frequency.value = n.f;
      const peak = n.type === "square" ? 0.08 : 0.2; // sóng vuông to hơn hẳn sóng sin ở cùng biên độ
      gain.gain.setValueAtTime(0.0001, t0 + n.at);
      gain.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
      osc.connect(gain).connect(c.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + n.len + 0.05);
    }
  } catch {
    /* thiết bị âm thanh không dùng được: bỏ qua, toast vẫn hiện */
  }
}
