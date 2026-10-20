from typing import List, Optional

from pydantic import BaseModel


class Bar(BaseModel):
    t: int  # UTC epoch seconds
    o: float
    h: float
    l: float
    c: float
    v: float = 0


class Tick(BaseModel):
    t_msc: int
    bid: float
    ask: float = 0
    last: float = 0
    vol: float = 0


class SymbolInfo(BaseModel):
    name: str
    digits: int = 5
    tick_size: float = 0.00001
    session: str = ""
    type: str = "forex"
    description: str = ""
    broker: str = ""


class SymbolsIn(BaseModel):
    broker_utc_offset: int = 0
    symbols: List[SymbolInfo]


class TicksIn(BaseModel):
    broker_utc_offset: int = 0
    symbol: str
    ticks: List[Tick]


class BarsIn(BaseModel):
    broker_utc_offset: int = 0
    symbol: str
    tf: str
    bars: List[Bar]
    done: Optional[bool] = None  # chunk cuối của backfill
