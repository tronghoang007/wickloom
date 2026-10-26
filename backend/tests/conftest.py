import os
import tempfile

# Phải đặt trước khi bất kỳ test nào import `app` - state.py mở DB ngay lúc import.
os.environ.setdefault("TV_DATA_DIR", tempfile.mkdtemp())
# Rỗng (không phải bỏ trống) để `backend/.env` không nạp token bot thật vào test.
os.environ["WICKLOOM_TG_BOT_TOKEN"] = ""
