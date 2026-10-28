"""Offset của MA / Bollinger trong alert theo indicator (indicators.shift) dịch đường đúng như chart: so với fixture do TypeScript sinh (web/src/alerts/pyOffsetFixtures.test.ts)."""
import json
import math
from pathlib import Path

import pytest

from app import indicators as I

FIXTURE = json.loads((Path(__file__).parent / "fixtures" / "indicators_offset.json").read_text())
BARS = FIXTURE["bars"]


def dec(x):
    return math.nan if x is None else float(x) if isinstance(x, str) else x


@pytest.mark.parametrize("case", [pytest.param(c, id=f"{k}-{c['id']}") for k, c in enumerate(FIXTURE["cases"])])
def test_offset_matches_the_chart(case):
    resolved = I.resolve(case["id"], case["given"])
    assert resolved["offset"] == case["resolved"]["offset"]  # kẹp [-500, 500] như web
    out = I.INDICATORS[case["id"]]["compute"](BARS, resolved)
    for plot, want in case["plots"].items():
        got = out[plot]
        assert len(got) == len(want) == len(BARS)
        for i, (g, w) in enumerate(zip(got, map(dec, want))):
            if math.isnan(w):
                assert math.isnan(g), f"{case['id']}.{plot}[{i}]: {g} != NaN"
            else:
                assert abs(g - w) < 1e-9, f"{case['id']}.{plot}[{i}]: {g} != {w}"


def test_clean_spec_keeps_the_offset_and_history_covers_it():
    s = I.clean_spec({"id": "sma", "plot": "sma", "vs": "price", "inputs": {"offset": 7}})
    assert s["inputs"]["offset"] == 7
    big = I.clean_spec({"id": "sma", "plot": "sma", "vs": "price", "inputs": {"offset": 450}})
    assert I.history_need(big) >= I.warmup(big) + 450
    assert I.clean_spec({"id": "rsi", "plot": "rsi", "vs": "level"})["inputs"].get("offset") is None  # RSI không có Offset
