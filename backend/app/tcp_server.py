import asyncio
import json
from typing import Any, Dict

from . import state
from .config import EA_TCP_HOST, EA_TCP_PORT, EA_TOKEN, is_stale
from .models import BarsIn, SymbolsIn, TicksIn

# Batch backfill/ticks có thể vượt mặc định 64KB của StreamReader.readline().
STREAM_LIMIT = 4 * 1024 * 1024


def _handle_symbols(body: SymbolsIn) -> None:
    state.broker_offset["value"] = body.broker_utc_offset
    items = []
    for s in body.symbols:
        d = s.model_dump()
        state.symbols[s.name] = d
        items.append((s.name, s.type, d))
    state.meta.put_many("symbols", items)


def _handle_ticks(body: TicksIn) -> None:
    offset = body.broker_utc_offset
    state.broker_offset["value"] = offset
    for t in body.ticks:
        price = t.bid or t.last
        if price <= 0:
            continue
        t_utc_msc = t.t_msc - offset * 1000
        state.aggregator.tick(body.symbol, t_utc_msc, price, t.vol, offset)
    if body.ticks:
        last = body.ticks[-1]
        t_utc_msc = last.t_msc - offset * 1000
        state.hub.publish(body.symbol, "", {
            "type": "tick", "symbol": body.symbol, "t_msc": t_utc_msc,
            "bid": last.bid, "ask": last.ask, "last": last.last,
        })


def _handle_bars(body: BarsIn) -> None:
    state.broker_offset["value"] = body.broker_utc_offset
    state.bars.upsert(body.symbol, body.tf, [b.model_dump() for b in body.bars])
    if body.done or len(body.bars) > 0:
        state.hub.publish(body.symbol, body.tf, {"type": "bars_loaded", "symbol": body.symbol, "tf": body.tf})


async def _write(writer: asyncio.StreamWriter, msg: Dict[str, Any]) -> None:
    writer.write((json.dumps(msg, separators=(",", ":")) + "\n").encode("utf-8"))
    await writer.drain()


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
            await _write(writer, {"type": "error", "message": "bad token"})
            return

        if state.check_broker_switch(hello.get("broker", "")):
            archive = state.resync_after_broker_switch()
            print(f"TVBridge {peer}: doi broker -> archive bar cache vao {archive}")

        state.ea_hub.add(writer)
        registered = True
        print(f"TVBridge connected: {peer}")

        if not state.symbols:
            await _write(writer, {"type": "need_symbols"})
        await _write(writer, {"type": "subscribe", "symbols": sorted(state.hub.subscribed_symbols())})

        pending = list(state.pending_backfill)
        state.pending_backfill.clear()
        for cmd in pending:
            await _write(writer, cmd)

        for sym, tf in state.hub.subscribed_pairs():
            last = state.bars.last(sym, tf)
            if is_stale(last["t"] if last else None, tf):
                state.request_backfill(sym, tf)

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
            except Exception as exc:
                print(f"TVBridge {peer}: loi xu ly '{mtype}': {exc}")
    except (asyncio.IncompleteReadError, ConnectionResetError):
        pass
    finally:
        if registered:
            state.ea_hub.remove(writer)
        writer.close()
        print(f"TVBridge disconnected: {peer}")


async def start_server(host: str = EA_TCP_HOST, port: int = EA_TCP_PORT):
    return await asyncio.start_server(handle_ea, host, port, limit=STREAM_LIMIT)
