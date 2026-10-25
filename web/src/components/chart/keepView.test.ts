import { describe, expect, it } from "vitest";
import { barsNeeded, captureView, restoreView } from "./keepView";

describe("keepView", () => {
  it("đang xem lịch sử: cách nến mới nhất bao nhiêu nến thì sang TF khác vẫn cách bấy nhiêu nến (số liệu đo trên TV: 256 nến, span 290)", () => {
    const kv = captureView({ from: 710, to: 1000 }, 1257); // nến cuối = chỉ số 1256
    expect(kv).toEqual({ back: 256, span: 290 });
    expect(restoreView(kv, 500)).toEqual({ from: -47, to: 243 }); // 499 - 256
    expect(restoreView(kv, 1500)).toEqual({ from: 953, to: 1243 });
  });

  it("đang ở nến mới nhất: giữ zoom và khoảng trống bên phải (TV: span 263, lệch -10 qua 15m -> 1h)", () => {
    const kv = captureView({ from: 1737, to: 2010 }, 2001); // to = 2010 > 2000: 10 nến trống
    expect(kv).toEqual({ back: -10, span: 273 });
    expect(restoreView(kv, 500)).toEqual({ from: 236, to: 509 }); // 499 + 10 nến trống
  });

  it("đổi qua lại nhiều lần không trôi vị trí", () => {
    const kv = captureView({ from: 100.5, to: 400.25 }, 700);
    const there = restoreView(kv, 3000);
    const back = captureView(there, 3000);
    expect(restoreView(back, 700)).toEqual({ from: 100.5, to: 400.25 });
  });

  it("barsNeeded: nến tính từ nến mới nhất tới mép trái + chừa 50; ở nến mới nhất không đòi hơn span", () => {
    expect(barsNeeded({ back: 256, span: 290 })).toBe(596);
    expect(barsNeeded({ back: -8, span: 302 })).toBe(344);
    expect(barsNeeded({ back: 10.2, span: 20 }, 0)).toBe(31);
  });
});
