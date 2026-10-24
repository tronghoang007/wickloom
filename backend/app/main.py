import asyncio
from typing import Any, Dict, Optional

from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, WebSocket, WebSocketDisconnect
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from . import accounts, auth, economic, me, mt5, state, tcp_server, trade
from .config import ALLOWED_ORIGINS, TF_SECONDS
from .state import request_backfill
from .tickdelta import TICK_DELTA_TF
from .store import TABLES

app = FastAPI(title="TV personal backend")
# Thứ tự: add sau = bọc ngoài. CORS ngoài cùng để cả 403 của OriginGuard vẫn có header CORS cho web đọc lỗi.
app.add_middleware(auth.OriginGuard, allowed=ALLOWED_ORIGINS)
app.add_middleware(
    CORSMiddleware, allow_origins=ALLOWED_ORIGINS, allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)


@app.exception_handler(RequestValidationError)
async def _validation_error(_request: Request, exc: RequestValidationError):
    """422 gọn, không đính kèm `input`: body có NaN/Infinity (json.loads của Python nhận) làm handler mặc định ném ValueError khi encode lại -> 500."""
    return JSONResponse({"detail": [{"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()]}, status_code=422)


app.include_router(auth.router)
app.include_router(me.router)
app.include_router(mt5.router)
app.include_router(trade.router)
app.include_router(economic.router)


def _push_subscribe() -> None:
    state.ea_hub.push({"type": "subscribe", "symbols": sorted(state.hub.subscribed_symbols())})


@app.on_event("startup")
async def _startup():
    # Capture the running event loop so Hub.publish()/EaHub.push() có thể schedule
    # coroutine an toàn từ AnyIO worker thread (route sync).
    loop = asyncio.get_running_loop()
    state.hub.set_loop(loop)
    state.ea_hub.set_loop(loop)
    app.state.ea_tcp_server = await tcp_server.start_server()


@app.on_event("shutdown")
async def _shutdown():
    server = getattr(app.state, "ea_tcp_server", None)
    if server is not None:
        server.close()
        await server.wait_closed()


@app.get("/health")
def health():
    return {"ok": True, "symbols": len(state.symbols), "offset": state.broker_offset["value"]}


@app.get("/symbols")
def list_symbols():
    return sorted(state.symbols.values(), key=lambda s: s["name"])


@app.get("/bars")
def get_bars(symbol: str, tf: str, frm: Optional[int] = Query(None, alias="from"),
             to: Optional[int] = None, limit: int = Query(500, le=50000)):
    if tf not in TF_SECONDS and tf != TICK_DELTA_TF:  # "TD" = nến delta theo tick từng phút (tickdelta.py)
        raise HTTPException(400, "unknown tf")
    return state.bars.query(symbol, tf, frm, to, limit)


@app.get("/tickvp")
def get_tickvp(symbol: str, frm: int = Query(alias="from"), to: int = 0, lo: float = 0, size: float = Query(gt=0), n: int = Query(ge=1, le=5000)):
    """Volume Profile "1 tick": volume lên / xuống của tick trong các phút [from, to) gom vào n row bắt đầu từ giá `lo`, mỗi row cao `size` (xem tickdelta.py)."""
    up, dn = state.bars.tickvp(symbol, frm, to, lo, size, n)
    return {"up": up, "dn": dn}


@app.get("/tickbig")
def get_tickbig(symbol: str, frm: int = Query(alias="from"), to: int = 0, min: float = Query(1, ge=0), limit: int = Query(500, ge=1, le=5000), size: float = Query(0, ge=0)):
    """Big Trades "1 tick": các ô (phút, giá) trong [from, to) có volume tick >= min, tối đa `limit` ô lớn nhất; `size` > 0 gom giá vào row cao `size`.
    rows = [t, giá, volume lên, volume xuống] tăng dần theo t."""
    return {"rows": [list(r) for r in state.bars.tickbig(symbol, frm, to, min, limit, size)]}


@app.get("/tickfp")
def get_tickfp(symbol: str, bars: str, end: int, size: float = Query(gt=0)):
    """Footprint "1 tick": tick của các phút [bars[0], end) gom theo (nến, row giá cao `size`, row i phủ [i*size, (i+1)*size)). `bars` = giờ mở các nến, cách nhau dấu phẩy, tăng dần (tối đa 1000).
    rows = [chỉ số nến trong `bars`, row, volume lên, volume xuống]."""
    try:
        starts = [int(x) for x in bars.split(",") if x]
    except ValueError:
        raise HTTPException(422, "bars must be comma separated integers")
    if not starts or len(starts) > 1000 or any(b <= a for a, b in zip(starts, starts[1:])):
        raise HTTPException(422, "bars must be 1..1000 ascending times")
    return {"rows": [list(r) for r in state.bars.tickfp(symbol, starts, end, size)]}


@app.post("/backfill")
def backfill(symbol: str, tf: str, count: int = 500, pos: int = 0, before: int = 0):
    request_backfill(symbol, tf, count, pos, before)
    return {"ok": True}


def _crud(table: str) -> APIRouter:
    r = APIRouter(prefix=f"/{table}")

    @r.get("")
    def list_(scope: Optional[str] = None):
        return state.meta.list(table, scope)

    @r.get("/{id}")
    def get_(id: str):
        row = state.meta.get(table, id)
        if not row:
            raise HTTPException(404)
        return row

    @r.put("/{id}")
    def put_(id: str, body: Dict[str, Any], scope: str = ""):
        state.meta.put(table, id, scope, body)
        return {"ok": True}

    @r.delete("/{id}")
    def delete_(id: str):
        state.meta.delete(table, id)
        return {"ok": True}

    return r


# Dữ liệu người dùng đi qua /me/* (cần đăng nhập); CRUD generic cho các bảng đó đã đóng, không thì vòng qua được xác thực.
for _t in TABLES:
    if _t not in accounts.USER_TABLES:
        app.include_router(_crud(_t))


@app.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    await ws.accept()
    state.hub.clients[ws] = set()
    try:
        while True:
            msg = await ws.receive_json()
            pair = (msg.get("symbol"), msg.get("tf"))
            if msg.get("action") == "subscribe" and pair[1] in TF_SECONDS:
                state.hub.clients[ws].add(pair)
                state.aggregator.watch(*pair)
                state.request_catchup(*pair)
                _push_subscribe()
            elif msg.get("action") == "unsubscribe":
                state.hub.clients[ws].discard(pair)
                _push_subscribe()
    except WebSocketDisconnect:
        pass
    finally:
        state.hub.clients.pop(ws, None)
        _push_subscribe()  # symbol không còn ai xem thì EA thôi stream tick
