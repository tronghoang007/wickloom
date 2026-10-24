"""Delta theo tick cho CVD "Data aggregation = 1 tick" của web.

EA gửi lịch sử tick (`ticks_hist`, giá + trọng số từng tick) khi web xin backfill tf "TD"; ở đây mỗi tick được phân loại lên / xuống rồi gom thành
MỖI PHÚT một "nến delta" lưu trong bảng `bars` với tf "TD" (không lưu tick thô):
  o = 0, c = delta tích luỹ cuối phút, h / l = đỉnh / đáy của delta tích luỹ qua từng tick trong phút (gồm cả mốc 0 đầu phút), v = tổng trọng số.
Web nối các phút lại thành nến CVD của chart (đầu nến = delta tích luỹ trước đó, h / l = đầu + h / l của từng phút) nên high / low chính xác tới từng tick.

Cùng lượt phân loại đó còn gom histogram giá theo phút (`hist`: (phút, giá) -> [volume lên, volume xuống]) lưu ở bảng `tickvp` cho Session / Visible Range
Volume Profile "1 tick": mỗi tick rơi đúng vào row chứa giá của nó thay vì chia volume nến theo vùng giá. Một phút có dòng `bars` "TD" thì cũng có dòng `tickvp`.

Chiều của tick như script TV (ta.requestVolumeDelta với khung 1 tick): giá cao hơn tick trước = lên, thấp hơn = xuống, bằng nhau thì giữ chiều trước.
"""
from typing import Any, Dict, List, Optional, Tuple

from .models import TicksHistIn

TICK_DELTA_TF = "TD"

# symbol -> (giá, chiều) của tick cuối thông điệp trước, dùng cho thông điệp `cont` kế tiếp cùng một yêu cầu
_carry: Dict[str, Tuple[float, int]] = {}


def classify(t_msc: List[int], price: List[float], weight: Optional[List[float]], prev_price: float, prev_dir: int,
             hist: Optional[Dict[Tuple[int, float], List[float]]] = None) -> Tuple[List[Dict[str, Any]], float, int]:
    """Gom các tick (tăng dần theo t_msc, UTC) thành nến delta từng phút. Trả (các dòng bars, giá cuối, chiều cuối).
    `prev_price` <= 0 = không biết tick liền trước: tick đầu lấy `prev_dir`. `hist` (nếu có) cộng thêm trọng số từng tick vào ô (phút, giá)."""
    rows: List[Dict[str, Any]] = []
    minute: Optional[int] = None
    cum = hi = lo = vol = 0.0
    for i, p in enumerate(price):
        if p <= 0:
            continue
        w = weight[i] if weight is not None and i < len(weight) and weight[i] > 0 else 1.0
        d = (1 if p > prev_price else -1 if p < prev_price else prev_dir) if prev_price > 0 else prev_dir
        prev_price, prev_dir = p, d
        m = t_msc[i] // 60000 * 60
        if hist is not None:
            hist.setdefault((m, p), [0.0, 0.0])[0 if d > 0 else 1] += w
        if m != minute:
            if minute is not None:
                rows.append({"t": minute, "o": 0.0, "h": hi, "l": lo, "c": cum, "v": vol})
            minute, cum, hi, lo, vol = m, 0.0, 0.0, 0.0, 0.0
        cum += d * w
        hi = max(hi, cum)
        lo = min(lo, cum)
        vol += w
    if minute is not None:
        rows.append({"t": minute, "o": 0.0, "h": hi, "l": lo, "c": cum, "v": vol})
    return rows, prev_price, prev_dir


def ingest(body: TicksHistIn, hist: Optional[Dict[Tuple[int, float], List[float]]] = None) -> List[Dict[str, Any]]:
    """Phân loại một thông điệp `ticks_hist` -> các dòng bars tf "TD" (người gọi ghi vào kho) và, nếu có `hist`, histogram giá theo phút.
    EA cắt thông điệp ở ranh giới phút nên mỗi phút nằm trọn trong một thông điệp."""
    off = body.broker_utc_offset * 1000
    t = [x - off for x in body.t]
    cont = _carry.get(body.symbol) if body.cont else None
    prev_price, prev_dir = cont if cont else (body.pb, -1 if body.pd < 0 else 1)
    rows, last_price, last_dir = classify(t, body.p, body.w, prev_price, prev_dir, hist)
    _carry[body.symbol] = (last_price, last_dir)
    return rows
