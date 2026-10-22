"""Quản lý tài khoản Wickloom từ máy chạy backend (không có "quên mật khẩu" qua mail):

    python -m app.auth_cli list
    python -m app.auth_cli reset <email>      # đặt mật khẩu mới (hỏi, không nhận từ argv) + thu hồi mọi phiên
    python -m app.auth_cli claim-legacy <email>   # giao watchlist/hình vẽ cũ (trước khi có tài khoản) cho user này
"""
import getpass
import sys

from . import accounts
from .accounts import AuthStore
from .store import MetaStore


def main(argv=None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    store = AuthStore(MetaStore())
    if args[:1] == ["list"]:
        with store.meta.tx() as db:
            for uid, email, name, created in db.execute("SELECT id, email, name, created_at FROM users ORDER BY created_at"):
                print(f"{uid}  {email}  {name}  (tạo {created})")
        return 0
    if len(args) == 2 and args[0] == "reset":
        user = store.by_email(args[1])
        if user is None:
            print(f"Không có tài khoản {args[1]}", file=sys.stderr)
            return 1
        pw = getpass.getpass("Mật khẩu mới: ")
        if pw != getpass.getpass("Nhập lại: "):
            print("Hai lần nhập không khớp", file=sys.stderr)
            return 1
        if not accounts.PW_MIN <= len(pw) <= accounts.PW_MAX:
            print(f"Mật khẩu phải {accounts.PW_MIN}-{accounts.PW_MAX} ký tự", file=sys.stderr)
            return 1
        store.set_password(user["id"], pw)
        store.revoke_user(user["id"])
        print(f"Đã đặt lại mật khẩu cho {user['email']}; mọi phiên đăng nhập đã bị thu hồi.")
        return 0
    if len(args) == 2 and args[0] == "claim-legacy":
        user = store.by_email(args[1])
        if user is None:
            print(f"Không có tài khoản {args[1]}", file=sys.stderr)
            return 1
        if store.legacy_claimed():
            print("Dữ liệu cũ đã được nhận rồi.", file=sys.stderr)
            return 1
        n = store.claim_legacy(user["id"])
        print(f"Đã chuyển {n} mục cho {user['email']} (bản sao lưu: meta_pre_auth_*.sqlite cạnh meta.sqlite).")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main())
