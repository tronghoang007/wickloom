"""Account MT5 mà các EA TVBridge báo lên: `hello` (login, tên, demo/real, tiền tệ) và thông điệp `account` định kỳ
(balance/equity). Chỉ lưu trong bộ nhớ: EA tự báo lại mỗi lần kết nối. Không bao giờ có mật khẩu account.

Backend hiện chỉ có MỘT nguồn dữ liệu một lúc (`state.ea_hub` từ chối EA thứ 2 khác server) nên danh sách thường có đúng 1 account;
registry khoá theo `server:login` để khi backend đa nguồn (docs/multi-account-plan.md Phase 1) thì không phải đổi hình dạng dữ liệu.
"""
import math
import time
from typing import Any, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends

from .auth import current_user

MODES = {"demo", "real", "contest"}


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


class Mt5Registry:
    def __init__(self, clock: Callable[[], float] = time.time) -> None:
        self.clock = clock
        self._info: Dict[str, Dict[str, Any]] = {}
        self._by_writer: Dict[Any, str] = {}

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
        for k in ("balance", "equity", "margin_free", "profit"):
            v = _num(msg.get(k))
            if v is not None:
                info[k] = v
        info["seen"] = self.clock()

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


registry = Mt5Registry()
router = APIRouter()


@router.get("/accounts")
def list_accounts(_user=Depends(current_user)):
    """Account MT5 đang/đã kết nối. Cần đăng nhập Wickloom (có số dư). `switchable` = backend có cho chuyển giữa các account không
    (chưa: chỉ 1 nguồn; đổi account = đăng nhập account khác trong MT5)."""
    return {"accounts": registry.snapshot(), "switchable": False}
