"""Account MT5 mà các EA TVBridge báo lên: `hello` (login, tên, demo/real, tiền tệ), thông điệp `account` định kỳ
(balance/equity/margin) và trạng thái giao dịch CHỈ ĐỌC (`trade`: vị thế + lệnh chờ, `deals`: lịch sử khớp lệnh).
Chỉ lưu trong bộ nhớ: EA tự báo lại mỗi lần kết nối. Không bao giờ có mật khẩu account. (docs/trade-plan.md T1)

Backend hiện chỉ có MỘT nguồn dữ liệu một lúc (`state.ea_hub` từ chối EA thứ 2 khác server) nên danh sách thường có đúng 1 account;
registry khoá theo `server:login` để khi backend đa nguồn (docs/multi-account-plan.md Phase 1) thì không phải đổi hình dạng dữ liệu.
"""
import math
import time
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException

from .auth import current_user

MODES = {"demo", "real", "contest"}
MARGIN_MODES = {"netting", "hedging", "exchange"}
POSITION_TYPES = {"buy", "sell"}
ORDER_TYPES = {"buy_limit", "sell_limit", "buy_stop", "sell_stop", "buy_stop_limit", "sell_stop_limit"}
DEAL_TYPES = {"buy", "sell", "balance"}
DEAL_ENTRIES = {"in", "out", "inout"}
MAX_ROWS = 500  # mỗi danh sách; EA gửi nhiều hơn thì cắt


def _str(v: Any, n: int = 100) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _int(v: Any) -> int:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
        return 0
    return int(v)


def _num(v: Any) -> Optional[float]:
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return float(v)


def _flag(v: Any) -> Optional[bool]:
    return v if isinstance(v, bool) else None


def _row(d: Any, ints: tuple, nums: tuple, strs: tuple, enums: Dict[str, set], need_symbol: bool) -> Optional[Dict[str, Any]]:
    """Một dòng vị thế/lệnh/deal từ EA: chỉ giữ trường đã biết, ép kiểu; không có ticket (hoặc symbol khi cần) thì bỏ."""
    if not isinstance(d, dict):
        return None
    out: Dict[str, Any] = {k: _int(d.get(k)) for k in ints}
    out.update({k: (_num(d.get(k)) or 0.0) for k in nums})
    out.update({k: _str(d.get(k), 64 if k == "comment" else 32) for k in strs})
    for k, allowed in enums.items():
        out[k] = d.get(k) if d.get(k) in allowed else ("other" if k == "type" else "")
    if not out.get("ticket") or (need_symbol and not out.get("symbol")):
        return None
    return out


def _rows(v: Any, **kw: Any) -> List[Dict[str, Any]]:
    rows = (_row(d, **kw) for d in (v[:MAX_ROWS] if isinstance(v, list) else []))
    return [r for r in rows if r is not None]


def _positions(v: Any) -> List[Dict[str, Any]]:
    return _rows(v, ints=("ticket", "time", "magic"), nums=("volume", "price_open", "sl", "tp", "price_current", "profit", "swap"),
                 strs=("symbol", "comment"), enums={"type": POSITION_TYPES}, need_symbol=True)


def _orders(v: Any) -> List[Dict[str, Any]]:
    return _rows(v, ints=("ticket", "time_setup", "expiration", "magic"), nums=("volume", "price_open", "price_stoplimit", "sl", "tp"),
                 strs=("symbol", "comment"), enums={"type": ORDER_TYPES}, need_symbol=True)


def _deals(v: Any) -> List[Dict[str, Any]]:
    rows = _rows(v, ints=("ticket", "order", "time", "magic"), nums=("volume", "price", "profit", "commission", "swap"),
                 strs=("symbol", "comment"), enums={"type": DEAL_TYPES, "entry": DEAL_ENTRIES}, need_symbol=False)
    return sorted(rows, key=lambda r: -r["time"])


class Mt5Registry:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self._info: Dict[str, Dict[str, Any]] = {}
        self._by_writer: Dict[Any, str] = {}
        self._trade: Dict[str, Dict[str, Any]] = {}

    @staticmethod
    def account_id(ident: str, login: int) -> str:
        return f"{ident}:{login}" if login else ident

    def register(self, writer: Any, hello: Dict[str, Any]) -> Optional[str]:
        """EA vừa kết nối. EA < v2.10 không báo login/mode → account chỉ có server, mode "unknown"."""
        server, broker = _str(hello.get("server")), _str(hello.get("broker"))
        ident = server or broker
        if not ident:
            return None
        login = _int(hello.get("login"))
        aid = self.account_id(ident, login)
        mode = hello.get("mode") if hello.get("mode") in MODES else "unknown"
        info = self._info.get(aid, {})
        info.update(
            id=aid, server=server, broker=broker, login=login or None, name=_str(hello.get("name")), mode=mode,
            currency=_str(hello.get("currency"), 8), leverage=_int(hello.get("leverage")) or None, seen=self.clock(),
        )
        self._info[aid] = info
        self._by_writer[writer] = aid
        return aid

    def update(self, writer: Any, msg: Dict[str, Any]) -> None:
        """Thông điệp `account` định kỳ của EA: số dư. Giá trị lạ (NaN, sai kiểu) bị bỏ qua."""
        aid = self._by_writer.get(writer)
        if aid is None:
            return
        info = self._info[aid]
        for k in ("balance", "equity", "margin", "margin_free", "margin_level", "profit"):
            v = _num(msg.get(k))
            if v is not None:
                info[k] = v
        for k in ("trade_allowed", "terminal_trade_allowed"):  # EA có quyền giao dịch không (T1: chỉ để hiện, chưa có trade)
            v = _flag(msg.get(k))
            if v is not None:
                info[k] = v
        if msg.get("margin_mode") in MARGIN_MODES:
            info["margin_mode"] = msg["margin_mode"]
        info["seen"] = self.clock()

    def update_trade(self, writer: Any, msg: Dict[str, Any]) -> None:
        """`trade` = vị thế + lệnh chờ hiện tại (thay thế cả hai); `deals` = lịch sử khớp lệnh gần đây (thay thế)."""
        aid = self._by_writer.get(writer)
        if aid is None:
            return
        t = self._trade.setdefault(aid, {"positions": [], "orders": [], "deals": [], "updated_at": None})
        if msg.get("type") == "trade":
            t["positions"], t["orders"] = _positions(msg.get("positions")), _orders(msg.get("orders"))
            t["updated_at"] = self.clock()
        elif msg.get("type") == "deals":
            t["deals"] = _deals(msg.get("deals"))

    def trade(self, aid: str) -> Optional[Dict[str, Any]]:
        """Trạng thái giao dịch của account `aid` (vị thế/lệnh/deal lần cuối EA báo); None nếu account chưa từng kết nối."""
        info = self._info.get(aid)
        if info is None:
            return None
        t = self._trade.get(aid, {"positions": [], "orders": [], "deals": [], "updated_at": None})
        return {"account": next(a for a in self.snapshot() if a["id"] == aid), **t}

    def remove(self, writer: Any) -> None:
        self._by_writer.pop(writer, None)

    def snapshot(self) -> List[Dict[str, Any]]:
        """Online trước, rồi theo lần thấy gần nhất. `active` = account đang cấp dữ liệu (hoặc vừa cấp gần nhất khi offline)."""
        online = set(self._by_writer.values())
        rows = sorted(self._info.values(), key=lambda i: (i["id"] not in online, -i["seen"]))
        return [{**i, "online": i["id"] in online, "active": n == 0} for n, i in enumerate(rows)]

    def clear(self) -> None:
        self._info.clear()
        self._by_writer.clear()
        self._trade.clear()


registry = Mt5Registry()
router = APIRouter()


@router.get("/accounts")
def list_accounts(_user=Depends(current_user)):
    """Account MT5 đang/đã kết nối. Cần đăng nhập Wickloom (có số dư). `switchable` = backend có cho chuyển giữa các account không
    (chưa: chỉ 1 nguồn; đổi account = đăng nhập account khác trong MT5)."""
    return {"accounts": registry.snapshot(), "switchable": False}


@router.get("/accounts/{account_id}/trade")
def account_trade(account_id: str, _user=Depends(current_user)):
    """CHỈ ĐỌC: vị thế, lệnh chờ, lịch sử khớp lệnh gần đây của account + tóm tắt account. Không có endpoint gửi/sửa lệnh (docs/trade-plan.md T2+).
    `updated_at` = lúc EA báo vị thế/lệnh lần cuối (None nếu chưa báo); account offline thì dữ liệu là bản cuối cùng (UI phải đánh dấu cũ)."""
    t = registry.trade(account_id)
    if t is None:
        raise HTTPException(404, "Không có account MT5 này")
    return t
