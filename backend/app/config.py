import os
import time
from pathlib import Path
from typing import Optional


def load_env_file(path: Path) -> None:
    """Đọc KEY=VALUE từ `backend/.env` (đã nằm trong .gitignore) cho bí mật như token bot. Biến môi trường thật luôn thắng file."""
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, val = line.removeprefix("export ").partition("=")
        key, val = key.strip(), val.strip()
        if len(val) >= 2 and val[0] == val[-1] and val[0] in "'\"":
            val = val[1:-1]
        if key:
            os.environ.setdefault(key, val)


load_env_file(Path(__file__).resolve().parent.parent / ".env")

DATA_DIR = Path(os.environ.get("TV_DATA_DIR", Path(__file__).resolve().parent.parent / "data"))
EA_TOKEN = os.environ.get("TV_TOKEN", "dev-token")
BARS_DIR = DATA_DIR / "bars"  # cache parquet cũ (trước khi chuyển sang SQLite) - dời đi khi đổi broker
BARS_DB = DATA_DIR / "bars.sqlite"
SQLITE_PATH = DATA_DIR / "meta.sqlite"

# Web được phép gọi API (CORS + chặn CSRF theo Origin). Đổi khi chạy web ở cổng/host khác.
ALLOWED_ORIGINS = [o.strip() for o in os.environ.get(
    "WICKLOOM_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000").split(",") if o.strip()]
ALLOW_REGISTER = os.environ.get("WICKLOOM_ALLOW_REGISTER", "1") != "0"  # đặt 0 khi lỡ đưa app ra mạng
COOKIE_SECURE = os.environ.get("WICKLOOM_COOKIE_SECURE", "0") == "1"  # bật khi chạy sau HTTPS

# Bot Telegram cho alert (docs/alerts-plan.md): token chỉ ở biến môi trường, không bao giờ gửi xuống web hay ghi log. Rỗng = kênh Telegram tắt.
TG_BOT_TOKEN = os.environ.get("WICKLOOM_TG_BOT_TOKEN", "").strip()

EA_TCP_HOST =os.environ.get("TV_EA_TCP_HOST", "127.0.0.1")
EA_TCP_PORT = int(os.environ.get("TV_EA_TCP_PORT", "8001"))

TF_SECONDS = {
    "M1": 60, "M2": 120, "M3": 180, "M4": 240, "M5": 300, "M6": 360, "M10": 600,
    "M12": 720, "M15": 900, "M20": 1200, "M30": 1800,
    "H1": 3600, "H2": 7200, "H3": 10800, "H4": 14400, "H6": 21600, "H8": 28800, "H12": 43200,
    "D1": 86400, "W1": 604800, "MN1": 0,
}


def tf_step(tf: str) -> int:
    """Độ dài (giây) một nến của `tf` để đếm số nến: MN1 dài không đều (TF_SECONDS = 0) nên tính 30 ngày. Không bao giờ trả 0 (chia cho nó)."""
    return TF_SECONDS.get(tf) or 2592000


# Lệch giờ broker - UTC luôn là bội 15 phút. EA tính bằng hai lần đọc đồng hồ (TimeTradeServer - TimeGMT) nên có lúc lệch 1s (vd 10799):
# để nguyên thì giờ nến lệch 1s -> nến đang gom đóng sớm, nến lạc ghi vào DB
OFFSET_ROUND = 900


def round_offset(offset: int) -> int:
    return int(round(offset / OFFSET_ROUND)) * OFFSET_ROUND


def is_stale(last_t: Optional[int], tf: str) -> bool:
    """Cache chưa có bar nào, hoặc bar cuối đã cũ hơn 2x khung tf -> cần top-up."""
    if last_t is None:
        return True
    return time.time() - last_t > tf_step(tf) * 2
