"""Bản Python của indicator (app/indicators.py) phải ra đúng số của web: so với fixture do TypeScript sinh (web/src/indicators/pyFixtures.test.ts)."""
import json
import math
from pathlib import Path

import pytest

from app import indicators as I

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "indicators.json").read_text())
BARS = FIXTURE["bars"]


def dec(x):
    return math.nan if x is None else float(x) if isinstance(x, str) else x  # float("Infinity") ra inf


CASES = [pytest.param(c, id=f"{k}-{c['id']}") for k, c in enumerate(FIXTURE["cases"])]


@pytest.mark.parametrize("case", CASES)
def test_defaults_and_coercion_match_the_web(case):
    got = I.resolve(case["id"], case["given"])
    assert {k: v for k, v in case["resolved"].items() if k in got} == got
    assert set(case["resolved"]) - set(got) <= {"offset"}  # Offset của MA (dịch plot) không có nghĩa với alert nên không port
    assert I.INDICATORS[case["id"]]["warmup"](case["resolved"]) == case["warmup"]


@pytest.mark.parametrize("case", CASES)
def test_values_match_the_web(case):
    out = I.INDICATORS[case["id"]]["compute"](BARS, case["resolved"])
    for plot, want in case["plots"].items():
        got = out[plot]
        assert len(got) == len(want) == len(BARS)
        for i, (g, w) in enumerate(zip(got, want)):
            w = dec(w)
            if math.isfinite(w):
                assert abs(g - w) < 1e-9, f"{case['id']}.{plot}[{i}]: {g} != {w}"
            elif math.isnan(w):
                assert math.isnan(g), f"{case['id']}.{plot}[{i}]: {g} != NaN"
            else:
                assert g == w, f"{case['id']}.{plot}[{i}]: {g} != {w}"


def test_the_fixture_covers_every_alertable_plot_of_every_indicator():
    seen = {(c["id"], p) for c in FIXTURE["cases"] for p in c["plots"]}
    assert seen == {(i, p) for i, d in I.INDICATORS.items() for p in d["plots"]}


# --- ta -----------------------------------------------------------------------------------------------------------------------------------------------------

def test_na_in_a_window_makes_the_average_na_like_pine():
    got = I.sma([1, 2, math.nan, 4, 5, 6], 2)
    assert math.isnan(got[0]) and got[1] == 1.5 and math.isnan(got[2]) and math.isnan(got[3]) and got[4] == 4.5 and got[5] == 5.5


def test_javascript_division_by_zero():
    assert math.isnan(I._div(0.0, 0.0)) and I._div(1.0, 0.0) == math.inf and I._div(-1.0, 0.0) == -math.inf and I._div(1.0, -0.0) == -math.inf
    assert I._div(6.0, 3.0) == 2.0


def test_rsi_extremes():
    up = [{"t": i, "o": i, "h": i, "l": i, "c": float(i), "v": 1} for i in range(1, 40)]
    assert I.rsi(I.source(up, "close"), 14)[-1] == 100.0  # chỉ tăng
    down = [{**b, "c": 100.0 - b["c"]} for b in up]
    assert I.rsi(I.source(down, "close"), 14)[-1] == 0.0  # chỉ giảm


# --- spec -------------------------------------------------------------------------------------------------------------------------------------------------

def spec(**kw):
    return {"id": "rsi", "plot": "rsi", "vs": "level", **kw}


def test_clean_spec_fills_inputs_and_label():
    s = I.clean_spec(spec(inputs={"length": 7, "junk": 1}))
    assert s["inputs"]["length"] == 7 and s["inputs"]["src"] == "close" and "junk" not in s["inputs"] and s["label"] == "RSI"
    assert I.clean_spec(spec(label="  RSI   (7)  "))["label"] == "RSI (7)"
    assert len(I.clean_spec(spec(label="x" * 500))["label"]) == I.MAX_LABEL


@pytest.mark.parametrize("raw", [
    None, "rsi", [], {}, spec(id="nope"), spec(id=3), spec(plot="nope"), spec(plot=None), spec(vs="nope"), spec(vs=None), spec(vs="rsi"),  # so một đường với chính nó
    {"id": "macd", "plot": "macd", "vs": "sm"}, {"id": "sma", "plot": "sm", "vs": "price"},  # Smoothing đang tắt (mặc định của SMA là None)
    {"id": "sma", "plot": "smUpper", "vs": "price", "inputs": {"smoothType": "SMA"}},  # dải Bollinger của Smoothing cần đúng loại
])
def test_clean_spec_rejects(raw):
    with pytest.raises(ValueError):
        I.clean_spec(raw)


def test_clean_spec_accepts_the_useful_combinations():
    for raw in (spec(), spec(vs="sm"), {"id": "macd", "plot": "macd", "vs": "signal"}, {"id": "stoch", "plot": "k", "vs": "d"}, {"id": "ema", "plot": "ema", "vs": "price"},
                {"id": "bb", "plot": "upper", "vs": "price"}, {"id": "sma", "plot": "sm", "vs": "price", "inputs": {"smoothType": "EMA"}},
                {"id": "sma", "plot": "smUpper", "vs": "level", "inputs": {"smoothType": "SMA + Bollinger Bands"}}):
        assert I.clean_spec(raw)["id"] == raw["id"]


def test_compute_returns_the_plot_and_what_it_is_compared_with():
    a, b = I.compute(I.clean_spec(spec()), BARS)
    assert b is None and len(a) == len(BARS)
    a, b = I.compute(I.clean_spec({"id": "ema", "plot": "ema", "vs": "price"}), BARS)
    assert b == [x["c"] for x in BARS]
    a, b = I.compute(I.clean_spec({"id": "macd", "plot": "macd", "vs": "signal"}), BARS)
    assert b is not None and len(b) == len(BARS) and not math.isnan(b[-1])


def test_history_need_follows_the_warmup_within_bounds():
    short = I.clean_spec({"id": "wma", "plot": "wma", "vs": "price", "inputs": {"length": 5}})
    assert I.history_need(short) == I.HISTORY_FLOOR
    long = I.clean_spec({"id": "ema", "plot": "ema", "vs": "price", "inputs": {"length": 200}})
    assert I.history_need(long) == I.warmup(long) + 100 == 900
    huge = I.clean_spec({"id": "ema", "plot": "ema", "vs": "price", "inputs": {"length": 5000}})
    assert I.history_need(huge) == I.HISTORY_CAP
