"""Gửi lệnh từ web xuống EA (docs/trade-plan.md T2): Buy/Sell market + đóng (một phần) vị thế. CHỈ account demo.

Mọi endpoint cần phiên đăng nhập Wickloom (OriginGuard chặn thêm Origin lạ trên POST/DELETE) và nhận `account_id` tường minh.
Backend đẩy lệnh xuống đúng EA của account rồi ĐỢI `trade_result` theo `req_id`. Không tự gửi lại: quá hạn (EA không trả lời)
thì báo "chưa biết kết quả" để người dùng xem vị thế trước, vì gửi lại có thể thành hai lệnh. `client_id` (mỗi lần bấm một mã)
chống gửi lặp cùng một cú bấm. Mọi yêu cầu + kết quả ghi vào bảng `orders_log` (meta.sqlite) để truy vết."""
import asyncio
import json
import math
import time
import uuid
from collections import deque
from typing import Any, Deque, Dict, Literal, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from . import state
from .auth import current_user
from .mt5 import registry
from .store import MetaStore

ORDER_TIMEOUT = 10.0  # giây chờ EA trả kết quả
MAX_PER_MINUTE = 20  # lệnh gửi xuống một account trong 60s - chặn vòng lặp lỗi ở client
DEDUPE_TTL = 600.0  # nhớ client_id bao lâu
CLIENT_ID_RE = r"^[A-Za-z0-9_-]{8,32}$"

# Mã lý do EA báo (TVBridge.mq5 TradeGuard / HandleOrderSend / ExecuteRequest) -> tiếng Việt
REASONS = {
    "ea_trading_off": "EA đang tắt giao dịch: đặt TradingEnabled = true trong cài đặt EA",
    "real_blocked": "Account không phải demo: EA chỉ giao dịch khi bật AllowRealAccount",
    "terminal_trade_off": "AutoTrading đang tắt trên terminal MT5 (bật nút Algo Trading)",
    "ea_trade_off": "EA không được phép giao dịch: tick \"Allow Algo Trading\" trong cài đặt EA",
    "account_trade_off": "Account không cho giao dịch (đăng nhập bằng investor password?)",
    "expert_not_allowed": "Broker không cho EA giao dịch trên account này",
    "bad_request": "Yêu cầu không hợp lệ",
    "bad_volume": "Khối lượng không hợp lệ (min/max/step của symbol)",
    "lot_over_limit": "Khối lượng vượt MaxLotPerOrder của EA",
    "no_position": "Không còn vị thế này (đã đóng?)",
    "no_quote": "Chưa có giá của symbol này",
}

# retcode của MT5 hay gặp (plan mục 6)
RETCODES = {
    10004: "Giá đã đổi (requote), thử lại",
    10006: "Broker từ chối lệnh",
    10013: "Yêu cầu không hợp lệ",
    10014: "Lot không hợp lệ",
    10015: "Giá không hợp lệ",
    10016: "SL/TP không hợp lệ (quá gần giá)",
    10017: "Giao dịch bị tắt",
    10018: "Thị trường đóng cửa",
    10019: "Không đủ margin",
    10020: "Giá đã đổi",
    10021: "Không có giá",
    10024: "Quá nhiều yêu cầu, chậm lại",
    10026: "AutoTrading bị tắt ở phía server",
    10027: "AutoTrading đang tắt trên terminal MT5",
    10030: "Kiểu khớp lệnh (filling) không được hỗ trợ",
    10031: "Không có kết nối tới server giao dịch",
    10033: "Đã đạt giới hạn số lệnh chờ",
    10034: "Đã đạt giới hạn khối lượng của symbol",
    10036: "Vị thế đã đóng",
    10044: "Symbol chỉ cho phép đóng vị thế",
}

DONE_CODES = (10008, 10009, 10010)  # placed / done / done partial


def result_message(ok: bool, retcode: int, reason: str, comment: str) -> str:
    if ok:
        return ""
    if reason in REASONS:
        return REASONS[reason]
    base = RETCODES.get(retcode) or f"Broker từ chối (mã {retcode})"
    return f"{base}: {comment}" if comment and retcode not in RETCODES else base


def _clean_result(msg: Dict[str, Any]) -> Dict[str, Any]:
    """Trả lời của EA -> dict chuẩn: ép kiểu, cắt chuỗi, ok chỉ đúng khi retcode là mã khớp lệnh."""
    def num(k: str) -> float:
        v = msg.get(k)
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else 0.0

    retcode = int(num("retcode"))
    reason = msg.get("reason") if isinstance(msg.get("reason"), str) else ""
    comment = msg.get("comment") if isinstance(msg.get("comment"), str) else ""
    ok = msg.get("ok") is True and retcode in DONE_CODES and not reason
    return {
        "ok": ok, "retcode": retcode, "reason": reason[:32], "message": result_message(ok, retcode, reason[:32], comment[:120]),
        "comment": comment[:120], "order": int(num("order")), "deal": int(num("deal")), "price": num("price"), "volume": num("volume"),
    }


class OrdersLog:
    """Bảng `orders_log`: mỗi lệnh gửi xuống EA một dòng (yêu cầu), cập nhật khi có kết quả (kể cả kết quả đến muộn sau khi quá hạn)."""

    def __init__(self, meta: MetaStore, clock=time.time) -> None:
        self.meta = meta
        self.clock = clock
        with meta.tx() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS orders_log (req_id TEXT PRIMARY KEY, ts REAL NOT NULL, account_id TEXT NOT NULL, user_id TEXT NOT NULL, "
                "action TEXT NOT NULL, client_id TEXT, request TEXT NOT NULL, status TEXT NOT NULL, result TEXT)"
            )

    def add(self, req_id: str, account_id: str, user_id: str, action: str, client_id: Optional[str], request: Dict[str, Any]) -> None:
        with self.meta.tx() as db:
            db.execute(
                "INSERT INTO orders_log (req_id, ts, account_id, user_id, action, client_id, request, status) VALUES (?,?,?,?,?,?,?,'sent')",
                (req_id, self.clock(), account_id, user_id, action, client_id, json.dumps(request, separators=(",", ":"))),
            )

    def finish(self, req_id: str, status: str, result: Optional[Dict[str, Any]]) -> None:
        with self.meta.tx() as db:
            db.execute("UPDATE orders_log SET status=?, result=? WHERE req_id=?", (status, json.dumps(result) if result else None, req_id))

    def rows(self, account_id: Optional[str] = None) -> list:
        with self.meta.tx() as db:
            q, args = "SELECT req_id, ts, account_id, user_id, action, client_id, request, status, result FROM orders_log", ()
            if account_id:
                q, args = q + " WHERE account_id=?", (account_id,)
            return [dict(zip(("req_id", "ts", "account_id", "user_id", "action", "client_id", "request", "status", "result"), r))
                    for r in db.execute(q + " ORDER BY ts, rowid", args)]


class TradeBroker:
    """Ghép lệnh gửi xuống EA với `trade_result` trả về theo `req_id`; chống gửi lặp, chồng lệnh và dồn dập."""

    def __init__(self, orders_log: OrdersLog, timeout: float = ORDER_TIMEOUT, clock=time.time) -> None:
        self.log = orders_log
        self.timeout = timeout
        self.clock = clock
        self._wait: Dict[str, "asyncio.Future[Dict[str, Any]]"] = {}  # req_id -> chờ kết quả của EA
        self._meta: Dict[str, Tuple[str, Optional[str], float]] = {}  # req_id -> (account_id, client_id, lúc gửi), giữ cả sau khi quá hạn để ghép kết quả muộn
        self._busy: Dict[str, str] = {}  # account_id -> req_id đang chờ EA (một lệnh một lúc)
        self._seen: Dict[Tuple[str, str], Dict[str, Any]] = {}  # (account_id, client_id) -> {at, status, result}
        self._sent: Dict[str, Deque[float]] = {}

    def _purge(self, now: float) -> None:
        for k in [k for k, v in self._seen.items() if now - v["at"] > DEDUPE_TTL]:
            del self._seen[k]
        for r in [r for r, m in self._meta.items() if now - m[2] > DEDUPE_TTL and r not in self._wait]:
            del self._meta[r]  # quá hạn từ lâu mà EA không bao giờ trả lời

    async def run(self, aid: str, writer: Any, user_id: str, cmd: Dict[str, Any], client_id: Optional[str]) -> Dict[str, Any]:
        now = self.clock()
        self._purge(now)
        if client_id is not None:
            prev = self._seen.get((aid, client_id))
            if prev is not None:
                if prev["status"] == "done":
                    return {**prev["result"], "duplicate": True}  # cùng một cú bấm gửi lại: trả kết quả cũ, không gửi lệnh mới
                raise HTTPException(409, "Lệnh này đã gửi nhưng chưa biết kết quả: xem tab Positions trước khi gửi lại")
        if aid in self._busy:
            raise HTTPException(409, "Đang xử lý lệnh trước, đợi vài giây")
        sent = self._sent.setdefault(aid, deque())
        while sent and now - sent[0] > 60:
            sent.popleft()
        if len(sent) >= MAX_PER_MINUTE:
            raise HTTPException(429, f"Quá {MAX_PER_MINUTE} lệnh trong 1 phút")
        sent.append(now)

        req_id = uuid.uuid4().hex
        fut: "asyncio.Future[Dict[str, Any]]" = asyncio.get_running_loop().create_future()
        self._wait[req_id] = fut
        self._meta[req_id] = (aid, client_id, now)
        self._busy[aid] = req_id
        if client_id is not None:
            self._seen[(aid, client_id)] = {"at": now, "status": "sent", "result": None}
        self.log.add(req_id, aid, user_id, cmd["type"], client_id, cmd)
        try:
            writer.write((json.dumps({**cmd, "req_id": req_id}, separators=(",", ":")) + "\n").encode("utf-8"))
            await writer.drain()
        except Exception:
            self._forget(req_id, aid, drop_seen=True)
            self.log.finish(req_id, "send_failed", None)
            raise HTTPException(503, "Không gửi được xuống EA (mất kết nối)")
        try:
            raw = await asyncio.wait_for(fut, self.timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError) as exc:
            # Không biết lệnh có tới sàn hay chưa: KHÔNG gửi lại. Kết quả đến muộn vẫn được ghi (resolve). Request bị huỷ giữa chừng
            # (client ngắt) cũng phải nhả khoá `busy`, nếu không account bị chặn mãi.
            self._wait.pop(req_id, None)
            if self._busy.get(aid) == req_id:
                del self._busy[aid]
            self.log.finish(req_id, "unknown", None)
            if isinstance(exc, asyncio.CancelledError):
                raise
            raise HTTPException(504, f"EA không trả lời trong {self.timeout:.0f}s: lệnh có thể đã tới sàn, xem tab Positions trước khi gửi lại")
        res = _clean_result(raw)
        self._finish(req_id, res)
        return {**res, "req_id": req_id}

    def _forget(self, req_id: str, aid: str, drop_seen: bool = False) -> None:
        self._wait.pop(req_id, None)
        _, cid, _at = self._meta.pop(req_id, (aid, None, 0.0))
        if self._busy.get(aid) == req_id:
            del self._busy[aid]
        if drop_seen and cid is not None:
            self._seen.pop((aid, cid), None)

    def _finish(self, req_id: str, res: Dict[str, Any]) -> None:
        aid, cid, _at = self._meta.get(req_id, ("", None, 0.0))
        self.log.finish(req_id, "ok" if res["ok"] else "rejected", res)
        if cid is not None:
            self._seen[(aid, cid)] = {"at": self.clock(), "status": "done", "result": {**res, "req_id": req_id}}
        if self._busy.get(aid) == req_id:
            del self._busy[aid]
        self._meta.pop(req_id, None)

    def resolve(self, msg: Dict[str, Any], from_account: Optional[str]) -> None:
        """EA gửi `trade_result` (từ tcp_server; `from_account` = account của kết nối gửi). Còn ai đang chờ thì đánh thức; đã quá hạn thì chỉ
        ghi log + nhớ kết quả. Kết quả của EA khác account với lệnh bị bỏ."""
        req_id = msg.get("req_id")
        if not isinstance(req_id, str) or req_id not in self._meta or self._meta[req_id][0] != from_account:
            return
        fut = self._wait.pop(req_id, None)
        if fut is not None and not fut.done():
            fut.set_result(msg)
        else:  # đến muộn sau khi 504
            self._finish(req_id, _clean_result(msg))


broker = TradeBroker(OrdersLog(state.meta))
router = APIRouter()


class OrderBody(BaseModel):
    symbol: str = Field(min_length=1, max_length=32)
    side: Literal["buy", "sell"]
    volume: float = Field(gt=0, le=1000, allow_inf_nan=False)
    sl: float = Field(0, ge=0, allow_inf_nan=False)  # 0 = không đặt
    tp: float = Field(0, ge=0, allow_inf_nan=False)
    client_id: str = Field(pattern=CLIENT_ID_RE)  # web sinh một mã mỗi lần bấm


def _ready(aid: str) -> Tuple[Dict[str, Any], Any]:
    """Account có giao dịch được từ web không. T2: chỉ demo, EA online, EA bật TradingEnabled, terminal/account cho phép."""
    info = registry.info(aid)
    if info is None:
        raise HTTPException(404, "Không có account MT5 này")
    writer = registry.writer(aid)
    if writer is None:
        raise HTTPException(409, "Account đang offline (EA chưa kết nối)")
    if info.get("mode") != "demo":
        raise HTTPException(403, "Hiện chỉ giao dịch từ web được trên account demo")
    if info.get("ea_trading") is not True:
        raise HTTPException(409, REASONS["ea_trading_off"] + " (cần EA >= 2.12)")
    if info.get("terminal_trade_allowed") is False:
        raise HTTPException(409, REASONS["terminal_trade_off"])
    if info.get("trade_allowed") is False:
        raise HTTPException(409, REASONS["account_trade_off"])
    return info, writer


def _check_volume(volume: float, spec: Optional[Dict[str, Any]], max_lot: Optional[float]) -> None:
    vmin, vmax, step = (spec or {}).get("volume_min"), (spec or {}).get("volume_max"), (spec or {}).get("volume_step")
    if vmin and volume < vmin - 1e-9:
        raise HTTPException(422, f"Khối lượng tối thiểu là {vmin:g}")
    if vmax and volume > vmax + 1e-9:
        raise HTTPException(422, f"Khối lượng tối đa là {vmax:g}")
    if step and abs(volume / step - round(volume / step)) > 1e-6:
        raise HTTPException(422, f"Khối lượng phải là bội của {step:g}")
    if max_lot and volume > max_lot + 1e-9:
        raise HTTPException(422, f"Khối lượng vượt MaxLotPerOrder của EA ({max_lot:g})")


@router.post("/accounts/{account_id}/orders")
async def place_order(account_id: str, body: OrderBody, user=Depends(current_user)):
    """Lệnh market Buy/Sell (kèm SL/TP tuỳ chọn). Trả `{ok, retcode, message, order, deal, price, volume, req_id}`; sàn từ chối thì ok=false
    kèm `message` tiếng Việt (HTTP vẫn 200). 4xx/5xx = lệnh chưa/không chắc tới sàn."""
    info, writer = _ready(account_id)
    spec = state.symbols.get(body.symbol)
    if spec is None:
        raise HTTPException(404, "Symbol không có trong danh sách của account")
    _check_volume(body.volume, spec, info.get("max_lot"))
    cmd = {"type": "order_send", "symbol": body.symbol, "side": body.side, "volume": body.volume, "sl": body.sl, "tp": body.tp, "client_id": body.client_id}
    return await broker.run(account_id, writer, user["id"], cmd, body.client_id)


@router.delete("/accounts/{account_id}/positions/{ticket}")
async def close_position(account_id: str, ticket: int, volume: float = Query(0, ge=0, allow_inf_nan=False), user=Depends(current_user)):
    """Đóng vị thế `ticket`; `volume` = 0 (mặc định) đóng hết, khác 0 đóng một phần. Đóng hai lần cùng ticket thì lần sau EA báo "không còn vị thế"."""
    if ticket < 1:
        raise HTTPException(422, "Ticket không hợp lệ")
    info, writer = _ready(account_id)
    cmd = {"type": "position_close", "ticket": ticket, "volume": volume}
    return await broker.run(account_id, writer, user["id"], cmd, None)
