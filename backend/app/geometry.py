"""Alert trên hình vẽ (docs/alerts-plan.md Phase 2): giá của trendline / ray / kênh / hình chữ nhật tại NẾN HIỆN TẠI.

Chart dựng mọi hình theo chỉ số nến chứ không theo thời gian (web/src/drawings/coords.ts `timeToLogical`: nghỉ cuối tuần / giữa phiên không tính, nên H1 từ trưa thứ Sáu tới
thứ Hai chỉ cách ~26 nến). Đường thẳng trên màn hình = thẳng trong không gian (chỉ số nến, giá) - hoặc (chỉ số nến, ln giá) khi chart ở thang log. Nội suy theo thời gian
thực sẽ lệch qua mỗi kỳ nghỉ, nên ở đây dùng đúng chỉ số nến như chart: `BarStore.logical` lặp lại `timeToLogical` trên nến của backend (cùng dữ liệu chart đọc), và `geometry`
cho khoảng giá [lo, hi] của hình ở chỉ số nến của nến đang chạy. Giá chỉ đổi khi sang nến mới nên engine tính lại mỗi nến, không phải mỗi tick.

Alert giữ BẢN SAO toạ độ hình lúc tạo / sửa (không đọc layout lúc đánh giá): web cập nhật bản sao khi hình bị kéo / sửa."""
import math
from typing import Any, Dict, List, Optional, Tuple

# type của công cụ vẽ trên web -> (loại hình học, số điểm neo). hline / hray chỉ có một mức giá (không dốc).
SUPPORTED: Dict[str, Tuple[str, int]] = {
    "trendline": ("line", 2), "ray": ("line", 2), "extended": ("line", 2), "infoline": ("line", 2), "hline": ("line", 1), "hray": ("line", 1),
    "channel": ("channel", 3), "rect": ("rect", 2),
}
EXTENDS = ("none", "left", "right", "both")
LINE_CONDS = ("cross", "cross_up", "cross_down", "gt", "lt")
BAND_CONDS = ("cross", "enter", "exit", "inside", "outside")
MAX_LABEL = 40


def kind_of(spec: Dict[str, Any]) -> str:
    return SUPPORTED[spec["type"]][0]


def conds_for(spec: Optional[Dict[str, Any]]) -> Tuple[str, ...]:
    """Điều kiện hợp lệ: đường -> cắt / trên / dưới; kênh và hình chữ nhật (một dải giá) -> cắt cạnh / vào / ra / trong / ngoài."""
    return LINE_CONDS if spec is None or kind_of(spec) == "line" else BAND_CONDS


def clean_spec(raw: Any) -> Dict[str, Any]:
    """Kiểm tra và chuẩn hoá bản sao hình vẽ từ client; ValueError (tiếng Việt) khi sai."""
    if not isinstance(raw, dict):
        raise ValueError("Hình vẽ không hợp lệ")
    typ = raw.get("type")
    if typ not in SUPPORTED:
        raise ValueError("Loại hình vẽ này chưa tạo alert được")
    pts = raw.get("pts")
    n = SUPPORTED[typ][1]
    if not isinstance(pts, list) or len(pts) != n:
        raise ValueError("Toạ độ hình vẽ không hợp lệ")
    out: List[List[float]] = []
    for p in pts:
        if not (isinstance(p, (list, tuple)) and len(p) == 2) or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in p):
            raise ValueError("Toạ độ hình vẽ không hợp lệ")
        if abs(p[1]) >= 1e12 or not 0 <= p[0] < 1e11:
            raise ValueError("Toạ độ hình vẽ ngoài phạm vi")
        out.append([int(p[0]), float(p[1])])
    ext = raw.get("ext", "none")
    if ext not in EXTENDS:
        raise ValueError("Kiểu kéo dài không hợp lệ")
    ident, layout, label = raw.get("id"), raw.get("layout", ""), raw.get("label", "")
    if ident is not None and not (isinstance(ident, str) and 0 < len(ident) <= 64):
        raise ValueError("Mã hình vẽ không hợp lệ")
    if not isinstance(layout, str) or len(layout) > 64:
        raise ValueError("Layout không hợp lệ")
    if not isinstance(label, str):
        raise ValueError("Tên hình vẽ không hợp lệ")
    label = "".join(ch for ch in label if ch >= " ").strip()[:MAX_LABEL] or typ
    return {"id": ident, "layout": layout, "type": typ, "label": label, "pts": out, "ext": ext, "log": raw.get("log") is True}


def _bounded(l_now: float, l0: float, l1: float, back: bool, fwd: bool) -> Optional[str]:
    if l_now < l0 and not back:
        return "wait"  # hình chưa bắt đầu (điểm neo ở tương lai)
    if l_now > l1 and not fwd:
        return "done"  # hình đã kết thúc và không kéo dài sang phải: alert hết hiệu lực
    return None


def geometry(spec: Dict[str, Any], ls: List[float], l_now: float) -> Tuple[str, float, float]:
    """(trạng thái, lo, hi) của hình tại chỉ số nến `l_now`. `ls` = chỉ số nến của từng điểm neo (cùng gốc với `l_now`).
    Trạng thái: "ok" (lo == hi với đường), "wait" (chưa tới điểm bắt đầu), "done" (đã qua điểm cuối, không kéo dài sang phải)."""
    kind, n = SUPPORTED[spec["type"]]
    pts = spec["pts"]
    fwd, back = spec["ext"] in ("right", "both"), spec["ext"] in ("left", "both")
    if n == 1:  # hline: mọi lúc; hray: từ điểm neo trở đi
        if spec["type"] == "hray" and l_now < ls[0]:
            return ("wait", 0.0, 0.0)
        return ("ok", pts[0][1], pts[0][1])
    if kind == "rect":
        l0, l1 = sorted(ls[:2])
        st = _bounded(l_now, l0, l1, back, fwd)
        prices = [p for _, p in pts[:2]]
        return (st or "ok", min(prices), max(prices))
    log = spec["log"] and all(p > 0 for _, p in pts)
    g, gi = (math.log, math.exp) if log else (float, float)
    (la, pa), (lb, pb) = sorted(zip(ls[:2], (p for _, p in pts[:2])))
    st = _bounded(l_now, la, lb, back, fwd)
    if st:
        return (st, 0.0, 0.0)
    slope = (g(pb) - g(pa)) / (lb - la) if lb != la else 0.0
    base = g(pa) + slope * (l_now - la)
    if kind == "line":
        v = gi(base)
        return ("ok", v, v)
    off = g(pts[2][1]) - (g(pa) + slope * (ls[2] - la))  # kênh song song: đường thứ hai qua điểm neo thứ ba, cùng độ dốc
    v1, v2 = gi(base), gi(base + off)
    return ("ok", min(v1, v2), max(v1, v2))


def side(p: float, lo: float, hi: float) -> int:
    """-1 dưới dải, 0 trong dải (kể cả chạm biên), 1 trên dải."""
    return -1 if p < lo else 1 if p > hi else 0


def hit_band(cond: str, prev: Optional[float], prev_band: Optional[Tuple[float, float]], p: float, band: Tuple[float, float]) -> bool:
    """Điều kiện với dải giá [lo, hi] của kênh / hình chữ nhật. `inside` / `outside` là trạng thái (đúng là nổ, như gt / lt); còn lại là chuyển trạng thái nên cần giá liền trước."""
    s = side(p, *band)
    if cond == "inside":
        return s == 0
    if cond == "outside":
        return s != 0
    if prev is None or prev_band is None:
        return False  # tick đầu chỉ làm mốc
    ps = side(prev, *prev_band)
    if cond == "enter":
        return ps != 0 and s == 0
    if cond == "exit":
        return ps == 0 and s != 0
    return ps != s  # cross: sang một phía khác (kể cả nhảy qua cả dải)
