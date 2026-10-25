import asyncio
import json
import os
import tempfile
import time

os.environ["TV_DATA_DIR"] = tempfile.mkdtemp()

from fastapi.testclient import TestClient  # noqa: E402

from app import state, tcp_server  # noqa: E402
from app.aggregator import bar_open  # noqa: E402
from app.config import EA_TOKEN, is_stale  # noqa: E402
from app.main import app  # noqa: E402


def test_bar_open():
    assert bar_open(125, "M1", 0) == 120
    assert bar_open(3661, "H1", 0) == 3600
    assert bar_open(3661, "H1", 7200) == 3600  # offset chẵn giờ


def test_week_starts_sunday():
    # 1970-01-01 là thứ Năm; Chủ nhật trước đó = -4 ngày
    assert bar_open(0, "W1", 0) == -4 * 86400


async def _run_ea(lines, token=EA_TOKEN, hello=None):
    """Giả làm TVBridge: mở TCP tới 1 server test riêng, gửi hello + các dòng NDJSON,
    rồi đợi server xử lý hết và tự đóng connection (EOF) trước khi thoát."""
    server = await tcp_server.start_server(host="127.0.0.1", port=0)
    port = server.sockets[0].getsockname()[1]
    reader, writer = await asyncio.open_connection("127.0.0.1", port)
    writer.write((json.dumps({"type": "hello", "token": token, **(hello or {})}) + "\n").encode("utf-8"))
    for line in lines:
        writer.write((json.dumps(line) + "\n").encode("utf-8"))
    writer.write_eof()
    await writer.drain()
    await reader.read()  # chờ tới khi server xử lý xong và đóng kết nối (EOF)
    writer.close()
    server.close()
    await server.wait_closed()


def send_ea(lines, token=EA_TOKEN, hello=None):
    asyncio.run(_run_ea(lines, token, hello))


def test_bad_token_rejected():
    send_ea(
        [{"type": "bars", "symbol": "REJECT", "tf": "M1",
          "bars": [{"t": 60, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]}],
        token="wrong-token",
    )
    c = TestClient(app)
    assert c.get("/bars", params={"symbol": "REJECT", "tf": "M1"}).json() == []


def test_ingest_and_query():
    send_ea([
        {"type": "bars", "symbol": "EURUSD", "tf": "M1", "bars": [
            {"t": 60, "o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 3},
            {"t": 120, "o": 1.5, "h": 2, "l": 1, "c": 1.8, "v": 4}]},
        {"type": "bars", "symbol": "EURUSD", "tf": "M1", "bars": [
            {"t": 120, "o": 1.5, "h": 3, "l": 1, "c": 2.0, "v": 5}]},
    ])
    c = TestClient(app)
    rows = c.get("/bars", params={"symbol": "EURUSD", "tf": "M1"}).json()
    assert [r["t"] for r in rows] == [60, 120] and rows[1]["h"] == 3
    rows = c.get("/bars", params={"symbol": "EURUSD", "tf": "M1", "to": 120}).json()
    assert [r["t"] for r in rows] == [60]


def test_ticks_aggregate_and_meta():
    m = (int(time.time()) // 60 - 2) * 60  # tick phải "mới" (< MAX_TICK_AGE_MS) mới được gom
    send_ea([{"type": "ticks", "symbol": "XAUUSD", "ticks": [
        {"t_msc": m * 1000, "bid": 10}, {"t_msc": (m + 10) * 1000, "bid": 12},
        {"t_msc": (m + 70) * 1000, "bid": 11}]}])
    c = TestClient(app)
    rows = c.get("/bars", params={"symbol": "XAUUSD", "tf": "M1"}).json()
    assert rows == [{"t": m, "o": 10, "h": 12, "l": 10, "c": 12, "v": 2}]
    c.put("/settings/a", params={"scope": "x"}, json={"k": 1})
    assert c.get("/settings/a").json()["data"] == {"k": 1}


def test_stale_ticks_dropped():
    # EA gửi lại lịch sử tick (vd CopyTicks từ msc=0) -> không được gom thành nến
    send_ea([{"type": "ticks", "symbol": "OLDTICK", "ticks": [
        {"t_msc": 60_000, "bid": 10}, {"t_msc": 130_000, "bid": 11}]}])
    assert state.bars.last("OLDTICK", "M1") is None


def test_bar_store_upsert_query():
    state.bars.upsert("Q", "H1", [{"t": t, "o": 1, "h": 2, "l": 0, "c": 1, "v": 5} for t in (3600, 7200, 10800)])
    state.bars.upsert("Q", "H1", [{"t": 7200, "o": 9, "h": 9, "l": 9, "c": 9, "v": 9}])  # ghi đè
    assert [b["t"] for b in state.bars.query("Q", "H1")] == [3600, 7200, 10800]
    assert state.bars.query("Q", "H1", to=10800, limit=1)[0]["o"] == 9
    assert [b["t"] for b in state.bars.query("Q", "H1", frm=7200)] == [7200, 10800]
    assert state.bars.last("Q", "H1")["t"] == 10800
    assert state.bars.query("Q", "M1") == []


def test_is_stale():
    assert is_stale(None, "M1") is True
    assert is_stale(int(time.time()), "M1") is False
    assert is_stale(int(time.time()) - 10_000, "M1") is True


def test_request_backfill_queues_when_no_ea_connected():
    state.pending_backfill.clear()
    state.request_backfill("FOO", "M1", count=10, pos=5)
    assert any(c["symbol"] == "FOO" and c.get("pos") == 5 for c in state.pending_backfill)
    state.pending_backfill.clear()
    state.request_backfill("FOO", "M1", count=10, before=12345)
    assert any(c["symbol"] == "FOO" and c.get("before") == 12345 for c in state.pending_backfill)


def _set_broker(data):
    state.meta.delete("settings", "broker")
    if data is not None:
        state.meta.put("settings", "broker", "", data)


def test_broker_switch_by_server():
    _set_broker(None)
    assert state.check_broker_switch("", "") is False
    assert state.check_broker_switch("Exness", "Exness-Trial17") is False  # lần đầu: chỉ ghi nhớ
    assert state.check_broker_switch("Exness", "Exness-Trial17") is False  # khác login, cùng server
    assert state.check_broker_switch("Exness", "Exness-Real8") is True  # cùng công ty, khác server
    assert state.check_broker_switch("XM", "XMGlobal-MT5 7") is True  # khác broker


def test_broker_switch_legacy_records():
    _set_broker({"name": "Exness"})  # bản lưu từ EA < v2.09 (chỉ tên công ty)
    assert state.check_broker_switch("Exness", "Exness-Trial17") is False  # nâng cấp EA: không xoá cache
    assert state.meta.get("settings", "broker")["data"]["server"] == "Exness-Trial17"
    assert state.check_broker_switch("Exness", "") is False  # EA cũ chạy lại, cùng công ty
    assert state.check_broker_switch("XM", "") is True


def test_broker_switch_archives_bars_and_clears_symbols():
    state.bars.upsert("ANY", "M1", [{"t": 60, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    state.symbols["ANY"] = {"name": "ANY"}
    state.pending_backfill.append({"type": "backfill", "symbol": "ANY", "tf": "M1", "count": 1, "before": 60})

    archive = state.resync_after_broker_switch()
    assert archive is not None and archive.exists()
    assert state.symbols == {}
    assert state.bars.last("ANY", "M1") is None
    assert state.pending_backfill == []


def test_second_ea_from_other_server_rejected():
    fake = object()
    state.ea_hub.add(fake, "SRV-A")
    try:
        send_ea([{"type": "bars", "symbol": "OTHERSRV", "tf": "M1",
                  "bars": [{"t": 60, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]}],
                hello={"broker": "B", "server": "SRV-B"})
        assert state.bars.last("OTHERSRV", "M1") is None
        send_ea([{"type": "bars", "symbol": "SAMESRV", "tf": "M1",
                  "bars": [{"t": 60, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]}],
                hello={"broker": "A", "server": "SRV-A"})
        assert state.bars.last("SAMESRV", "M1") is not None
    finally:
        state.ea_hub.remove(fake)


def test_symbols_replaced_not_merged():
    sym = lambda n: {"name": n, "digits": 2, "tick_size": 0.01, "type": "metal"}
    send_ea([{"type": "symbols", "symbols": [sym("XAUUSDm"), sym("EURUSDm")]}])
    send_ea([{"type": "symbols", "symbols": [sym("XAUUSD")]}])  # đổi sang account Pro
    names = [s["name"] for s in TestClient(app).get("/symbols").json()]
    assert names == ["XAUUSD"]
    assert [r["id"] for r in state.meta.list("symbols")] == ["XAUUSD"]


def test_midbar_start_requests_seed_and_merges_mt5_bar():
    from app.aggregator import Aggregator

    seeds, updates = [], []
    agg = Aggregator(lambda s, tf: None, lambda s, tf, b: updates.append(b), lambda *_: None,
                     lambda s, tf: seeds.append((s, tf)))
    agg.watch("SEED", "M15")
    agg.tick("SEED", (900 * 10 + 400) * 1000, 105.0, 1, 0)  # tick đầu tiên thấy được, giữa nến
    assert ("SEED", "M15") in seeds and ("SEED", "M1") in seeds
    agg.tick("SEED", (900 * 10 + 500) * 1000, 107.0, 1, 0)
    merged = agg.merge("SEED", "M15", [{"t": 9000, "o": 100.0, "h": 110.0, "l": 99.0, "c": 104.0, "v": 800.0}])
    assert merged == {"t": 9000, "o": 100.0, "h": 110.0, "l": 99.0, "c": 107.0, "v": 800.0}
    assert agg.merge("SEED", "M15", [{"t": 8100, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]) is None


def test_tick_at_bar_start_does_not_request_seed():
    from app.aggregator import Aggregator

    seeds = []
    agg = Aggregator(lambda s, tf: None, lambda *_: None, lambda *_: None, lambda s, tf: seeds.append(tf))
    agg.watch("FRESH", "M15")
    agg.tick("FRESH", 9000 * 1000, 100.0, 1, 0)  # đúng giây đầu của nến
    assert seeds == []


def test_tick_gap_reports_gap_but_first_tick_and_short_pauses_do_not():
    from app.aggregator import GAP_SECONDS, Aggregator

    gaps = []
    agg = Aggregator(lambda s, tf: None, lambda *_: None, lambda *_: None, None, lambda s, g: gaps.append((s, g)))
    agg.tick("GAP", 1000 * 1000, 100.0, 1, 0)  # tick đầu: không có gì để so
    agg.tick("GAP", (1000 + GAP_SECONDS) * 1000, 100.5, 1, 0)  # im đúng ngưỡng: chưa tính là đứt
    assert gaps == []
    agg.tick("GAP", (1000 + GAP_SECONDS + 600) * 1000, 101.0, 1, 0)  # im 10 phút
    assert gaps == [("GAP", 600)]
    agg.tick("GAP", (1000 + GAP_SECONDS + 500) * 1000, 100.0, 1, 0)  # tick cũ đến muộn: không đẩy mốc lùi, không báo đứt
    assert gaps == [("GAP", 600)]


def test_tick_gap_requests_backfill_sized_to_the_gap_and_not_repeatedly():
    state.pending_backfill.clear()
    state._gap_seeding.clear()
    state.aggregator.tfs["GAPSYM"] = {"M1", "M15"}
    state._on_gap("GAPSYM", 3600)
    cmds = {(c["tf"]): c["count"] for c in state.pending_backfill if c["symbol"] == "GAPSYM" and c["tf"] != "TD"}  # (tick TD của khoảng đứt: test riêng bên dưới)
    assert cmds == {"M1": 63, "M15": 7}  # 3600s = 60 nến M1 / 4 nến M15, cộng 3
    state._on_gap("GAPSYM", 3600)  # tick kế tiếp ngay sau đó: không xin lại
    assert len([c for c in state.pending_backfill if c["symbol"] == "GAPSYM" and c["tf"] != "TD"]) == 2
    state._gap_seeding.clear()
    state.pending_backfill.clear()  # (lệnh trùng khoá đang chờ thì không xếp thêm)
    state._on_gap("GAPSYM", 10 * 86400)  # đứt qua cuối tuần: trần 500 nến
    assert max(c["count"] for c in state.pending_backfill if c["symbol"] == "GAPSYM" and c["tf"] != "TD") == 500
    state.pending_backfill.clear()
    state.aggregator.tfs.pop("GAPSYM", None)


def test_tick_gap_also_requests_tick_history_for_the_gap_in_chunks_newest_first():
    state.pending_backfill.clear()
    state._gap_seeding.clear()
    state.aggregator.tfs["GAPTD"] = {"M1"}
    before = int(time.time())
    state._on_gap("GAPTD", 900)  # đứt 15 phút (máy ngủ): xin đúng 15 + 3 phút tick
    td = [c for c in state.pending_backfill if c["symbol"] == "GAPTD" and c["tf"] == "TD"]
    assert [c["count"] for c in td] == [18]
    assert before <= td[0]["before"] <= int(time.time())
    state._on_gap("GAPTD", 900)  # tick kế tiếp ngay sau đó: không xin lại
    assert len([c for c in state.pending_backfill if c["symbol"] == "GAPTD" and c["tf"] == "TD"]) == 1
    state._gap_seeding.clear()
    state.pending_backfill.clear()
    state._on_gap("GAPTD", 10 * 3600)  # đứt 10 giờ: 600 + 3 phút chia hai đoạn, đoạn mới nhất trước
    td = [c for c in state.pending_backfill if c["symbol"] == "GAPTD" and c["tf"] == "TD"]
    assert [c["count"] for c in td] == [state.TICK_GAP_CHUNK, 603 - state.TICK_GAP_CHUNK]
    assert td[0]["before"] - td[1]["before"] == state.TICK_GAP_CHUNK * 60  # đoạn sau lùi đúng một đoạn
    state._gap_seeding.clear()
    state.pending_backfill.clear()
    state._on_gap("GAPTD", 10 * 86400)  # đứt qua cuối tuần: trần TICK_GAP_MAX phút
    td = [c for c in state.pending_backfill if c["symbol"] == "GAPTD" and c["tf"] == "TD"]
    assert sum(c["count"] for c in td) == state.TICK_GAP_MAX
    state.pending_backfill.clear()
    state.aggregator.tfs.pop("GAPTD", None)


def test_catchup_refreshes_last_bars_even_when_cache_is_not_stale():
    state.pending_backfill.clear()
    now = int(time.time()) // 900 * 900
    state.bars.upsert("FRESHSYM", "M15", [{"t": now, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1.0}])
    state.request_catchup("FRESHSYM", "M15")
    assert [(c["tf"], c["count"]) for c in state.pending_backfill if c["symbol"] == "FRESHSYM"] == [("M15", 3)]
    state.pending_backfill.clear()
