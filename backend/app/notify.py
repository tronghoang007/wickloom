"""Giao thông báo alert ra các kênh: web (WebSocket), Telegram, MT5 mobile (EA gọi SendNotification). (docs/alerts-plan.md mục 5.3)

Không biết gì về DB hay engine: alerts.py nối các mảnh vào nhau. Mọi lời gọi mạng chạy ở thread nền (Dispatcher.run / TelegramLinker.run), không bao giờ trên event loop
của tick realtime. Token bot Telegram nằm trong URL của api.telegram.org nên KHÔNG được để lọt vào thông báo lỗi / log: mọi lỗi httpx đổi thành mô tả chung."""
import html
import itertools
import queue
import re
import secrets
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

import httpx

TG_API = "https://api.telegram.org"
TG_MAX = 4096  # giới hạn ký tự của sendMessage
MT5_MAX = 255  # giới hạn ký tự của SendNotification
MT5_PER_MIN = 8  # MT5 cho 10/phút; chừa dư
MT5_MIN_GAP = 0.5  # 2/giây
MT5_MIN_EA = (2, 19)  # EA hiểu lệnh `notify`
LINK_TTL = 600  # mã liên kết Telegram hết hạn sau 10 phút

NOT_CONFIGURED = "chưa cấu hình bot Telegram (WICKLOOM_TG_BOT_TOKEN)"
COND_TEXT = {"cross": "Crossing", "cross_up": "Crossing Up", "cross_down": "Crossing Down", "gt": "Greater Than", "lt": "Less Than"}


def fmt_price(p: float) -> str:
    return f"{p:.10g}"


def when(ts: int) -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S UTC", time.gmtime(ts))


@dataclass
class Fired:
    """Một lần alert nổ: ảnh chụp alert (dict như API trả) + giá lúc nổ + giờ (epoch giây UTC)."""
    alert: Dict[str, Any]
    price: float
    time: int


def condition_text(a: Dict[str, Any]) -> str:
    return f"{a['symbol']} {COND_TEXT.get(a['cond'], a['cond'])} {fmt_price(a['level'])}"


def telegram_text(f: Fired) -> str:
    """HTML của Telegram: tên / nội dung do người dùng gõ phải escape, không thì `<` làm sendMessage báo lỗi (hoặc chèn thẻ)."""
    a = f.alert
    lines = [f"🔔 <b>{html.escape(a['name'] or a['symbol'])}</b>", html.escape(f"{condition_text(a)} · giá {fmt_price(f.price)}")]
    if a["message"]:
        lines.append(html.escape(a["message"]))
    lines.append(html.escape(when(f.time)))
    return "\n".join(lines)[:TG_MAX]


def _cut(s: str, n: int) -> str:
    return s if len(s) <= n else s[: n - 1] + "…"


def _flat(s: str) -> str:
    """Một dòng, không `"` và `\\`: EA đọc JSON bằng tìm chuỗi (JsonStr) nên không hiểu dấu thoát."""
    return re.sub(r"\s+", " ", s).replace("\\", "/").replace('"', "'").strip()


def push_text(f: Fired) -> str:
    a = f.alert
    s = f"{condition_text(a)} @ {fmt_price(f.price)}"
    if a["name"]:
        s = f"{a['name']}: {s}"
    if a["message"]:
        s += f" - {a['message']}"
    return _cut(_flat(s), MT5_MAX)


def push_merged(batch: List[Fired]) -> str:
    """Nhiều alert nổ cùng lúc -> một tin: "3 alert: A, B, C" (MT5 chỉ cho vài tin mỗi phút)."""
    parts = [_flat(f"{f.alert['name'] or condition_text(f.alert)}") for f in batch]
    return _cut(f"{len(batch)} alert: " + ", ".join(parts), MT5_MAX)


def _version(v: Any) -> Tuple[int, ...]:
    return tuple(int(x) for x in str(v).split(".") if x.isdigit()) if v else ()


class Telegram:
    """Client tối giản của Bot API. `transport` thay được (test dùng httpx.MockTransport)."""

    def __init__(self, token: Callable[[], str], transport: Optional[httpx.BaseTransport] = None, sleep: Callable[[float], None] = time.sleep, base: str = TG_API):
        self._token = token
        self._sleep = sleep
        self._base = base
        self._client = httpx.Client(transport=transport, timeout=httpx.Timeout(10.0, read=40.0))
        self._username: Optional[str] = None

    @property
    def configured(self) -> bool:
        return bool(self._token())

    def _post(self, method: str, payload: Dict[str, Any], read_timeout: Optional[float] = None) -> httpx.Response:
        kw: Dict[str, Any] = {}
        if read_timeout is not None:
            kw["timeout"] = httpx.Timeout(10.0, read=read_timeout)
        return self._client.post(f"{self._base}/bot{self._token()}/{method}", json=payload, **kw)

    def send(self, chat_id: Any, text: str, tries: int = 3) -> str:
        """Gửi tin HTML; trả "ok" hoặc lý do lỗi (tiếng Việt, không chứa token). Tôn trọng retry_after khi 429; lỗi mạng / 5xx thử lại, 4xx khác thì thôi."""
        if not self.configured:
            return NOT_CONFIGURED
        last = "lỗi không rõ"
        for attempt in range(tries):
            try:
                r = self._post("sendMessage", {"chat_id": chat_id, "text": text, "parse_mode": "HTML", "disable_web_page_preview": True})
            except httpx.HTTPError as exc:
                last = f"lỗi mạng ({type(exc).__name__})"
                self._sleep(1 + attempt)
                continue
            body = _json(r)
            if r.status_code == 200 and body.get("ok"):
                return "ok"
            if r.status_code == 429:
                wait = _retry_after(body)
                last = f"Telegram giới hạn tốc độ, chờ {wait}s"
                if wait > 30:
                    return last
                self._sleep(wait)
                continue
            if r.status_code >= 500:
                last = f"Telegram lỗi {r.status_code}"
                self._sleep(1 + attempt)
                continue
            return f"Telegram từ chối ({r.status_code}): {str(body.get('description', ''))[:120]}"
        return last

    def username(self) -> Optional[str]:
        """Tên bot (getMe), nhớ sau lần đầu; None khi gọi không được."""
        if self._username is None and self.configured:
            try:
                body = _json(self._post("getMe", {}))
                name = (body.get("result") or {}).get("username")
                if body.get("ok") and isinstance(name, str):
                    self._username = name
            except httpx.HTTPError:
                pass
        return self._username

    def updates(self, offset: int, timeout: int = 25) -> List[Dict[str, Any]]:
        """getUpdates (long-poll). Ném httpx.HTTPError / ValueError khi lỗi - người gọi lo nghỉ rồi thử lại."""
        r = self._post("getUpdates", {"offset": offset, "timeout": timeout, "allowed_updates": ["message"]}, read_timeout=timeout + 15)
        body = _json(r)
        if r.status_code != 200 or not body.get("ok"):
            raise ValueError(f"getUpdates {r.status_code}")
        res = body.get("result")
        return res if isinstance(res, list) else []


def _json(r: httpx.Response) -> Dict[str, Any]:
    try:
        j = r.json()
    except ValueError:
        return {}
    return j if isinstance(j, dict) else {}


def _retry_after(body: Dict[str, Any]) -> int:
    v = (body.get("parameters") or {}).get("retry_after")
    return int(v) if isinstance(v, (int, float)) and 0 < v < 3600 else 1


START_RE = re.compile(r"^/start(?:@\w+)?(?:\s+([A-Za-z0-9_-]{8,64}))?\s*$")


class TelegramLinker:
    """Liên kết tài khoản Wickloom <-> chat Telegram không cần URL công khai: web xin mã (dùng một lần, hết hạn LINK_TTL), người dùng mở t.me/<bot>?start=<mã>,
    thread này long-poll getUpdates thấy "/start <mã>" thì lưu chat_id cho user đó."""

    def __init__(self, tg: Telegram, on_link: Callable[[str, int, str], None], clock: Callable[[], float] = time.time):
        self.tg = tg
        self.on_link = on_link
        self.clock = clock
        self._codes: Dict[str, Tuple[str, float]] = {}
        self._lock = threading.Lock()
        self._offset = 0
        self._stop = threading.Event()
        self._thread: Optional[threading.Thread] = None

    def new_code(self, user_id: str) -> str:
        code = secrets.token_urlsafe(12)
        now = self.clock()
        with self._lock:
            self._codes = {c: v for c, v in self._codes.items() if v[1] > now and v[0] != user_id}  # dọn mã hết hạn; mỗi user chỉ một mã đang chờ
            self._codes[code] = (user_id, now + LINK_TTL)
        return code

    def _take(self, code: str) -> Optional[str]:
        with self._lock:
            v = self._codes.pop(code, None)
        return v[0] if v and v[1] > self.clock() else None

    def handle_update(self, u: Dict[str, Any]) -> None:
        m = u.get("message")
        if not isinstance(m, dict) or not isinstance(m.get("text"), str):
            return
        chat = m.get("chat") if isinstance(m.get("chat"), dict) else {}
        if chat.get("type") != "private" or not isinstance(chat.get("id"), int):
            return
        match = START_RE.match(m["text"].strip())
        if not match:
            return
        code = match.group(1)
        if not code:
            self.tg.send(chat["id"], "Mở Wickloom → Settings → Alerts → Connect Telegram để lấy link kết nối.")
            return
        user_id = self._take(code)
        if user_id is None:
            self.tg.send(chat["id"], "Mã kết nối không hợp lệ hoặc đã hết hạn. Tạo mã mới trong Wickloom → Settings → Alerts.")
            return
        who = str(chat.get("username") or chat.get("first_name") or "")[:60]
        self.on_link(user_id, chat["id"], who)
        self.tg.send(chat["id"], "✅ Đã kết nối Wickloom. Alert bật kênh Telegram sẽ gửi về đây.")

    def poll_once(self) -> int:
        n = 0
        for u in self.tg.updates(self._offset):
            uid = u.get("update_id")
            if isinstance(uid, int):
                self._offset = max(self._offset, uid + 1)
            self.handle_update(u)
            n += 1
        return n

    def run(self) -> None:
        backoff = 5
        while not self._stop.is_set():
            if not self.tg.configured:
                self._stop.wait(30)
                continue
            try:
                self.poll_once()
                backoff = 5
            except (httpx.HTTPError, ValueError) as exc:
                print(f"Telegram getUpdates loi: {type(exc).__name__}")
                self._stop.wait(backoff)
                backoff = min(backoff * 2, 120)

    def start(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._stop.clear()
            self._thread = threading.Thread(target=self.run, name="tg-linker", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()


class PushLimiter:
    """Giới hạn gửi SendNotification: tối đa 2/giây và MT5_PER_MIN/phút (vượt thì MT5 có thể khoá hàm)."""

    def __init__(self, clock: Callable[[], float] = time.time):
        self.clock = clock
        self._sent: List[float] = []
        self._lock = threading.Lock()

    def reserve(self) -> float:
        """Giây phải chờ trước khi gửi (0 = gửi ngay), -1 = hết hạn mức phút -> bỏ tin này."""
        with self._lock:
            now = self.clock()
            self._sent = [t for t in self._sent if now - t < 60]
            if len(self._sent) >= MT5_PER_MIN:
                return -1
            wait = max(0.0, self._sent[-1] + MT5_MIN_GAP - now) if self._sent else 0.0
            self._sent.append(now + wait)
            return wait


class Mt5Push:
    """Đẩy tin sang điện thoại qua EA (SendNotification). Điện thoại nhận theo terminal MT5 chứ không theo tài khoản Wickloom."""

    def __init__(self, ea_hub: Any, accounts: Callable[[], List[Dict[str, Any]]], limiter: Optional[PushLimiter] = None,
                 sleep: Callable[[float], None] = time.sleep, wait: float = 2.0):
        self.ea_hub = ea_hub
        self.accounts = accounts
        self.limiter = limiter or PushLimiter()
        self._sleep = sleep
        self._wait = wait
        self._seq = itertools.count(1)
        self._pending: Dict[int, Tuple[threading.Event, Dict[str, Any]]] = {}

    def status(self) -> Dict[str, Any]:
        """`push_enabled` None = EA chưa báo (EA cũ hoặc chưa kết nối)."""
        acc = next((a for a in self.accounts() if a.get("online")), None)
        ver = acc.get("ea_version") if acc else None
        return {"online": acc is not None, "version": ver, "supports": bool(_version(ver)) and _version(ver) >= MT5_MIN_EA,
                "push_enabled": acc.get("push_enabled") if acc else None}

    def send(self, text: str) -> str:
        st = self.status()
        if not st["online"]:
            return "EA offline"
        if not st["supports"]:
            return f"EA cần bản {'.'.join(map(str, MT5_MIN_EA))} trở lên (biên dịch lại TVBridge bằng F7)"
        if st["push_enabled"] is False:
            return "MT5 chưa bật Push Notifications (Tools → Options → Notifications)"
        wait = self.limiter.reserve()
        if wait < 0:
            return f"bỏ: quá giới hạn {MT5_PER_MIN} tin/phút của MT5"
        if wait:
            self._sleep(wait)
        nid = next(self._seq)
        ev, res = threading.Event(), {}
        self._pending[nid] = (ev, res)
        try:
            self.ea_hub.push({"type": "notify", "id": nid, "text": _cut(_flat(text), MT5_MAX)})
            if not ev.wait(self._wait):
                return "đã gửi cho EA nhưng EA không xác nhận"
        finally:
            self._pending.pop(nid, None)
        if res.get("ok"):
            return "ok"
        return f"MT5 từ chối (mã lỗi {res.get('err', 0)}): kiểm tra MetaQuotes ID trong Tools → Options → Notifications"

    def resolve(self, msg: Dict[str, Any]) -> None:
        """EA báo kết quả SendNotification (`notify_result`)."""
        entry = self._pending.get(msg.get("id")) if isinstance(msg.get("id"), int) else None
        if entry:
            entry[1].update(ok=msg.get("ok") is True, err=msg.get("err") if isinstance(msg.get("err"), int) else 0)
            entry[0].set()


class Dispatcher:
    """Nhận các lần nổ, giao qua kênh alert bật, ghi nhật ký kèm kết quả từng kênh. Chạy ở thread nền; `handle` đồng bộ cho test."""

    def __init__(self, *, send_web: Callable[[str, Dict[str, Any]], int], telegram: Telegram, chat_of: Callable[[str], Optional[int]],
                 mt5: Mt5Push, log_add: Callable[[Fired], int], log_set: Callable[[int, Dict[str, str]], None],
                 coalesce: float = 0.2):
        self.send_web = send_web
        self.telegram = telegram
        self.chat_of = chat_of
        self.mt5 = mt5
        self.log_add = log_add
        self.log_set = log_set
        self.coalesce = coalesce
        self._q: "queue.Queue[Fired]" = queue.Queue()
        self._thread: Optional[threading.Thread] = None

    def submit(self, f: Fired) -> None:
        self._q.put(f)

    def handle(self, batch: List[Fired]) -> None:
        logs: List[Tuple[Fired, int, Dict[str, str]]] = []
        for f in batch:
            res: Dict[str, str] = {}
            ch = f.alert["channels"]
            log_id = self.log_add(f)
            if ch.get("web"):
                shown = {k: v for k, v in f.alert.items() if k != "user_id"}
                n = self.send_web(f.alert["user_id"], {"type": "alert_fired", "alert": shown, "price": f.price, "time": f.time, "log_id": log_id})
                res["web"] = "ok" if n else "không có tab Wickloom nào đang mở"
            logs.append((f, log_id, res))
        for f, _, res in logs:
            if f.alert["channels"].get("telegram"):
                chat = self.chat_of(f.alert["user_id"])
                res["telegram"] = "chưa kết nối Telegram" if chat is None else self.telegram.send(chat, telegram_text(f))
        pushed = [(f, res) for f, _, res in logs if f.alert["channels"].get("mt5")]
        if pushed:
            fs = [f for f, _ in pushed]
            result = self.mt5.send(push_text(fs[0]) if len(fs) == 1 else push_merged(fs))
            for _, res in pushed:
                res["mt5"] = result
        for f, log_id, res in logs:
            self.log_set(log_id, res)
            self.send_web(f.alert["user_id"], {"type": "alert_delivery", "log_id": log_id, "alert_id": f.alert["id"], "results": res})

    def run(self) -> None:
        while True:
            first = self._q.get()
            time.sleep(self.coalesce)  # cho các alert nổ cùng một lô tick vào hết hàng đợi để gộp tin MT5
            batch = [first]
            while len(batch) < 50:
                try:
                    batch.append(self._q.get_nowait())
                except queue.Empty:
                    break
            try:
                self.handle(batch)
            except Exception as exc:
                print(f"alert dispatch loi: {type(exc).__name__}: {exc}")

    def start(self) -> None:
        if self._thread is None or not self._thread.is_alive():
            self._thread = threading.Thread(target=self.run, name="alert-dispatch", daemon=True)
            self._thread.start()
