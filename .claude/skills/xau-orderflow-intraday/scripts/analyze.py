#!/usr/bin/env python3
"""Gom dữ liệu orderflow của vàng từ backend Wickloom (:8000) thành một bản tóm tắt để chọn vùng đặt alert.

    python3 analyze.py [--symbol XAUUSDm] [--api http://localhost:8000] [--sessions 4] [--week 5] [--range 90]

Chỉ dùng thư viện chuẩn, không cần đăng nhập (bars / tickvp / tickbig / calendar đều public).
Mọi giờ in ra là UTC (giờ VN = UTC+7). Volume là TICK COUNT của CFD, không phải khối lượng khớp thật.
"""
import argparse
import datetime as dt
import json
import statistics
import sys
import time
import urllib.request

SESSION_GAP = 45 * 60  # M1 đứt >= 45 phút = nghỉ giữa phiên / cuối tuần → phiên mới
SIZE = 0.5  # cao một row của volume profile (điểm giá)


def api(base, path):
    return json.load(urllib.request.urlopen(base + path, timeout=60))


def hm(t, full=True):
    return dt.datetime.utcfromtimestamp(t).strftime("%m-%d %H:%M" if full else "%H:%M")


def vn(t):
    return dt.datetime.utcfromtimestamp(t + 7 * 3600).strftime("%m-%d %H:%M")


def trade_cutoff(now):
    """Giờ ngừng trade của user: 22:00 giờ VN = 15:00 UTC. Qua giờ đó (hoặc cuối tuần) thì tính tới 15:00 UTC của ngày giao dịch kế tiếp."""
    t = now - now % 86400 + 15 * 3600
    if t <= now:
        t += 86400
    while dt.datetime.utcfromtimestamp(t).weekday() >= 5:  # thứ 7 / chủ nhật UTC → thứ 2
        t += 86400
    return t


# --- phiên ------------------------------------------------------------------------------------------------------------------------------------------------

def split_sessions(m1):
    out, cur = [], [m1[0]]
    for a, b in zip(m1, m1[1:]):
        if b["t"] - a["t"] >= SESSION_GAP:
            out.append(cur)
            cur = []
        cur.append(b)
    out.append(cur)
    return [dict(t0=s[0]["t"], t1=s[-1]["t"] + 60, o=s[0]["o"], h=max(x["h"] for x in s), l=min(x["l"] for x in s), c=s[-1]["c"], ticks=sum(x["v"] for x in s), bars=s) for s in out]


WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]


def day_label(t0):
    """Ngày giao dịch của một phiên: broker mở lại ~22:00 UTC nên phiên đó thuộc ngày hôm sau (dịch +2 giờ để lấy ngày)."""
    d = dt.datetime.utcfromtimestamp(t0 + 2 * 3600)
    return f"{WEEKDAYS[d.weekday()]} {d:%d/%m}"


def merge_days(sessions):
    """Gộp các đoạn M1 cùng ngày giao dịch (feed rớt giữa ngày, nghỉ lễ ngắn) thành một ngày; đánh nhãn `day`."""
    out = []
    for s in sessions:
        lab = day_label(s["t0"])
        if out and out[-1]["day"] == lab:
            p = out[-1]
            p.update(t1=s["t1"], c=s["c"], h=max(p["h"], s["h"]), l=min(p["l"], s["l"]), ticks=p["ticks"] + s["ticks"], bars=p["bars"] + s["bars"])
        else:
            out.append(dict(s, day=lab))
    return out


# --- volume profile ---------------------------------------------------------------------------------------------------------------------------------------

def profile(base, sym, a, b, lo, hi):
    lo = int(lo // 1)
    n = int(round((hi - lo) / SIZE)) + 1
    if n < 1 or n > 5000:
        return None
    r = api(base, f"/tickvp?symbol={sym}&from={a}&to={b}&lo={lo}&size={SIZE}&n={n}")
    tot = [u + d for u, d in zip(r["up"], r["dn"])]
    if sum(tot) == 0:
        return None
    return dict(lo=lo, up=r["up"], dn=r["dn"], tot=tot)


def value_area(p, pct=0.7):
    tot, lo = p["tot"], p["lo"]
    s = sum(tot)
    poc = max(range(len(tot)), key=lambda i: tot[i])
    li = hi_ = poc
    acc = tot[poc]
    while acc < s * pct:
        up = tot[hi_ + 1] if hi_ + 1 < len(tot) else -1
        dn = tot[li - 1] if li - 1 >= 0 else -1
        if up < 0 and dn < 0:
            break
        up2 = up + (tot[hi_ + 2] if hi_ + 2 < len(tot) else 0)
        dn2 = dn + (tot[li - 2] if li - 2 >= 0 else 0)
        if up2 >= dn2 and up >= 0:  # như TradingView: so tổng hai row kế bên rồi lấy cả hai
            hi_ += 1
            acc += up
            if hi_ + 1 < len(tot) and acc < s * pct:
                hi_ += 1
                acc += tot[hi_]
        else:
            li -= 1
            acc += dn
            if li - 1 >= 0 and acc < s * pct:
                li -= 1
                acc += tot[li]
    px = lambda i: lo + i * SIZE
    return dict(poc=px(poc) + SIZE / 2, vah=px(hi_) + SIZE, val=px(li), total=s, delta=sum(p["up"]) - sum(p["dn"]))


def nodes(p, win=4, reach=8):
    """HVN = đỉnh cục bộ của profile đã làm mượt, đủ cao (>= 45% đỉnh cao nhất); LVN = đáy sâu nhất giữa hai HVN liền kề (<= 60% HVN thấp hơn)."""
    tot, lo = p["tot"], p["lo"]
    sm = [sum(tot[max(0, i - win):i + win + 1]) / (2 * win + 1) for i in range(len(tot))]
    top = max(sm)
    hv = [i for i in range(len(sm)) if sm[i] >= 0.45 * top and sm[i] == max(sm[max(0, i - reach):i + reach + 1]) and (i == 0 or sm[i] != sm[i - 1])]
    lv = []
    for a, b in zip(hv, hv[1:]):
        j = min(range(a, b + 1), key=lambda k: sm[k])
        if sm[j] <= 0.6 * min(sm[a], sm[b]):
            lv.append(j)
    px = lambda i: lo + i * SIZE + SIZE / 2
    return [(px(i), round(sm[i])) for i in hv], [(px(i), round(sm[i])) for i in lv]


# --- delta / CVD -----------------------------------------------------------------------------------------------------------------------------------------

def session_cvd(sess, tdm):
    rows, cvd, have = [], 0, 0
    for b in sess["bars"]:
        d = tdm.get(b["t"])
        if d:
            have += 1
        dl = d["c"] if d else 0
        cvd += dl
        rows.append((b["t"], b["o"], b["h"], b["l"], b["c"], dl, cvd, d["v"] if d else 0))
    return rows, have / len(sess["bars"])


def buckets(rows, sec):
    out = {}
    for t, o, h, l, c, dl, cvd, n in rows:
        k = t // sec * sec
        x = out.setdefault(k, dict(t=k, o=o, h=h, l=l, c=c, d=0, cvd=0, n=0))
        x["h"] = max(x["h"], h)
        x["l"] = min(x["l"], l)
        x["c"] = c
        x["d"] += dl
        x["cvd"] = cvd
        x["n"] += n
    return [out[k] for k in sorted(out)]


def absorption(rows, sess_median_ticks5):
    """Cửa sổ 5 phút có tick >= 2x trung vị mà nằm ở đáy / đỉnh cục bộ (±30 phút), kèm phản ứng giá 15 phút sau đó."""
    b5 = buckets(rows, 300)
    out = []
    for i, x in enumerate(b5):
        if x["n"] < 2 * sess_median_ticks5:
            continue
        nb = [y for y in b5 if abs(y["t"] - x["t"]) <= 1800]
        after = [y for y in b5 if x["t"] < y["t"] <= x["t"] + 900]
        kind = "ĐÁY" if x["l"] <= min(y["l"] for y in nb) + 0.5 else "ĐỈNH" if x["h"] >= max(y["h"] for y in nb) - 0.5 else None
        if not kind or not after:
            continue
        move = after[-1]["c"] - x["c"]
        out.append((x, kind, move))
    return out


# --- bias trong ngày --------------------------------------------------------------------------------------------------------------------------------------

RECENT = 3 * 3600  # POC "gần đây" (3 giờ cuối) so với POC phần đầu ngày
ACCEPT = 3600  # giá đứng ngoài value đã hình thành ít nhất 1 giờ mới tính là chấp nhận
MOM = 120  # phút xét xung lực giá + CVD
MIN_PRIOR = 2 * 3600  # phần đầu ngày phải có ít nhất 2 giờ dữ liệu thì mới so sánh


def intraday_bias(base, sym, cur, prev_v, tdm, med_range):
    """Bias trong ngày = tổng 4 phiếu (+1 tăng / -1 giảm / 0 trung tính), chỉ dùng dữ liệu của phiên đang chạy (trừ VA hôm qua làm mốc).
    Hướng chỉ có khi |tổng| >= 2. Ngưỡng tính theo biên ngày trung vị của các ngày trước (med_range). Trả (tổng, hướng, nhãn, các dòng in)."""
    bars, t0, t1 = cur["bars"], cur["t0"], cur["t1"]
    px, el = bars[-1]["c"], t1 - t0
    lo, hi = cur["l"] - 2, cur["h"] + 2
    sc, out = 0, []

    def vote(v, text):
        nonlocal sc
        sc += v
        out.append(f"  {v:+d}  {text}")

    if prev_v:  # giá hiện tại, không phải giá mở cửa: mở cửa trên VA rồi bị bán xuống dưới VA thì phiếu này phải đổi chiều theo
        edge = 0.1 * med_range  # nhô qua mép VA vài điểm chưa tính: tránh bias nhảy qua lại ở mép
        v = 1 if px > prev_v["vah"] + edge else -1 if px < prev_v["val"] - edge else 0
        vote(v, f"Giá {px:.1f} {'TRÊN' if v > 0 else 'DƯỚI' if v < 0 else 'TRONG'} VA hôm qua ({prev_v['val']:.1f}–{prev_v['vah']:.1f}, đệm ±{edge:.0f}); mở cửa {cur['o']:.1f}")
    else:
        out.append("   .  Giá so với VA hôm qua: không có VA hôm qua")

    old = profile(base, sym, t0, t1 - ACCEPT, lo, hi) if el >= ACCEPT + MIN_PRIOR else None
    if old:
        va = value_area(old)
        cl = [b["c"] for b in bars if b["t"] >= t1 - ACCEPT]
        up, dn = sum(c > va["vah"] for c in cl) / len(cl), sum(c < va["val"] for c in cl) / len(cl)
        v = 1 if up >= 0.8 else -1 if dn >= 0.8 else 0
        vote(v, f"Chấp nhận ngoài value: value tới {hm(t1 - ACCEPT, False)} = {va['val']:.1f}–{va['vah']:.1f}, 60 phút cuối {100 * up:.0f}% đóng trên / {100 * dn:.0f}% đóng dưới (cần ≥80%)")
    else:
        out.append("   .  Chấp nhận ngoài value: chưa đủ dữ liệu trong ngày")

    e = profile(base, sym, t0, t1 - RECENT, lo, hi) if el >= RECENT + MIN_PRIOR else None
    late = profile(base, sym, t1 - RECENT, t1 + 60, lo, hi) if e else None
    if e and late:
        pe, pl = value_area(e)["poc"], value_area(late)["poc"]
        thr = 0.35 * med_range
        v = 1 if pl - pe >= thr else -1 if pl - pe <= -thr else 0
        vote(v, f"POC dịch: {pe:.1f} (từ đầu ngày tới {hm(t1 - RECENT, False)}) → {pl:.1f} (3 giờ cuối) = {pl - pe:+.1f}, ngưỡng ±{thr:.0f}")
    else:
        out.append("   .  POC dịch: chưa đủ dữ liệu trong ngày")

    if len(bars) > MOM:
        w = bars[-MOM:]
        mv = px - w[0]["o"]
        dc = sum(tdm[b["t"]]["c"] for b in w if b["t"] in tdm)
        thr = 0.3 * med_range
        big = abs(mv) >= thr
        v = (1 if mv > 0 else -1) if big and mv * dc > 0 else 0
        vote(v, f"Xung lực 2 giờ: giá {mv:+.1f}, delta {dc:+.0f} → " + ("đồng thuận" if v else "phân kỳ giá/delta" if big and mv * dc < 0 else f"giá chưa đi đủ {thr:.0f} điểm"))
    else:
        out.append("   .  Xung lực 2 giờ: chưa đủ dữ liệu trong ngày")

    d = "up" if sc >= 2 else "down" if sc <= -2 else None
    label = "TĂNG" if d == "up" else "GIẢM" if d == "down" else "CÂN BẰNG" + (" (nghiêng nhẹ tăng)" if sc == 1 else " (nghiêng nhẹ giảm)" if sc == -1 else "")
    rng = cur["h"] - cur["l"]
    out.append(f"      Biên hôm nay {rng:.1f} = {rng / med_range:.2f}× biên trung vị {med_range:.1f} của các ngày trước" + (" → nén" if rng < 0.8 * med_range and el >= 6 * 3600 else ""))
    return sc, d, label, out


# --- ứng viên mức giá -------------------------------------------------------------------------------------------------------------------------------------

class Levels:
    def __init__(self):
        self.items = []  # [giá, trọng số, [nhãn]]

    def add(self, price, w, label):
        for it in self.items:
            if abs(it[0] - price) <= 1.5:
                it[1] += w
                it[2].append(label)
                it[0] = (it[0] * (len(it[2]) - 1) + price) / len(it[2])
                return
        self.items.append([price, w, [label]])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--symbol", default="XAUUSDm")
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--sessions", type=int, default=4, help="số ngày gần nhất in profile riêng (HVN / LVN, ứng viên); ngày đang chạy tính là 1")
    ap.add_argument("--week", type=int, default=5, help="số ngày đã xong (cộng ngày đang chạy) cho bảng value dịch chuyển + composite tuần")
    ap.add_argument("--range", type=float, default=90, help="chỉ liệt kê mức giá trong ±range điểm quanh giá hiện tại")
    ap.add_argument("--asof", help="chạy lại như thể bây giờ là thời điểm này: epoch giây hoặc 'MM-DD HH:MM' UTC (kiểm chứng bias của một buổi đã qua)")
    ap.add_argument("--bias-only", action="store_true", help="in bias trong ngày rồi thoát; dòng cuối là BIAS=up|down|none (skill monitor đọc dòng này mỗi lần bật)")
    a = ap.parse_args()
    base, sym = a.api, a.symbol
    now = int(time.time())
    if a.asof:
        now = int(a.asof) if a.asof.isdigit() else int(dt.datetime.strptime(f"{dt.datetime.utcnow().year}-{a.asof}", "%Y-%m-%d %H:%M").replace(tzinfo=dt.timezone.utc).timestamp())

    try:
        health = api(base, "/health")
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"Backend {base} không trả lời ({exc}). Chạy backend trước (dev.sh).")
    m1 = api(base, f"/bars?symbol={sym}&tf=M1&limit=50000")
    if not m1:
        sys.exit(f"Không có nến M1 của {sym}")
    td = api(base, f"/bars?symbol={sym}&tf=TD&limit=50000")
    if a.asof:
        m1 = [b for b in m1 if b["t"] <= now]
        td = [b for b in td if b["t"] <= now]
        if not m1:
            sys.exit(f"Không có nến M1 nào trước {hm(now)} UTC")
    tdm = {b["t"]: b for b in td}
    price = m1[-1]["c"]
    age = (now - m1[-1]["t"]) / 60

    cut_ts = trade_cutoff(now)
    cut = hm(cut_ts)
    print(f"# {sym} orderflow snapshot — now {hm(now)} UTC = {vn(now)} VN, giá M1 cuối {price:.3f} ({hm(m1[-1]['t'])}, trễ {age:.0f} phút)")
    print(f"Cửa sổ trade intraday: hết giờ {cut} UTC = 22:00 VN (còn {(cut_ts - now) / 3600:.1f} giờ) → alert đặt ra nên hết hạn đúng lúc này: expires_at={cut_ts}")
    if age > 15:
        print(f"!! M1 cuối trễ {age:.0f} phút: thị trường đóng cửa, hoặc EA / backend không đẩy tick. Dữ liệu dưới đây KHÔNG phải trạng thái hiện tại.")
    print(f"M1 từ {hm(m1[0]['t'])} ({len(m1)} nến) | TD (tick delta) từ {hm(td[0]['t']) if td else '—'} ({len(td)} phút) | offset broker {health.get('offset')}")

    sessions = merge_days(split_sessions(m1))
    cur = sessions[-1]
    live = (now - m1[-1]["t"]) <= SESSION_GAP
    tick_from = td[0]["t"] if td else None
    stats = {}

    def day_stats(s):
        """Profile tick của một ngày giao dịch: dict(v, hv, lv), hoặc chuỗi lý do không có."""
        if s["t0"] not in stats:
            if tick_from is None or s["t1"] <= tick_from:
                stats[s["t0"]] = "không có dữ liệu tick (ngoài vùng tick history)"
            else:
                p = profile(base, sym, s["t0"], s["t1"] + 60, s["l"] - 2, s["h"] + 2)
                if p:
                    hv, lv = nodes(p)
                    stats[s["t0"]] = dict(v=value_area(p), hv=hv, lv=lv)
                else:
                    stats[s["t0"]] = "profile rỗng"
        return stats[s["t0"]]

    print("\n## Ngày giao dịch (M1 liền mạch = một ngày; ngày mở lại 22:00 UTC, giờ in là UTC)")
    for s in sessions[-12:]:
        tag = "  <- đang chạy" if s is cur and live else ""
        print(f"{s['day']}  [{hm(s['t0'])}→{hm(s['t1'], False)}]  O {s['o']:.1f} H {s['h']:.1f} L {s['l']:.1f} C {s['c']:.1f}  biên {s['h'] - s['l']:.1f}  tick {s['ticks']:.0f}{tag}")

    bias = None  # hướng bias trong ngày ("up" / "down" / None) — quyết định vùng nào là theo / ngược XH
    if not live:
        print("\n## BIAS TRONG NGÀY: không có (thị trường đóng, phiên cuối đã xong)")
    elif len(sessions) < 2:
        print("\n## BIAS TRONG NGÀY: không có (chưa có ngày trước để so)")
    else:
        prev_st = day_stats(sessions[-2])
        med_range = statistics.median([s["h"] - s["l"] for s in sessions[-6:-1]])
        sc, bias, label, lines = intraday_bias(base, sym, cur, prev_st["v"] if isinstance(prev_st, dict) else None, tdm, med_range)
        print(f"\n## BIAS TRONG NGÀY — phiên {cur['day']} từ {hm(cur['t0'])} UTC, 4 phiếu (+1 tăng / -1 giảm / 0 trung tính; hướng chỉ có khi |tổng| ≥ 2)")
        print("\n".join(lines))
        print(f"=> BIAS TRONG NGÀY: {label} (tổng {sc:+d})")
        if bias:
            with_t, against = ("Demand (mua khi giá lùi xuống)", "Supply") if bias == "up" else ("Supply (bán khi giá hồi lên)", "Demand")
            print(f"HƯỚNG THEO BIAS TRONG NGÀY: {with_t}; {against} là ngược bias (đòi xác nhận mạnh hơn)")
        else:
            print("HƯỚNG THEO BIAS TRONG NGÀY: không có (trong ngày chưa nghiêng rõ) — Supply và Demand ngang nhau, ưu tiên mép VA hôm nay / hôm qua")
    if a.bias_only:
        print(f"BIAS={bias or 'none'}")
        return

    lo7, hi7 = min(m1, key=lambda b: b["l"]), max(m1, key=lambda b: b["h"])
    print(f"\nĐáy toàn lịch sử M1: {lo7['l']:.3f} ({hm(lo7['t'])}) | đỉnh: {hi7['h']:.3f} ({hm(hi7['t'])}) | giá cách đáy {price - lo7['l']:+.1f}, cách đỉnh {price - hi7['h']:+.1f}")
    if lo7["l"] >= price - 0:  # giá đang ở đáy lịch sử
        print("Giá đang ở đáy lịch sử dữ liệu: không có profile bên dưới.")

    L = Levels()
    L.add(lo7["l"], 2.0, f"đáy lịch sử {hm(lo7['t'])}")
    L.add(hi7["h"], 2.0, f"đỉnh lịch sử {hm(hi7['t'])}")

    # --- cấu trúc nhiều ngày: value dịch chuyển + composite tuần ---------------------------------------------------------------------------------------
    week = sessions[-max(1, a.week + (1 if live else 0)):]
    days = [(s, day_stats(s)) for s in week]
    days = [(s, st) for s, st in days if isinstance(st, dict)]
    print(f"\n## Cấu trúc {len(week)} ngày ({week[0]['day']} → {week[-1]['day']}): value dịch chuyển (VA so với ngày trước)")
    kinds, pv = {}, None
    for s, st in days:
        v = st["v"]
        if pv is None:
            kind, rel = None, ""
        elif v["val"] > pv["vah"]:
            kind, rel = "up", "VA CAO hơn (không chồng lấn)"
        elif v["vah"] < pv["val"]:
            kind, rel = "down", "VA THẤP hơn (không chồng lấn)"
        else:
            kind, rel = "ovl", f"chồng lấn, POC {v['poc'] - pv['poc']:+.1f}"
        kinds[s["t0"]] = kind
        tag = "  <- đang chạy" if s is cur and live else ""
        print(f"{s['day']}  C {s['c']:.1f}  biên {s['h'] - s['l']:5.1f}  POC {v['poc']:.2f}  VA {v['val']:.1f}–{v['vah']:.1f}  delta {100 * v['delta'] / v['total']:+.1f}%  {rel}{tag}")
        pv = v

    comp = None
    if days:
        a0 = max(week[0]["t0"], tick_from)
        p = profile(base, sym, a0, cur["t1"] + 60, min(s["l"] for s in week) - 5, max(s["h"] for s in week) + 5)
        if p:
            comp = value_area(p)
            hv, lv = nodes(p)
            print(f"-- COMPOSITE tuần {hm(a0)}→nay: POC {comp['poc']:.2f}  VAH {comp['vah']:.2f}  VAL {comp['val']:.2f}  tick {comp['total']:.0f}")
            print(f"   HVN {[f'{x:.1f}({n})' for x, n in hv if abs(x - price) <= a.range]}\n   LVN {[f'{x:.1f}({n})' for x, n in lv if abs(x - price) <= a.range]}")
            L.add(comp["poc"], 2.0, "POC composite tuần")
            L.add(comp["vah"], 1.5, "VAH composite tuần")
            L.add(comp["val"], 1.5, "VAL composite tuần")
            for x, n in hv:
                L.add(x, 1.0, "HVN composite tuần")

    done = [(s, st) for s, st in days if not (s is cur and live)]
    trend = None
    if comp and len(done) >= 3:
        first, last = done[0][1]["v"]["poc"], done[-1][1]["v"]["poc"]
        thr = 0.75 * statistics.median([s["h"] - s["l"] for s, _ in done])
        kd = [kinds[s["t0"]] for s, _ in done]
        trend = "up" if last - first >= thr else "down" if last - first <= -thr else None
        settled = ""
        if trend and len(days) >= 3:  # cú xả / bơm cũ nằm trong cửa sổ nhưng 3 ngày gần nhất đã cân bằng lại → không còn là xu hướng
            r3 = days[-1][1]["v"]["poc"] - days[-3][1]["v"]["poc"]
            if r3 * (1 if trend == "up" else -1) < 0.5 * thr:
                settled = f" [cú {'bơm' if trend == 'up' else 'xả'} cũ đã cân bằng lại: POC 3 ngày gần nhất {r3:+.1f}, dưới nửa ngưỡng {0.5 * thr:.0f}]"
                trend = None
        pos = "above" if price > comp["vah"] else "below" if price < comp["val"] else "in"
        where = lambda v: "TRÊN" if price > v["vah"] else "DƯỚI" if price < v["val"] else "TRONG"
        yd = done[-1][1]["v"]
        here = f"{where(yd)} VA {done[-1][0]['day']} ({yd['val']:.1f}–{yd['vah']:.1f})"
        if live and days and days[-1][0] is cur:
            td_v = days[-1][1]["v"]
            here = f"{where(td_v)} VA hôm nay ({td_v['val']:.1f}–{td_v['vah']:.1f}); " + here
        vv = f"{comp['val']:.1f}–{comp['vah']:.1f}"
        verdict = {
            ("down", "below"): f"XU HƯỚNG GIẢM: value dịch xuống, giá dưới value tuần → thị trường đang chấp nhận giá thấp; value cũ phía trên ({vv}) là vùng cung khi giá hồi.",
            ("down", "in"): "Xu hướng giảm nhưng giá đã hồi vào value tuần: chưa chấp nhận hẳn giá thấp; mép trên VA tuần là nơi phe bán phản ứng.",
            ("down", "above"): f"Value dịch xuống nhưng giá vượt lên trên value tuần ({vv}): ngược xu hướng, cần thấy giữ trên VAH tuần + CVD đồng thuận mới tin, không thì dễ là quét thanh khoản.",
            ("up", "above"): f"XU HƯỚNG TĂNG: value dịch lên, giá trên value tuần → thị trường đang chấp nhận giá cao; value cũ phía dưới ({vv}) là vùng cầu khi giá lùi.",
            ("up", "in"): "Xu hướng tăng nhưng giá đã lùi vào value tuần: chưa chấp nhận hẳn giá cao; mép dưới VA tuần là nơi phe mua phản ứng.",
            ("up", "below"): f"Value dịch lên nhưng giá thủng xuống dưới value tuần ({vv}): ngược xu hướng, cần thấy giữ dưới VAL tuần + CVD đồng thuận mới tin, không thì dễ là quét thanh khoản.",
            (None, "in"): "CÂN BẰNG: value không dịch rõ, giá quay quanh POC / VA tuần → mép VA là nơi phản ứng, giữa VA là nhiễu.",
            (None, "above"): "THOÁT CÂN BẰNG LÊN: giá trên value tuần nhưng value chưa dịch lên → chờ xác nhận chấp nhận (giữ trên VAH tuần).",
            (None, "below"): "THOÁT CÂN BẰNG XUỐNG: giá dưới value tuần nhưng value chưa dịch xuống → chờ xác nhận chấp nhận (giữ dưới VAL tuần).",
        }[(trend, pos)]
        print(f"\nKẾT LUẬN CẤU TRÚC NHIỀU NGÀY (bối cảnh, KHÔNG quyết định hướng hôm nay) — POC {done[0][0]['day']} {first:.1f} → {done[-1][0]['day']} {last:.1f} ({last - first:+.1f}; ngưỡng xu hướng ±{thr:.0f} = 0.75 × biên trung vị); VA: {kd.count('down')} ngày thấp hơn, {kd.count('up')} cao hơn, {kd.count('ovl')} chồng lấn{settled}")
        print(f"Giá {price:.1f}: {where(comp)} value tuần ({vv}); {here}")
        print(f"=> {verdict}")
        if bias and trend and bias != trend:
            print(f"Lệch: bias trong ngày {'TĂNG' if bias == 'up' else 'GIẢM'} ngược cấu trúc nhiều ngày → theo bias trong ngày; vùng của cấu trúc cũ chỉ là mốc tham khảo")
    elif comp:
        print("\n(Chưa đủ 3 ngày đã xong có tick để kết luận cấu trúc — chỉ xem bảng và composite.)")

    # --- profile từng ngày (HVN / LVN + ứng viên) -----------------------------------------------------------------------------------------------------
    print("\n## Volume profile tick (row 0.5) — POC / VAH / VAL / HVN / LVN từng ngày")
    for s in reversed(sessions[-a.sessions:]):
        name = s["day"] + (" nay" if s is cur and live else "")
        st = day_stats(s)
        if isinstance(st, str):
            print(f"-- {name}: {st}")
            continue
        v, hv, lv = st["v"], st["hv"], st["lv"]
        near = lambda xs: [f"{x:.1f}({n})" for x, n in xs if abs(x - price) <= a.range]
        print(f"-- {name} [{s['l']:.1f}–{s['h']:.1f}]: POC {v['poc']:.2f}  VAH {v['vah']:.2f}  VAL {v['val']:.2f}  tick {v['total']:.0f}  delta {v['delta']:+.0f} ({100 * v['delta'] / v['total']:+.1f}%)")
        print(f"   HVN {near(hv)}\n   LVN {near(lv)}")
        L.add(v["poc"], 2.0, f"POC {name}")
        L.add(v["vah"], 1.5, f"VAH {name}")
        L.add(v["val"], 1.5, f"VAL {name}")
        L.add(s["h"], 1.0, f"đỉnh {name}")
        L.add(s["l"], 1.0, f"đáy {name}")
        for x, n in hv:
            L.add(x, 1.0, f"HVN {name}")
        for x, n in lv:
            L.add(x, 0.5, f"LVN(mỏng) {name}")

    # --- CVD phiên hiện tại ------------------------------------------------------------------------------------------------------------------------------
    rows, cover = session_cvd(cur, tdm)
    print(f"\n## CVD phiên hiện tại ({hm(cur['t0'])}→nay), độ phủ TD {100 * cover:.0f}% các phút" + ("  !! thiếu dữ liệu, CVD chỉ tương đối" if cover < 0.9 else ""))
    b15 = buckets(rows, 900)
    for x in b15[-32:]:
        print(f"{hm(x['t'], False)}  O {x['o']:.1f} H {x['h']:.1f} L {x['l']:.1f} C {x['c']:.1f} | delta {x['d']:+5.0f} | CVD {x['cvd']:+6.0f} | tick {x['n']:.0f}")
    hi_row = max(rows, key=lambda r: r[2])
    lo_row = min(rows, key=lambda r: r[3])
    cmax = max(rows, key=lambda r: r[6])
    cmin = min(rows, key=lambda r: r[6])
    print(f"Đỉnh phiên {hi_row[2]:.1f} lúc {hm(hi_row[0], False)}: CVD khi đó {hi_row[6]:+.0f} | CVD cao nhất {cmax[6]:+.0f} lúc {hm(cmax[0], False)}")
    print(f"Đáy phiên  {lo_row[3]:.1f} lúc {hm(lo_row[0], False)}: CVD khi đó {lo_row[6]:+.0f} | CVD thấp nhất {cmin[6]:+.0f} lúc {hm(cmin[0], False)}")
    print(f"CVD hiện tại {rows[-1][6]:+.0f}. (đỉnh giá & CVD cùng lúc = xác nhận; đỉnh giá sau mà CVD thấp hơn = phân kỳ; đáy ngược lại)")
    last = rows[-60:]
    print(f"60 phút gần nhất: delta {sum(r[5] for r in last):+.0f}, tick {sum(r[7] for r in last):.0f}, giá {last[0][1]:.1f}→{last[-1][4]:.1f}")

    # --- hấp thụ ở đáy / đỉnh ------------------------------------------------------------------------------------------------------------------------------
    b5 = buckets(rows, 300)
    med5 = statistics.median([x["n"] for x in b5]) if b5 else 0
    ab = absorption(rows, med5)
    print(f"\n## Cửa sổ 5 phút tick >= 2x trung vị phiên ({med5:.0f}) nằm ở đáy/đỉnh cục bộ — dấu hiệu hấp thụ (phản ứng = giá đóng 15 phút sau − đóng cửa sổ)")
    if not ab:
        print("(không có)")
    for x, kind, move in sorted(ab, key=lambda z: -z[0]["n"])[:6]:
        print(f"{hm(x['t'], False)} tại {kind}  [{x['l']:.1f}–{x['h']:.1f}] tick {x['n']:.0f} ({x['n'] / max(med5, 1):.1f}x)  delta {x['d']:+.0f}  phản ứng {move:+.1f}")
        L.add(x["l"] if kind == "ĐÁY" else x["h"], 2.0, f"hấp thụ {kind.lower()} {hm(x['t'], False)}")

    # --- big trades --------------------------------------------------------------------------------------------------------------------------------------------
    prev = sessions[-2] if len(sessions) > 1 else cur
    if tick_from is not None:
        rowsb = api(base, f"/tickbig?symbol={sym}&from={max(prev['t0'], tick_from)}&to={cur['t1'] + 60}&min=40&limit=300&size=1")["rows"]
        top = sorted(rowsb, key=lambda r: -(r[2] + r[3]))[:8]
        print(f"\n## Ô (phút × giá 1.0) nhiều tick nhất trong 2 phiên gần nhất")
        for t, p_, u, d in sorted(top, key=lambda r: r[0]):
            print(f"{hm(t)}  {p_:.1f}  lên {u:.0f} xuống {d:.0f}  net {u - d:+.0f}")

    # --- ứng viên ----------------------------------------------------------------------------------------------------------------------------------------------
    print(f"\n## Ứng viên mức giá trong ±{a.range:.0f} điểm quanh {price:.1f} (điểm = độ trùng; >=3 là mạnh)")
    cands = [it for it in L.items if abs(it[0] - price) <= a.range]
    for it in sorted(cands, key=lambda z: -z[0]):
        side = "TRÊN " if it[0] > price else "DƯỚI "
        mark = "★" if it[1] >= 3 else " "
        tag = "" if bias is None else "  [theo XH]" if (it[0] > price) == (bias == "down") else "  [ngược XH]"
        print(f"{mark}{side}{it[0]:9.2f}  ({it[0] - price:+6.1f})  điểm {it[1]:.1f}  {'; '.join(dict.fromkeys(it[2]))}{tag}")

    # --- tin kinh tế --------------------------------------------------------------------------------------------------------------------------------------------
    try:
        cal = api(base, f"/calendar?from={now}&to={now + 86400 * 4}&min_importance=2&currencies=USD")
        ev = cal["events"]
        print(f"\n## Tin USD trong cửa sổ trade (tới {cut} UTC) — calendar cập nhật {hm(int(cal['updated_at'])) if cal.get('updated_at') else 'chưa từng'}")
        inside = [e for e in ev if e["time"] <= cut_ts]
        for e in inside:
            print(f"{hm(e['time'])} UTC ({vn(e['time'])} VN)  mức {e['importance']}  {e['name']}  forecast {e['forecast']} trước {e['previous']}  <- TRONG CỬA SỔ")
        if not inside:
            print("(không có tin USD mức >= 2 trong cửa sổ)")
        later = [e for e in ev if e["time"] > cut_ts and e["importance"] >= 3]
        print("Tin USD mức 3 sau cửa sổ (4 ngày tới):")
        for e in later:
            print(f"{hm(e['time'])} UTC ({vn(e['time'])} VN)  {e['name']}  forecast {e['forecast']} trước {e['previous']}")
        if not ev and not cal.get("updated_at"):
            print("!! EA chưa gửi lịch: không biết có tin hay không")
    except Exception as exc:  # noqa: BLE001
        print(f"\n(Không đọc được lịch kinh tế: {exc})")


if __name__ == "__main__":
    main()
