"""Alert theo indicator (docs/alerts-plan.md Phase 3, mục 4): port sang Python vài indicator hay dùng của web (web/src/indicators/ta + defs: SMA, EMA, WMA, RSI, MACD, Bollinger Bands,
Stochastic) để backend tính được khi tắt tab. Kết quả PHẢI khớp web: cùng quy ước na / seed của Pine, cùng thứ tự phép tính. `tests/fixtures/indicators.json` do TypeScript sinh ra
(web/src/indicators/pyFixtures.test.ts) và cả hai phía cùng được kiểm với nó, nên bên nào đổi công thức thì test bên đó vỡ.

Chỉ port phần cần cho alert: các plot cắt / so sánh được. Offset của MA / Bollinger dịch đường như trên chart (`shift`), nên alert so đúng đường người dùng nhìn thấy: Offset dương
lấy giá trị của `offset` nến trước, âm thì nến hiện tại chưa có giá trị (như chart) và alert không nổ."""
import math
from collections import deque
from typing import Any, Callable, Deque, Dict, List, Optional, Tuple

NAN = math.nan
SOURCES = ("open", "high", "low", "close", "hl2", "hlc3", "ohlc4", "hlcc4")
SMOOTH_TYPES = ("None", "SMA", "SMA + Bollinger Bands", "EMA", "SMMA (RMA)", "WMA", "VWMA")
MA_TYPES = ("SMA", "EMA", "SMMA (RMA)", "WMA", "VWMA")
MAX_LABEL = 80

Series = List[float]
Bars = List[Dict[str, Any]]


def isna(x: Optional[float]) -> bool:
    return x is None or x != x


# --- ta (web/src/indicators/ta) -----------------------------------------------------------------------------------------------------------------------------

def source(bars: Bars, name: str) -> Series:
    out: Series = []
    for b in bars:
        if name == "open":
            out.append(b["o"])
        elif name == "high":
            out.append(b["h"])
        elif name == "low":
            out.append(b["l"])
        elif name == "hl2":
            out.append((b["h"] + b["l"]) / 2)
        elif name == "hlc3":
            out.append((b["h"] + b["l"] + b["c"]) / 3)
        elif name == "ohlc4":
            out.append((b["o"] + b["h"] + b["l"] + b["c"]) / 4)
        elif name == "hlcc4":
            out.append((b["h"] + b["l"] + 2 * b["c"]) / 4)
        else:
            out.append(b["c"])
    return out


def sma(a: Series, n: int) -> Series:
    out = [NAN] * len(a)
    total, bad = 0.0, 0
    for i, x in enumerate(a):
        if isna(x):
            bad += 1
        else:
            total += x
        if i >= n:
            if isna(a[i - n]):
                bad -= 1
            else:
                total -= a[i - n]
        if i >= n - 1 and bad == 0:
            out[i] = total / n
    return out


def wma(a: Series, n: int) -> Series:
    out = [NAN] * len(a)
    den = (n * (n + 1)) / 2
    s = w = 0.0
    bad = 0
    for i, v in enumerate(a):
        x = 0.0 if isna(v) else v
        if isna(v):
            bad += 1
        if i < n:
            w += (i + 1) * x
            s += x
        else:
            old = 0.0 if isna(a[i - n]) else a[i - n]
            if isna(a[i - n]):
                bad -= 1
            w = w - s + n * x
            s = s - old + x
        if i >= n - 1 and bad == 0:
            out[i] = w / den
    return out


def ema(a: Series, n: int) -> Series:
    out = [NAN] * len(a)
    alpha = 2 / (n + 1)
    prev = NAN
    for i, x in enumerate(a):
        if isna(x):
            prev = NAN
            continue
        prev = x if isna(prev) else alpha * x + (1 - alpha) * prev
        out[i] = prev
    return out


def rma(a: Series, n: int) -> Series:
    out = [NAN] * len(a)
    seed = sma(a, n)
    alpha = 1 / n
    prev = NAN
    for i, x in enumerate(a):
        if isna(x):
            prev = NAN
            continue
        prev = seed[i] if isna(prev) else alpha * x + (1 - alpha) * prev
        out[i] = prev
    return out


def vwma(a: Series, vol: Series, n: int) -> Series:
    pv = sma([x * vol[i] for i, x in enumerate(a)], n)
    v = sma(vol, n)
    return [_div(x, v[i]) for i, x in enumerate(pv)]


def _div(x: float, y: float) -> float:
    """Phép chia kiểu JavaScript: chia cho 0 ra ±Infinity (0 / 0 là NaN) thay vì ném lỗi."""
    if y != 0:
        return x / y
    return NAN if x == 0 or isna(x) else math.copysign(math.inf, x) * math.copysign(1.0, y)


def ma(kind: str, a: Series, n: int, vol: Series) -> Series:
    if kind == "EMA":
        return ema(a, n)
    if kind == "SMMA (RMA)":
        return rma(a, n)
    if kind == "WMA":
        return wma(a, n)
    if kind == "VWMA":
        return vwma(a, vol, n)
    return sma(a, n)


def stdev(a: Series, n: int) -> Series:
    out = [NAN] * len(a)
    mean = sma(a, n)
    for i in range(n - 1, len(a)):
        if isna(mean[i]):
            continue
        s = 0.0
        for j in range(i - n + 1, i + 1):
            s += (a[j] - mean[i]) ** 2
        out[i] = math.sqrt(s / n)
    return out


def shift(a: Series, offset: int) -> Series:
    """Như `shiftBy` của web (engine.ts) nhưng giữ đúng độ dài: phần tử i là a[i - offset], ngoài mảng là NaN (phần tương lai của Offset dương bỏ đi)."""
    if offset == 0:
        return a
    n = len(a)
    return [a[i - offset] if 0 <= i - offset < n else NAN for i in range(n)]


def change(a: Series) -> Series:
    return [NAN if i == 0 else x - a[i - 1] for i, x in enumerate(a)]


def _extreme(a: Series, n: int, better: Callable[[float, float], bool]) -> Series:
    out = [NAN] * len(a)
    q: Deque[int] = deque()
    for i, x in enumerate(a):
        if not isna(x):
            while q and not better(a[q[-1]], x):
                q.pop()
            q.append(i)
        while q and q[0] <= i - n:
            q.popleft()
        if i >= n - 1 and q:
            out[i] = a[q[0]]
    return out


def highest(a: Series, n: int) -> Series:
    return _extreme(a, n, lambda x, y: x > y)


def lowest(a: Series, n: int) -> Series:
    return _extreme(a, n, lambda x, y: x < y)


def rsi(a: Series, n: int) -> Series:
    ch = change(a)
    up = rma([NAN if isna(x) else max(x, 0.0) for x in ch], n)
    dn = rma([NAN if isna(x) else max(-x, 0.0) for x in ch], n)
    out: Series = []
    for u, d in zip(up, dn):
        if isna(u) or isna(d):
            out.append(NAN)
        elif d == 0:
            out.append(100.0)
        elif u == 0:
            out.append(0.0)
        else:
            out.append(100 - 100 / (1 + u / d))
    return out


# --- indicator (web/src/indicators/defs) ------------------------------------------------------------------------------------------------------------------

def _warm(k: float, *ns: int) -> int:
    return math.ceil(k * max(ns))


def _ma_warmup(kind: str, n: int) -> int:
    return _warm(4, n) if kind == "EMA" else _warm(10, n) if kind == "SMMA (RMA)" else n


def _smooth_on(i: Dict[str, Any]) -> bool:
    return i["smoothType"] != "None"


def _smooth_warmup(i: Dict[str, Any]) -> int:
    return _ma_warmup("SMA" if i["smoothType"] == "SMA + Bollinger Bands" else str(i["smoothType"]), int(i["smoothLength"])) if _smooth_on(i) else 0


def _smoothing(i: Dict[str, Any], s: Series, vol: Series) -> Dict[str, Series]:
    """Nhóm "Smoothing" của TV (đường MA của chính indicator, hoặc MA + dải Bollinger): plot sm / smUpper / smLower."""
    empty = [NAN] * len(s)
    if not _smooth_on(i):
        return {"sm": empty, "smUpper": empty, "smLower": empty}
    n = int(i["smoothLength"])
    bb = i["smoothType"] == "SMA + Bollinger Bands"
    m = ma("SMA" if bb else str(i["smoothType"]), s, n, vol)
    if not bb:
        return {"sm": m, "smUpper": empty, "smLower": empty}
    dev, k = stdev(s, n), float(i["smoothMult"])
    return {"sm": m, "smUpper": [x + k * dev[j] for j, x in enumerate(m)], "smLower": [x - k * dev[j] for j, x in enumerate(m)]}


def _inp(key: str, kind: str, default: Any, **kw: Any) -> Dict[str, Any]:
    return {"key": key, "type": kind, "default": default, **kw}


def _smooth_inputs(default: str = "None") -> List[Dict[str, Any]]:
    return [_inp("smoothType", "select", default, options=SMOOTH_TYPES), _inp("smoothLength", "int", 14, min=1), _inp("smoothMult", "float", 2.0, min=0.001)]


_SRC = _inp("src", "source", "close")
_OFFSET = _inp("offset", "int", 0, min=-500, max=500)  # offsetInput() của web (defs/common.ts)
_SMOOTH_PLOTS = ("sm", "smUpper", "smLower")


def _length(default: int, key: str = "length") -> Dict[str, Any]:
    return _inp(key, "int", default, min=1)


def _c_sma(bars: Bars, i: Dict[str, Any]) -> Dict[str, Series]:
    m = sma(source(bars, i["src"]), i["length"])
    return {"sma": shift(m, i["offset"]), **_smoothing(i, m, [b["v"] for b in bars])}  # Smoothing tính trên đường chưa dịch và không dịch (như web)


def _c_ema(bars: Bars, i: Dict[str, Any]) -> Dict[str, Series]:
    m = ema(source(bars, i["src"]), i["length"])
    return {"ema": shift(m, i["offset"]), **_smoothing(i, m, [b["v"] for b in bars])}


def _c_wma(bars: Bars, i: Dict[str, Any]) -> Dict[str, Series]:
    return {"wma": shift(wma(source(bars, i["src"]), i["length"]), i["offset"])}


def _c_rsi(bars: Bars, i: Dict[str, Any]) -> Dict[str, Series]:
    r = rsi(source(bars, i["src"]), i["length"])
    return {"rsi": r, **_smoothing(i, r, [b["v"] for b in bars])}


def _macd_ma(kind: str, s: Series, n: int) -> Series:
    return sma(s, n) if kind == "SMA" else ema(s, n)


def _c_macd(bars: Bars, i: Dict[str, Any]) -> Dict[str, Series]:
    s = source(bars, i["src"])
    fast, slow = _macd_ma(i["oscMa"], s, i["fast"]), _macd_ma(i["oscMa"], s, i["slow"])
    line = [x - slow[j] for j, x in enumerate(fast)]
    signal = _macd_ma(i["signalMa"], line, i["signal"])
    return {"macd": line, "signal": signal, "hist": [x - signal[j] for j, x in enumerate(line)]}


def _c_bb(bars: Bars, i: Dict[str, Any]) -> Dict[str, Series]:
    s, n, k = source(bars, i["src"]), i["length"], float(i["mult"])
    basis, dev = ma(i["maType"], s, n, [b["v"] for b in bars]), stdev(s, n)
    off = i["offset"]
    return {"basis": shift(basis, off), "upper": shift([x + k * dev[j] for j, x in enumerate(basis)], off), "lower": shift([x - k * dev[j] for j, x in enumerate(basis)], off)}


def _c_stoch(bars: Bars, i: Dict[str, Any]) -> Dict[str, Series]:
    hh, ll = highest([b["h"] for b in bars], i["k"]), lowest([b["l"] for b in bars], i["k"])
    raw = [NAN if hh[j] == ll[j] else (100 * (b["c"] - ll[j])) / (hh[j] - ll[j]) for j, b in enumerate(bars)]
    k = sma(raw, i["smooth"])
    return {"k": k, "d": sma(k, i["d"])}


# id -> {inputs, plots (id: tên hiện trong hộp thoại alert), warmup, compute}. Thứ tự input / plot và mặc định đúng như web (defs/overlays.ts, defs/oscillators.ts).
INDICATORS: Dict[str, Dict[str, Any]] = {
    "sma": {
        "inputs": [_length(9), _SRC, _OFFSET, *_smooth_inputs()], "plots": {"sma": "MA", "sm": "SMA-based MA", "smUpper": "Upper Bollinger Band", "smLower": "Lower Bollinger Band"},
        "warmup": lambda i: i["length"] + _smooth_warmup(i), "compute": _c_sma,
    },
    "ema": {
        "inputs": [_length(9), _SRC, _OFFSET, *_smooth_inputs()], "plots": {"ema": "EMA", "sm": "EMA-based MA", "smUpper": "Upper Bollinger Band", "smLower": "Lower Bollinger Band"},
        "warmup": lambda i: _warm(4, i["length"]) + _smooth_warmup(i), "compute": _c_ema,
    },
    "wma": {
        "inputs": [_length(9), _SRC, _OFFSET], "plots": {"wma": "WMA"}, "warmup": lambda i: i["length"], "compute": _c_wma,
    },
    "rsi": {
        "inputs": [_length(14), _SRC, *_smooth_inputs("SMA")], "plots": {"rsi": "RSI", "sm": "RSI-based MA", "smUpper": "Upper Bollinger Band", "smLower": "Lower Bollinger Band"},
        "warmup": lambda i: _warm(10, i["length"]) + _smooth_warmup(i), "compute": _c_rsi,
    },
    "macd": {
        "inputs": [_SRC, _length(12, "fast"), _length(26, "slow"), _length(9, "signal"), _inp("oscMa", "select", "EMA", options=("EMA", "SMA")), _inp("signalMa", "select", "EMA", options=("EMA", "SMA"))],
        "plots": {"macd": "MACD", "signal": "Signal", "hist": "Histogram"},
        "warmup": lambda i: _ma_warmup(i["oscMa"], max(i["fast"], i["slow"])) + _ma_warmup(i["signalMa"], i["signal"]), "compute": _c_macd,
    },
    "bb": {
        "inputs": [_length(20), _inp("maType", "select", "SMA", options=MA_TYPES), _SRC, _inp("mult", "float", 2.0, min=0.001), _OFFSET],
        "plots": {"basis": "Basis", "upper": "Upper", "lower": "Lower"}, "warmup": lambda i: _ma_warmup(i["maType"], i["length"]), "compute": _c_bb,
    },
    "stoch": {
        "inputs": [_length(14, "k"), _length(1, "smooth"), _length(3, "d")], "plots": {"k": "%K", "d": "%D"},
        "warmup": lambda i: i["k"] + i["smooth"] + i["d"], "compute": _c_stoch,
    },
}


def coerce(spec: Dict[str, Any], v: Any) -> Any:
    """Giá trị hợp lệ theo kiểu input (như `coerceInput` của web), None nếu không dùng được."""
    t = spec["type"]
    if t in ("int", "float"):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            return None
        x = math.floor(v + 0.5) if t == "int" else float(v)  # Math.round của JS: .5 làm tròn lên (round() của Python làm tròn về số chẵn)
        lo, hi = spec.get("min", -math.inf), spec.get("max", math.inf)
        return int(min(hi, max(lo, x))) if t == "int" else min(hi, max(lo, x))
    if t == "bool":
        return v if isinstance(v, bool) else None
    if t == "select":
        return v if isinstance(v, str) and v in spec["options"] else None
    if t == "source":
        return v if isinstance(v, str) and v in SOURCES else None
    return None


def resolve(ind_id: str, given: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Inputs đầy đủ: giá trị đã đặt nếu hợp lệ, không thì mặc định (như `resolveInputs` của web). Key lạ bỏ."""
    given = given if isinstance(given, dict) else {}
    out: Dict[str, Any] = {}
    for s in INDICATORS[ind_id]["inputs"]:
        v = coerce(s, given.get(s["key"]))
        out[s["key"]] = s["default"] if v is None else v
    return out


def _needs_smoothing(plot: str, inputs: Dict[str, Any]) -> Optional[str]:
    if plot in _SMOOTH_PLOTS:
        if inputs["smoothType"] == "None":
            return "Bật Smoothing trong Settings của indicator trước"
        if plot != "sm" and inputs["smoothType"] != "SMA + Bollinger Bands":
            return "Dải Bollinger của Smoothing chỉ có khi Type là SMA + Bollinger Bands"
    return None


def clean_spec(raw: Any) -> Dict[str, Any]:
    """Alert theo indicator từ client -> bản đã kiểm: {id, inputs (đầy đủ), plot, vs, label}. `vs` = "level" (so với `level` của alert), "price" (giá đóng nến / giá hiện tại)
    hoặc id một plot khác của cùng indicator. Sai -> ValueError (tiếng Việt, hiện nguyên cho người dùng)."""
    if not isinstance(raw, dict):
        raise ValueError("Alert theo indicator không hợp lệ")
    ind_id = raw.get("id")
    if not isinstance(ind_id, str) or ind_id not in INDICATORS:
        raise ValueError("Indicator này chưa tạo alert được")
    inputs = resolve(ind_id, raw.get("inputs"))
    plots = INDICATORS[ind_id]["plots"]
    plot, vs = raw.get("plot"), raw.get("vs")
    if not isinstance(plot, str) or plot not in plots:
        raise ValueError("Chọn đường của indicator để đặt alert")
    if not isinstance(vs, str) or not (vs in ("level", "price") or (vs in plots and vs != plot)):
        raise ValueError("Chọn giá trị để so sánh (mức giá, giá, hoặc một đường khác)")
    for p in (plot, vs):
        problem = _needs_smoothing(p, inputs) if p in plots else None
        if problem:
            raise ValueError(problem)
    label = raw.get("label")
    label = " ".join(label.split())[:MAX_LABEL] if isinstance(label, str) and label.strip() else INDICATORS[ind_id]["plots"][plot]
    vs_label = "" if vs == "level" else "price" if vs == "price" else plots[vs]
    return {"id": ind_id, "inputs": inputs, "plot": plot, "vs": vs, "label": label, "vs_label": vs_label}


def warmup(spec: Dict[str, Any]) -> int:
    return int(INDICATORS[spec["id"]]["warmup"](spec["inputs"]))


HISTORY_FLOOR = 300  # tối thiểu nến lấy để tính
HISTORY_CAP = 3000


def history_need(spec: Dict[str, Any]) -> int:
    """Số nến cần có (đã đóng) để giá trị hội tụ như web: warmup của indicator (cộng Offset dương: giá trị ở nến hiện tại là của `offset` nến trước) cộng dư,
    kẹp vào [HISTORY_FLOOR, HISTORY_CAP]."""
    return max(HISTORY_FLOOR, min(HISTORY_CAP, warmup(spec) + max(0, int(spec["inputs"].get("offset", 0))) + 100))


def compute(spec: Dict[str, Any], bars: Bars) -> Tuple[Series, Optional[Series]]:
    """Giá trị theo từng nến của đường `plot` và của thứ nó được so với (`vs`): đường khác / giá đóng nến; None khi so với một mức cố định."""
    out = INDICATORS[spec["id"]]["compute"](bars, spec["inputs"])
    vs = spec["vs"]
    return out[spec["plot"]], (None if vs == "level" else [b["c"] for b in bars] if vs == "price" else out[vs])
