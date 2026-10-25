// Góc nhìn giữ qua lần đổi timeframe, như TradingView: cùng số nến hiển thị (span) và cùng khoảng cách tính bằng số nến
// từ mép phải tới nến mới nhất (back; âm = khoảng trống bên phải nến cuối). KHÔNG giữ mốc thời gian: đo trên TV,
// 15m -> 1h -> 5m luôn cách nến mới nhất cùng số nến còn mốc thời gian nhảy theo timeframe.
export type KeptView = { back: number; span: number };

export function captureView(range: { from: number; to: number }, barCount: number): KeptView {
  return { back: barCount - 1 - range.to, span: range.to - range.from };
}

export function restoreView(kv: KeptView, barCount: number): { from: number; to: number } {
  const to = barCount - 1 - kv.back;
  return { from: to - kv.span, to };
}

/** Số nến mới nhất cần có để phủ tới mép trái của góc nhìn, chừa thêm `margin` nến bên trái. */
export function barsNeeded(kv: KeptView, margin = 50): number {
  return Math.ceil(kv.back + kv.span + margin);
}
