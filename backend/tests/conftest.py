import os
import tempfile

# Phải đặt trước khi bất kỳ test nào import `app` - state.py mở DB ngay lúc import.
os.environ.setdefault("TV_DATA_DIR", tempfile.mkdtemp())
