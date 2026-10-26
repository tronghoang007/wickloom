"""`backend/.env` nạp bí mật (token bot Telegram) mà không cần export tay; biến môi trường thật phải thắng file."""
import os

from app.config import load_env_file


def test_loads_keys_and_strips_quotes_and_export(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("# ghi chú\n\nA_KEY=plain\nexport B_KEY='quoted'\nC_KEY=\"dq\"\nbroken line\nD_KEY=a=b\n", encoding="utf-8")
    for k in ("A_KEY", "B_KEY", "C_KEY", "D_KEY"):
        monkeypatch.delenv(k, raising=False)
    load_env_file(f)

    assert (os.environ["A_KEY"], os.environ["B_KEY"], os.environ["C_KEY"], os.environ["D_KEY"]) == ("plain", "quoted", "dq", "a=b")
    for k in ("A_KEY", "B_KEY", "C_KEY", "D_KEY"):
        monkeypatch.delenv(k)


def test_real_environment_wins_over_file(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("A_KEY=from_file\n", encoding="utf-8")
    monkeypatch.setenv("A_KEY", "from_env")
    load_env_file(f)

    assert os.environ["A_KEY"] == "from_env"


def test_missing_file_is_fine(tmp_path):
    load_env_file(tmp_path / "nope.env")
