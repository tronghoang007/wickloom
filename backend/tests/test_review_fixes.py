"""Hồi quy cho các lỗi của đợt review backend / EA 28/10: gốc delta realtime nhận nhầm lịch sử cũ (xoá tickvp), MN1 chia cho 0,
lệch giờ broker lệch 1s, WebSocket khác Origin, CRUD generic ghi được không cần đăng nhập, lịch kinh tế bị cắt, drain song song trên Python 3.9."""
import asyncio
import os
import tempfile
import time

os.environ.setdefault("TV_DATA_DIR", tempfile.mkdtemp())

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from starlette.websockets import WebSocketDisconnect  # noqa: E402

from app import economic, state, tcp_server, tickdelta  # noqa: E402
from app.config import ALLOWED_ORIGINS, round_offset, tf_step  # noqa: E402
from app.main import app  # noqa: E402
from app.models import BarsIn, TicksHistIn, TicksIn  # noqa: E402

M = 60_000


# --- gốc delta realtime -------------------------------------------------------------------------------------------------------------------------------

def _live(asked):
    return tickdelta.Live(lambda s: asked.append(s), lambda: 1000.0)


def test_live_ignores_history_of_a_past_window_answered_after_its_ask():
    asked = []
    live = _live(asked)
    now = 100 * 86400 * 1000
    assert live.feed("RV1", [(now, 11.0, 1.0, False)]) is None and asked == ["RV1"]
    # EA trả lời trước một yêu cầu của web cho một khoảng hôm qua (nhận SAU lần xin của Live): không phải gốc tới giờ hiện tại
    tickdelta.ingest(TicksHistIn(symbol="RV1", t=[now - 86400_000], p=[10.0], pb=9.0, done=True))
    assert live.seed("RV1") is None
    # gốc thật (2 phút tới giờ hiện tại) tới sau thì nhận
    tickdelta.ingest(TicksHistIn(symbol="RV1", t=[now - 30_000], p=[10.0], pb=9.0, done=True))
    upd = live.seed("RV1")
    assert upd is not None and all(r["t"] >= (now - 30_000) // M * 60 for r, _ in upd.closed)


def test_live_accepts_window_end_from_ea_even_when_market_was_quiet():
    live = _live([])
    now = 100 * 86400 * 1000
    live.feed("RV2", [(now, 11.0, 1.0, False)])
    # tick cuối của lịch sử cách 10 phút (thị trường im) nhưng EA >= 2.20 báo cửa sổ đọc tới giờ hiện tại
    tickdelta.ingest(TicksHistIn(symbol="RV2", t=[now - 600_000], p=[10.0], pb=9.0, done=True, end=now))
    assert live.seed("RV2") is not None
    # EA cũ (không có `end`) cùng tình huống: không nhận, chờ SEED_WAIT như trước
    live2 = _live([])
    live2.feed("RV3", [(now, 11.0, 1.0, False)])
    tickdelta.ingest(TicksHistIn(symbol="RV3", t=[now - 600_000], p=[10.0], pb=9.0, done=True))
    assert live2.seed("RV3") is None


def test_live_seeds_from_empty_done_with_window_end():
    live = _live([])
    now = 100 * 86400 * 1000
    live.feed("RV4", [(now + 5, 11.0, 1.0, False)])
    tickdelta.ingest(TicksHistIn(symbol="RV4", t=[], p=[], pb=10.0, done=True, end=now))
    upd = live.seed("RV4")
    assert upd is not None and upd.row["c"] == 1.0  # 11 so với giá trước cửa sổ 10: lên


def test_realtime_delta_never_deletes_tickvp_between_old_and_new_minute(monkeypatch):
    sym = "RVWIPE"
    monkeypatch.setattr(state.tick_live, "ask", lambda s: None)
    monkeypatch.setattr(state.hub, "publish", lambda *a: None)
    state.tick_live.reset(sym)
    now = int(time.time())
    cur = now // 60 * 60
    rows = [(t, 2000.0, 1.0, 1.0) for t in range(cur - 86400, cur, 60)]
    state.bars.put_tickvp(sym, rows[0][0], rows[-1][0], rows)
    tcp_server._handle_ticks(TicksIn(symbol=sym, ticks=[{"t_msc": now * 1000, "bid": 2001.0, "f": 2}]))
    h0 = (cur - 43200) * 1000  # lịch sử nửa ngày trước, EA trả sau lần xin của Live
    tcp_server._handle_ticks_hist(TicksHistIn(symbol=sym, t=[h0 - 50_000, h0 - 20_000], p=[2000.0, 2000.5], done=True))
    n = state.bars.rdb.execute("SELECT COUNT(DISTINCT t) FROM tickvp WHERE symbol=? AND t<?", (sym, cur)).fetchone()[0]
    assert n == 1440


def test_put_tickvp_with_minutes_only_replaces_those_minutes():
    sym = "RVMIN"
    state.bars.put_tickvp(sym, 0, 180, [(t, 1.0, 1.0, 0.0) for t in (0, 60, 120, 180)])
    state.bars.put_tickvp(sym, 0, 180, [(0, 2.0, 5.0, 0.0), (180, 2.0, 5.0, 0.0)], minutes=[0, 180])
    got = state.bars.rdb.execute("SELECT t, p FROM tickvp WHERE symbol=? ORDER BY t", (sym,)).fetchall()
    assert got == [(0, 2.0), (60, 1.0), (120, 1.0), (180, 2.0)]


# --- MN1 ---------------------------------------------------------------------------------------------------------------------------------------------

def test_tick_gap_with_mn1_chart_open_does_not_crash(monkeypatch):
    sent = []
    monkeypatch.setattr(state, "request_backfill", lambda *a, **k: sent.append(a))
    monkeypatch.setattr(state.tick_gap, "start", lambda *a: None)
    sym = "RVMN1"
    state.aggregator.watch(sym, "MN1")
    state.aggregator.watch(sym, "W1")
    now = int(time.time())
    state.aggregator.tick(sym, (now - 300) * 1000, 10.0, 1, 0)
    state.aggregator.tick(sym, now * 1000, 11.0, 1, 0)
    assert {a[1] for a in sent if a[0] == sym} >= {"M1", "MN1", "W1"}
    assert tf_step("MN1") > 0 and tf_step("M5") == 300


def test_catchup_of_stale_mn1_cache(monkeypatch):
    sent = []
    monkeypatch.setattr(state, "request_backfill", lambda *a, **k: sent.append(a))
    state.bars.upsert("RVMN2", "MN1", [{"t": int(time.time()) - 90 * 86400, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    state.request_catchup("RVMN2", "MN1")
    assert sent == [("RVMN2", "MN1", 500)]


# --- lệch giờ broker ---------------------------------------------------------------------------------------------------------------------------------

def test_offset_is_rounded_to_15_minutes():
    assert [round_offset(x) for x in (10799, 10801, -1, 1, 0, -7199, 19800)] == [10800, 10800, 0, 0, 0, -7200, 19800]


def test_one_second_offset_error_does_not_misalign_bars(monkeypatch):
    monkeypatch.setattr(state.hub, "publish", lambda *a: None)
    sym = "RVOFF"
    m = (int(time.time()) // 60 - 1) * 60
    # EA tính lệch giờ = -1 (giờ server thật = UTC): nến gom từ tick vẫn mở đúng phút
    tcp_server._handle_ticks(TicksIn(symbol=sym, broker_utc_offset=-1, ticks=[{"t_msc": m * 1000 + 30_000, "bid": 5.0}]))
    assert state.aggregator.cur[(sym, "M1")]["t"] == m
    # bar EA gửi với lệch giờ 10799 (thật 10800): t = giờ server - 10799 -> backend sửa về đúng phút
    tcp_server._handle_bars(BarsIn(symbol=sym, tf="H1", broker_utc_offset=10799, bars=[{"t": 7200 + 1, "o": 1, "h": 1, "l": 1, "c": 1}]))
    assert [b["t"] for b in state.bars.query(sym, "H1")] == [7200]
    assert state.broker_offset["value"] == 10800


# --- WebSocket / CRUD generic -------------------------------------------------------------------------------------------------------------------------

def test_ws_from_foreign_origin_is_refused_but_app_origin_works():
    c = TestClient(app)
    with pytest.raises(WebSocketDisconnect):
        with c.websocket_connect("/ws", headers={"origin": "https://evil.example"}) as ws:
            ws.send_json({"action": "subscribe", "symbol": "RVEVIL", "tf": "M1"})
            ws.receive_json()
    assert "RVEVIL" not in state.aggregator.tfs
    with c.websocket_connect("/ws", headers={"origin": ALLOWED_ORIGINS[0]}) as ws:
        ws.send_json({"action": "alerts"})
        assert ws.receive_json() == {"type": "alerts_denied"}  # chưa đăng nhập, nhưng kết nối được


def test_generic_tables_are_read_only():
    c = TestClient(app)
    state.meta.put("settings", "rv_flag", "", {"v": 1})
    for t in ("settings", "symbols", "scripts"):
        assert c.put(f"/{t}/rv_flag", json={"v": 2}).status_code == 405
        assert c.delete(f"/{t}/rv_flag").status_code == 405
    assert c.get("/settings/rv_flag").json()["data"] == {"v": 1}


# --- lịch kinh tế bị cắt -----------------------------------------------------------------------------------------------------------------------------

def _ev(i, t):
    return {"id": i, "time": t, "event_id": 1, "currency": "USD", "name": f"e{i}", "importance": 2}


def _ids(lo, hi):
    return sorted(e["id"] for e in economic.query(lo, hi))


def test_truncated_calendar_does_not_delete_missing_events():
    now = int(time.time())
    lo, hi = now + 50 * 86400, now + 50 * 86400 + 1000
    base = 9_000_000
    economic.ingest({"from": lo, "to": hi, "events": [_ev(base + i, lo + i) for i in range(3)]}, now)
    economic.ingest({"from": lo, "to": hi, "partial": True, "events": [_ev(base, lo)]}, now)
    assert _ids(lo, hi) == [base, base + 1, base + 2]
    over = [_ev(base + 10 + i, lo + 10) for i in range(economic.MAX_EVENTS + 1)]  # backend tự cắt cũng là bị cắt
    economic.ingest({"from": lo, "to": hi, "events": over}, now)
    assert {base, base + 1, base + 2} <= set(_ids(lo, hi))
    economic.ingest({"from": lo, "to": hi, "events": [_ev(base, lo)]}, now)  # đủ (không cắt): sự kiện vắng mặt bị xoá như cũ
    assert _ids(lo, hi) == [base]


# --- drain song song ---------------------------------------------------------------------------------------------------------------------------------

class _PausedWriter:
    """Giống StreamWriter của Python 3.9 khi buffer nghẽn: hai coroutine cùng chờ drain -> AssertionError."""

    def __init__(self):
        self.waiting = False
        self.data = []

    def write(self, b):
        self.data.append(b)

    async def drain(self):
        assert not self.waiting
        self.waiting = True
        await asyncio.sleep(0.01)
        self.waiting = False


def test_concurrent_pushes_to_a_slow_ea_keep_the_connection():
    hub = state.EaHub()
    w = _PausedWriter()
    hub.add(w, "srv")

    async def run():
        await asyncio.gather(*(hub._send(w, {"type": "backfill", "n": i}) for i in range(5)))

    asyncio.run(run())
    assert w in hub.writers and len(w.data) == 5
