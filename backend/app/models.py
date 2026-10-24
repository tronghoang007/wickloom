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
    f: Optional[int] = None  # cờ tick của MT5 (TICK_FLAG_BID 2 / LAST 8...; EA >= 2.17); None = EA cũ không báo


class SymbolInfo(BaseModel):
    name: str
    digits: int = 5
    tick_size: float = 0.00001
    session: str = ""
    type: str = "forex"
    description: str = ""
    broker: str = ""
    # Thông số giao dịch (EA >= 2.12); None = EA cũ không báo -> web không đoán min/step của symbol
    volume_min: Optional[float] = None
    volume_max: Optional[float] = None
    volume_step: Optional[float] = None
    contract_size: Optional[float] = None
    tick_value: Optional[float] = None  # giá trị một tick lãi / lỗi theo tiền account (EA >= 2.14): web tính lãi/lỗi dự kiến của SL/TP
    tick_value_loss: Optional[float] = None
    stops_level: Optional[int] = None
    freeze_level: Optional[int] = None


class SymbolsIn(BaseModel):
    broker_utc_offset: int = 0
    symbols: List[SymbolInfo]


class TicksIn(BaseModel):
    broker_utc_offset: int = 0
    symbol: str
    lm: bool = False  # nến của symbol theo giá Last (EA >= 2.17): delta tick lấy tick giao dịch, trọng số = volume; không thì theo Bid
    ticks: List[Tick]


class BarsIn(BaseModel):
    broker_utc_offset: int = 0
    symbol: str
    tf: str
    bars: List[Bar]
    done: Optional[bool] = None  # chunk cuối của backfill


class TicksHistIn(BaseModel):
    """Lịch sử tick EA gửi khi web xin backfill tf "TD" (xem tickdelta.py): mảng song song, tăng dần theo thời gian."""
    broker_utc_offset: int = 0
    symbol: str
    t: List[int]  # time_msc theo giờ server (như `ticks`)
    p: List[float]  # giá dùng để phân loại: bid (khung nến theo Bid) hoặc last (khung nến theo Last)
    w: Optional[List[float]] = None  # trọng số từng tick (volume khi theo Last); thiếu = 1
    pb: float = 0  # giá tick liền trước cửa sổ (0 = không biết)
    pd: int = 1  # chiều (1 lên / -1 xuống) của tick đó
    cont: bool = False  # tiếp nối thông điệp trước của cùng yêu cầu
    done: Optional[bool] = None
