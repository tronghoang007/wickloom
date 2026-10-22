"""Đăng ký / đăng nhập Wickloom: cookie phiên HttpOnly + chặn CSRF theo Origin + giới hạn thử mật khẩu."""
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import accounts, config, state
from .accounts import AuthStore

SESSION_COOKIE = "wickloom_session"
BAD_LOGIN = "Email hoặc mật khẩu không đúng"
UNSAFE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}

store = AuthStore(state.meta)


class LoginThrottle:
    """Đếm lần sai theo (ip, email) trong bộ nhớ: từ lần thứ 5 khoá 60s, mỗi lần sai tiếp theo gấp đôi (tối đa 1h)."""

    FREE, BASE, CAP = 5, 60, 3600

    def __init__(self, clock: Callable[[], float] = time.time):
        self.clock = clock
        self.fails: Dict[Tuple[str, str], List[float]] = {}  # key -> [số lần sai, khoá đến, lần cuối]

    def wait(self, key: Tuple[str, str]) -> int:
        e = self.fails.get(key)
        return max(0, int(e[1] - self.clock()) + 1) if e and e[1] > self.clock() else 0

    def fail(self, key: Tuple[str, str]) -> None:
        now = self.clock()
        if len(self.fails) > 2000:  # dọn mục cũ để không phình bộ nhớ
            self.fails = {k: v for k, v in self.fails.items() if v[2] > now - 900}
        e = self.fails.setdefault(key, [0, 0.0, now])
        e[0] += 1
        e[2] = now
        if e[0] >= self.FREE:
            e[1] = now + min(self.CAP, self.BASE * 2 ** (e[0] - self.FREE))

    def ok(self, key: Tuple[str, str]) -> None:
        self.fails.pop(key, None)


throttle = LoginThrottle()


class OriginGuard:
    """Chặn CSRF: request đổi dữ liệu mang Origin lạ -> 403. Cookie SameSite=Lax không đủ vì `localhost:xxxx` khác
    cổng vẫn cùng "site". Không có Origin (curl, test) thì cho qua: trình duyệt luôn gửi Origin cho POST/PUT/DELETE."""

    def __init__(self, app, allowed: List[str]):
        self.app = app
        self.allowed = set(allowed)

    async def __call__(self, scope, receive, send):
        if scope["type"] == "http" and scope["method"] in UNSAFE_METHODS:
            origin = dict(scope["headers"]).get(b"origin")
            if origin is not None and origin.decode("latin-1") not in self.allowed:
                await JSONResponse({"detail": "Origin không được phép"}, status_code=403)(scope, receive, send)
                return
        await self.app(scope, receive, send)


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        SESSION_COOKIE, token, max_age=accounts.SESSION_TTL, httponly=True, samesite="lax", path="/",
        secure=config.COOKIE_SECURE,
    )


def optional_user(request: Request, response: Response) -> Optional[Dict[str, Any]]:
    token = request.cookies.get(SESSION_COOKIE)
    res = store.resolve_session(token) if token else None
    if res is None:
        return None
    user, renewed = res
    if renewed:
        _set_cookie(response, token)
    return user


def current_user(user: Optional[Dict[str, Any]] = Depends(optional_user)) -> Dict[str, Any]:
    if user is None:
        raise HTTPException(401, "Chưa đăng nhập")
    return user


class RegisterBody(BaseModel):
    email: str
    password: str
    name: str = ""
    claim_legacy: bool = False


class LoginBody(BaseModel):
    email: str
    password: str


class PasswordBody(BaseModel):
    old: str
    new: str


class ProfileBody(BaseModel):
    name: str


def _check_password(pw: str) -> None:
    if len(pw) < accounts.PW_MIN:
        raise HTTPException(422, f"Mật khẩu tối thiểu {accounts.PW_MIN} ký tự")
    if len(pw) > accounts.PW_MAX:
        raise HTTPException(422, f"Mật khẩu tối đa {accounts.PW_MAX} ký tự")


def _clean_name(name: str, email: str) -> str:
    return (name or "").strip()[:60] or email.split("@")[0]


def _public(user: Dict[str, Any]) -> Dict[str, Any]:
    return {"id": user["id"], "email": user["email"], "name": user["name"]}


# Các route là `def` (không async) để băm mật khẩu (~0.2s) chạy trong threadpool, không chặn event loop tick realtime.
router = APIRouter(prefix="/auth")


@router.get("/options")
def options():
    """Cho form đăng ký: có mở đăng ký không, và có dữ liệu cũ để nhận không (chỉ khi chưa có user nào)."""
    return {"allow_register": config.ALLOW_REGISTER,
            "claim_legacy": store.count_users() == 0 and store.legacy_available()}


@router.post("/register", status_code=201)
def register(body: RegisterBody, request: Request, response: Response):
    if not config.ALLOW_REGISTER:
        raise HTTPException(403, "Đăng ký đang tắt")
    email = accounts.normalize_email(body.email)
    if not accounts.valid_email(email):
        raise HTTPException(422, "Email không hợp lệ")
    _check_password(body.password)
    first_user = store.count_users() == 0
    try:
        user = store.create_user(email, _clean_name(body.name, email), body.password)
    except accounts.DuplicateEmail:
        raise HTTPException(409, "Email này đã được đăng ký")
    # Chỉ tài khoản đầu tiên được nhận dữ liệu cũ; không tick thì dữ liệu nằm yên (claim sau bằng auth_cli).
    claimed = store.claim_legacy(user["id"]) if first_user and body.claim_legacy else 0
    token = store.create_session(user["id"], request.headers.get("user-agent", ""))
    _set_cookie(response, token)
    return {"user": _public(user), "claimed": claimed}


@router.post("/login")
def login(body: LoginBody, request: Request, response: Response):
    email = accounts.normalize_email(body.email)
    key = (request.client.host if request.client else "", email)
    wait = throttle.wait(key)
    if wait:
        raise HTTPException(429, f"Thử sai quá nhiều lần. Thử lại sau {wait} giây", headers={"Retry-After": str(wait)})
    row = store.by_email(email)
    too_long = len(body.password) > accounts.PW_MAX
    # luôn băm một lần (kể cả email không tồn tại / mật khẩu quá dài) để thời gian không lộ thông tin
    good = accounts.verify_password("" if too_long else body.password, row["pw_hash"] if row else accounts.dummy_hash())
    if not (row and good and not too_long):
        throttle.fail(key)
        raise HTTPException(401, BAD_LOGIN)
    throttle.ok(key)
    token = store.create_session(row["id"], request.headers.get("user-agent", ""))
    _set_cookie(response, token)
    return {"user": _public(row)}


@router.post("/logout")
def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        store.revoke(token)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return {"ok": True}


@router.get("/me")
def me(user: Dict[str, Any] = Depends(current_user)):
    return {"user": user}


@router.patch("/me")
def update_me(body: ProfileBody, user: Dict[str, Any] = Depends(current_user)):
    name = _clean_name(body.name, user["email"])
    store.set_name(user["id"], name)
    return {"user": {**user, "name": name}}


@router.post("/password")
def change_password(body: PasswordBody, request: Request, user: Dict[str, Any] = Depends(current_user)):
    key = (request.client.host if request.client else "", user["email"])
    wait = throttle.wait(key)
    if wait:
        raise HTTPException(429, f"Thử sai quá nhiều lần. Thử lại sau {wait} giây", headers={"Retry-After": str(wait)})
    row = store.by_id(user["id"])
    if len(body.old) > accounts.PW_MAX or not row or not accounts.verify_password(body.old, row["pw_hash"]):
        throttle.fail(key)
        raise HTTPException(401, "Mật khẩu cũ không đúng")
    throttle.ok(key)
    _check_password(body.new)
    store.set_password(user["id"], body.new)
    store.revoke_user(user["id"], keep_token=request.cookies.get(SESSION_COOKIE))
    return {"ok": True}
