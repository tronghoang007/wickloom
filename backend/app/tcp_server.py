import asyncio
import json
import time
from typing import Any, Dict, List, Tuple

from . import economic, mt5, state, tickdelta, trade
from .config import EA_TCP_HOST, EA_TCP_PORT, EA_TOKEN
from .models import BarsIn, SymbolsIn, TicksHistIn, TicksIn

# Tick chỉ dùng cho realtime: tick cũ hơn mức này (EA gửi lại lịch sử tick, vd
# CopyTicks từ msc=0 khi mới subscribe) bị bỏ - quá khứ do backfill bar của EA lo. Gom
# tick cũ thành nến sẽ ghi đè bar chuẩn của MT5.
MAX_TICK_AGE_MS = 5 * 60 * 1000

# Batch backfill/ticks có thể vượt mặc định 64KB của StreamReader.readline().
STREAM_LIMIT = 4 * 1024 * 1024


def _handle_symbols(body: SymbolsIn) -> None:
    """EA luôn gửi TOÀN BỘ symbol của account -> thay hẳn danh sách cũ (đổi account/loại
    account thì symbol không còn giao dịch được phải biến mất khỏi ô tìm kiếm)."""
    state.broker_offset["value"] = body.broker_utc_offset
    fresh = {s.name: s.model_dump() for s in body.symbols}
    for name in [n for n in state.symbols if n not in fresh]:
        del state.symbols[name]
    state.symbols.update(fresh)
    state.meta.clear("symbols")
    state.meta.put_many("symbols", [(n, d["type"], d) for n, d in fresh.items()])


def _handle_ticks(body: TicksIn) -> None:
    offset = body.broker_utc_offset
    state.broker_offset["value"] = offset
    floor = time.time() * 1000 - MAX_TICK_AGE_MS
    fresh = [t for t in body.ticks if t.t_msc - offset * 1000 >= floor]
    for t in fresh:
        price = t.bid or t.last
        if price <= 0:
            continue
        t_utc_msc = t.t_msc - offset * 1000
        state.aggregator.tick(body.symbol, t_utc_msc, price, t.vol, offset)
    if fresh:
        last = fresh[-1]
        t_utc_msc = last.t_msc - offset * 1000
        state.hub.publish(body.symbol, "", {
            "type": "tick", "symbol": body.symbol, "t_msc": t_utc_msc,
            "bid": last.bid, "ask": last.ask, "last": last.last,
        })


def _handle_bars(body: BarsIn) -> None:
    state.broker_offset["value"] = body.broker_utc_offset
    rows = [b.model_dump() for b in body.bars]
    state.bars.upsert(body.symbol, body.tf, rows)
    merged = state.aggregator.merge(body.symbol, body.tf, rows)
    if merged:  # nến đang chạy vừa được sửa theo MT5 -> chart đổi ngay, khỏi chờ tick sau
        state._on_update(body.symbol, body.tf, merged)
    if body.done or len(body.bars) > 0:
        state.hub.publish(body.symbol, body.tf, {"type": "bars_loaded", "symbol": body.symbol, "tf": body.tf})


def _handle_ticks_hist(body: TicksHistIn) -> None:
    state.broker_offset["value"] = body.broker_utc_offset
    hist: Dict[Tuple[int, float], List[float]] = {}
    rows = tickdelta.ingest(body, hist)
    if rows:
        state.bars.upsert(body.symbol, tickdelta.TICK_DELTA_TF, rows)
        state.bars.put_tickvp(body.symbol, rows[0]["t"], rows[-1]["t"], [(m, p, u, d) for (m, p), (u, d) in hist.items()])


async def _write(writer: asyncio.StreamWriter, msg: Dict[str, Any]) -> None:
    writer.write((json.dumps(msg, separators=(",", ":")) + "\n").encode("utf-8"))
    await writer.drain()


async def _reject(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, message: str) -> None:
    """Gửi lỗi rồi half-close và đọc bỏ phần EA đã gửi tiếp (symbols ngay sau hello):
    đóng thẳng khi còn dữ liệu chưa đọc -> RST, EA có thể mất luôn message lỗi."""
    await _write(writer, {"type": "error", "message": message})
    try:
        writer.write_eof()
        await asyncio.wait_for(reader.read(), 2)
    except (asyncio.TimeoutError, ConnectionError, asyncio.LimitOverrunError):
        pass


async def handle_ea(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("peername")
    registered = False
    try:
        first = await reader.readline()
        if not first:
            return
        try:
            hello = json.loads(first.decode("utf-8"))
        except ValueError:
            return
        if hello.get("type") != "hello" or hello.get("token") != EA_TOKEN:
            await _reject(reader, writer, "bad token")
            return

        company, server = hello.get("broker", ""), hello.get("server", "")
        ident = server or company
        active = state.ea_hub.active_ident()
        if active and ident and active != ident:
            # Chỉ 1 nguồn dữ liệu 1 lúc: 2 EA khác server cùng chạy sẽ làm backend resync
            # qua lại liên tục và trộn bar của 2 server.
            msg = f"backend dang nhan du lieu tu {active}, tu choi {ident} - tat EA kia truoc"
            print(f"TVBridge {peer}: {msg}")
            await _reject(reader, writer, msg)
            return

        if state.check_broker_switch(company, server):
            archive = state.resync_after_broker_switch()
            print(f"TVBridge {peer}: doi broker/server -> {ident}, archive bar cache vao {archive}")

        state.ea_hub.add(writer, ident)
        mt5.registry.register(writer, hello)
        registered = True
        print(f"TVBridge connected: {peer}")

        if not state.symbols:
            await _write(writer, {"type": "need_symbols"})
        await _write(writer, {"type": "subscribe", "symbols": sorted(state.hub.subscribed_symbols())})

        pending = list(state.pending_backfill)
        state.pending_backfill.clear()
        for cmd in pending:
            await _write(writer, cmd)

        queued = {(c["symbol"], c["tf"]) for c in pending}
        for sym, tf in state.hub.subscribed_pairs():
            if (sym, tf) not in queued:  # đã có lệnh xếp hàng lúc EA offline vừa gửi ở trên
                state.request_catchup(sym, tf)

        while True:
            line = await reader.readline()
            if not line:
                break
            line = line.strip()
            if not line:
                continue
            try:
                msg = json.loads(line.decode("utf-8"))
            except ValueError:
                continue
            mtype = msg.get("type")
            try:
                if mtype == "symbols":
                    _handle_symbols(SymbolsIn.model_validate(msg))
                elif mtype == "ticks":
                    _handle_ticks(TicksIn.model_validate(msg))
                elif mtype == "bars":
                    _handle_bars(BarsIn.model_validate(msg))
                elif mtype == "ticks_hist":
                    _handle_ticks_hist(TicksHistIn.model_validate(msg))
                elif mtype == "account":
                    mt5.registry.update(writer, msg)
                elif mtype == "calendar":
                    economic.ingest(msg)
                elif mtype in ("trade", "deals"):
                    mt5.registry.update_trade(writer, msg)
                elif mtype == "trade_result":
                    trade.broker.resolve(msg, mt5.registry.account_of(writer))
            except Exception as exc:
                print(f"TVBridge {peer}: loi xu ly '{mtype}': {exc}")
    except (asyncio.IncompleteReadError, ConnectionResetError):
        pass
    finally:
        if registered:
            state.ea_hub.remove(writer)
            mt5.registry.remove(writer)
        writer.close()
        print(f"TVBridge disconnected: {peer}")


async def start_server(host: str = EA_TCP_HOST, port: int = EA_TCP_PORT):
    return await asyncio.start_server(handle_ea, host, port, limit=STREAM_LIMIT)
