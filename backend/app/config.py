import os
import time
from pathlib import Path
from typing import Optional

DATA_DIR = Path(os.environ.get("TV_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
EA_TOKEN = os.environ.get("TV_TOKEN", "dev-token")
BARS_DIR = DATA_DIR / "bars"  # cache parquet cũ (trước khi chuyển sang SQLite) - dời đi khi đổi broker
BARS_DB = DATA_DIR / "bars.sqlite"
SQLITE_PATH = DATA_DIR / "meta.sqlite"

EA_TCP_HOST = os.environ.get("TV_EA_TCP_HOST", "127.0.0.1")
EA_TCP_PORT = int(os.environ.get("TV_EA_TCP_PORT", "8001"))

TF_SECONDS = {
    "M1": 60, "M2": 120, "M3": 180, "M4": 240, "M5": 300, "M6": 360, "M10": 600,
    "M12": 720, "M15": 900, "M20": 1200, "M30": 1800,
    "H1": 3600, "H2": 7200, "H3": 10800, "H4": 14400, "H6": 21600, "H8": 28800, "H12": 43200,
    "D1": 86400, "W1": 604800, "MN1": 0,
}


def is_stale(last_t: Optional[int], tf: str) -> bool:
    """Cache chưa có bar nào, hoặc bar cuối đã cũ hơn 2x khung tf -> cần top-up."""
    if last_t is None:
        return True
    step = TF_SECONDS.get(tf) or TF_SECONDS["MN1"] or 2592000
    return time.time() - last_t > step * 2
