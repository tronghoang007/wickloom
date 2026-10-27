#!/usr/bin/env python3
"""Theo dõi vùng Supply / Demand (hình `xau-of-*` do /xau-orderflow-intraday vẽ) trên tick của backend Wickloom, mỗi dòng stdout là một sự kiện cho Monitor.

    python3 -I watch.py --zones zones.json [--symbol XAUUSDm] [--minutes 29] [--replay 180]

zones.json = [{"name":"S1","side":"S"|"D","lo":4023.2,"hi":4025.0,"bad":4026.0,"against":false,"text":"Supply · đỉnh nay"}, ...]
  side S = Supply (giá lên chạm), D = Demand (giá xuống chạm). bad = mức làm kịch bản sai khi nến M5 ĐÓNG vượt qua (mặc định hi+1 cho Supply, lo-1 cho Demand); râu quét qua mà M5 đóng lại phía trong chỉ báo cờ, không huỷ.
  against = vùng ngược bias trong ngày: cần hai trong ba dấu hiệu (hấp thụ, phân kỳ CVD, M5 từ chối); vùng theo bias chỉ cần một. `--bias` ghi đè cờ này theo bias hiện tại.

Dòng sự kiện: `!!` có cờ, `   ... [trong vùng]` giá đang trong vùng, `·` trạng thái 5 phút một dòng. Khi vùng đủ xác nhận in thêm
`>>> TÍN HIỆU {json}` (entry / sl / tp1 / tp2 / rr1 gợi ý) và khi vùng đó sai kịch bản sau tín hiệu thì `>>> HUỶ {json}`.
--replay N: chạy lại N phút gần nhất như thể vừa xảy ra (để kiểm tra luật trên dữ liệu thật), in xong thì thoát.
"""
import argparse
import datetime as dt
import json
import statistics
import time
import urllib.request

UTC = dt.timezone.utc
SL_PAD = 0.3      # SL nằm ngoài mức sai kịch bản thêm ngần này (spread vàng ~0.25)
TP_PAD = 0.3      # TP dừng trước mép vùng đối diện ngần này
MIN_TICK = 400.0  # tick/phút tối thiểu để tính là "tick cao" (ngưỡng thật = max(MIN_TICK, 2 × trung vị 90 phút gần nhất))
DIV_MIN = 15.0    # đỉnh/đáy mới mà CVD chênh ít hơn ngần này so với lần trước = nhiễu của tick-rule, không tính phân kỳ (≈ một phút delta bình thường)


def get(base, sym, tf, n):
    with urllib.request.urlopen(f"{base}/bars?symbol={sym}&tf={tf}&limit={n}", timeout=10) as r:
        return json.load(r)


def vn(t):
    return (dt.datetime.fromtimestamp(t, UTC) + dt.timedelta(hours=7)).strftime("%H:%M")


def session_start(now):
    """Ngày giao dịch vàng mở lại 22:00 UTC: mốc gần nhất không sau `now`."""
    d = dt.datetime.fromtimestamp(now, UTC)
    s = d.replace(hour=22, minute=0, second=0, microsecond=0)
    return int((s if d >= s else s - dt.timedelta(days=1)).timestamp())


def cum_map(td, start):
    cum, c = {}, 0
    for b in sorted(td, key=lambda b: b["t"]):
        if b["t"] >= start:
            c += b["c"]
        cum[b["t"]] = c
    return cum


class Zone:
    def __init__(self, raw):
        self.name = str(raw["name"])
        self.side = raw["side"]
        self.lo, self.hi = float(raw["lo"]), float(raw["hi"])
        sup = self.side == "S"
        self.bad = float(raw["bad"]) if raw.get("bad") else (self.hi + 1.0 if sup else self.lo - 1.0)
        self.text = raw.get("text") or self.name
        self.set_against(bool(raw.get("against")))
        self.ref = None    # (giá đỉnh/đáy, CVD tại đó) để xét phân kỳ, giữ qua các lần giá tới vùng
        self.armed = True  # giá đang ở phía tiếp cận (Supply: dưới vùng, Demand: trên vùng); đã xuyên qua vùng thì chưa tính cho tới khi giá đóng cửa lại phía đó
        self.reset()

    def set_against(self, against):
        """Ngược bias trong ngày (cần 2 trong 3 dấu hiệu) hay theo bias (cần 1)."""
        self.against = against
        self.label = f"{'Supply' if self.side == 'S' else 'Demand'} {self.name} {self.lo:g}–{self.hi:g}" + (" (ngược XH)" if against else "")

    def reset(self):
        """Bắt đầu một lần giá tới vùng mới."""
        self.entered = False
        self.peak = None   # đỉnh cao nhất (Supply) / đáy thấp nhất (Demand) kể từ khi vào vùng
        self.push = set()
        self.abs = False
        self.div = False
        self.rej = False   # nến M5 có râu vào vùng nhưng đóng ngoài mép vùng (quét rồi bị từ chối)
        self.bad_fired = False
        self.said = set()
        self.signalled = False
        self.reasons = []


def load_zones(path):
    with open(path, encoding="utf-8") as f:
        return [Zone(z) for z in json.load(f)]


def proposal(z, price, zones):
    """Gợi ý vào / SL / TP cho tín hiệu của vùng `z` ở giá `price`: SL ngoài mức sai kịch bản, TP về mép vùng đối diện gần nhất."""
    sup = z.side == "S"
    edge = max(z.bad, z.hi) if sup else min(z.bad, z.lo)   # `bad` nằm trong vùng (vd alert ghi M5 đóng >4019 mà vùng tới 4019.12) thì SL vẫn ra ngoài mép vùng
    sl = edge + SL_PAD if sup else edge - SL_PAD
    risk = (sl - price) if sup else (price - sl)
    if risk <= 0:
        return None   # giá đã qua mức SL: không còn lệnh để gợi ý
    others = [o for o in zones if o is not z and o.side != z.side]
    if sup:   # Sell: TP ở mép trên các vùng Demand phía dưới
        tps = [o.hi + TP_PAD for o in sorted((o for o in others if o.hi < price - 0.5), key=lambda o: -o.hi)]
        fallback = [price - 2 * risk, price - 3 * risk]
    else:     # Buy: TP ở mép dưới các vùng Supply phía trên
        tps = [o.lo - TP_PAD for o in sorted((o for o in others if o.lo > price + 0.5), key=lambda o: o.lo)]
        fallback = [price + 2 * risk, price + 3 * risk]
    tp1, tp2 = (tps + fallback)[:2]
    rr1 = abs(price - tp1) / risk if risk > 0 else 0.0
    warn = []
    if rr1 < 1.5:
        warn.append(f"R:R1 {rr1:.2f} < 1.5")
    if risk < 1.5:
        warn.append(f"SL chỉ cách {risk:.2f} điểm, dễ bị quét")
    return {"zone": z.name, "side": "SELL" if sup else "BUY", "against": z.against, "entry": round(price, 2), "sl": round(sl, 2),
            "tp1": round(tp1, 2), "tp2": round(tp2, 2), "risk": round(risk, 2), "rr1": round(rr1, 2), "why": "; ".join(z.reasons), "warn": warn}


M5 = {"k": None, "h": 0.0, "l": 0.0}   # đỉnh / đáy của nến M5 đang chạy, cộng dồn từ các nến M1 đã đóng


def m5_update(b):
    k = b["t"] // 300
    if M5["k"] != k:
        M5.update(k=k, h=b["h"], l=b["l"])
    else:
        M5["h"], M5["l"] = max(M5["h"], b["h"]), min(M5["l"], b["l"])


def confirm(z, b, zones, flags, signals):
    """Đủ xác nhận? Vùng theo bias trong ngày cần 1 trong 3 dấu hiệu (hấp thụ, phân kỳ, M5 từ chối), vùng ngược bias cần 2 trong 3."""
    n = z.abs + z.div + z.rej
    if n >= (2 if z.against else 1) and "ok" not in z.said:
        p = proposal(z, b["c"], zones)
        if p is None:
            if "late" not in z.said:
                z.said.add("late")
                flags.append(f"{z.label}: đủ xác nhận nhưng giá {b['c']:.1f} đã qua mức SL, không có tín hiệu")
            return
        z.said.add("ok")
        z.signalled = True
        flags.append(f"** {'ĐỦ ĐIỀU KIỆN (từ hai dấu hiệu)' if z.against else 'XÁC NHẬN (một dấu hiệu là đủ)'} {z.label} **")
        signals.append(p)
    elif z.against and n == 1 and "half" not in z.said:
        z.said.add("half")
        have = "hấp thụ bán" if z.abs else "phân kỳ tăng" if z.div else "M5 từ chối"
        flags.append(f"{z.label}: mới có {have}, vùng ngược XH cần thêm một dấu hiệu nữa")


def zone_step(z, zones, b, dl, tk, cv, s3, ht, flags, signals, cancels):
    """Một nến M1 đã đóng với một vùng đang `armed`. Trả True nếu nến chạm vùng."""
    sup = z.side == "S"
    ov = b["h"] >= z.lo and b["l"] <= z.hi
    m5_end = b["t"] % 300 == 240   # M1 cuối của một nến M5: giá đóng của nó là giá đóng M5
    if m5_end and (b["c"] >= z.bad if sup else b["c"] <= z.bad) and not z.bad_fired:
        z.bad_fired = True
        flags.append(f"{z.label}: SAI kịch bản (M5 đóng {'trên' if sup else 'dưới'} {z.bad:.1f}, giá đóng {b['c']:.1f})")
        if z.signalled:
            z.signalled = False
            cancels.append({"zone": z.name, "side": "SELL" if sup else "BUY", "price": round(b["c"], 2), "bad": z.bad})
    elif not z.bad_fired:
        if (b["h"] >= z.bad if sup else b["l"] <= z.bad) and "wick" not in z.said:
            z.said.add("wick")
            flags.append(f"{z.label}: râu {'lên' if sup else 'xuống'} {b['h'] if sup else b['l']:.1f} qua mức sai kịch bản {z.bad:.1f}, chờ M5 đóng (giá đóng M1 {b['c']:.1f})")
        elif m5_end:
            z.said.discard("wick")   # M5 đóng lại phía trong: lần quét sau được báo lại
    if m5_end and z.entered and not z.bad_fired and not z.rej and ((M5["h"] >= z.lo and b["c"] < z.lo) if sup else (M5["l"] <= z.hi and b["c"] > z.hi)):
        z.rej = True
        z.reasons.append(f"M5 {vn(b['t'] - 240)} râu {'lên' if sup else 'xuống'} {M5['h'] if sup else M5['l']:.1f} vào vùng, đóng {b['c']:.1f} ngoài mép {'dưới' if sup else 'trên'} vùng")
        flags.append(f"{z.label}: M5 TỪ CHỐI (râu {'lên' if sup else 'xuống'} {M5['h'] if sup else M5['l']:.1f}, M5 đóng {b['c']:.1f} ngoài mép {'dưới' if sup else 'trên'} vùng)")
        confirm(z, b, zones, flags, signals)
    if z.bad_fired or not ov:
        return ov and not z.bad_fired
    if not z.entered:
        z.entered = True
        flags.append(f"VÀO {z.label}")
    ext = b["h"] if sup else b["l"]
    if z.peak is None or (ext > z.peak if sup else ext < z.peak):
        z.peak = ext
        z.push.clear()
    if z.ref is None:
        z.ref = (ext, cv)
    elif (ext > z.ref[0]) if sup else (ext < z.ref[0]):
        gap = (z.ref[1] - cv) if sup else (cv - z.ref[1])   # > 0: CVD không theo đỉnh / đáy mới
        word = "ĐỈNH MỚI" if sup else "ĐÁY MỚI"
        if gap >= DIV_MIN:
            z.div = True
            z.reasons.append(f"phân kỳ {'giảm' if sup else 'tăng'} {ext:.1f} CVD {cv:+.0f} vs {z.ref[1]:+.0f}")
            flags.append(f"{z.label}: {word} {ext:.1f} nhưng CVD {cv:+.0f} {'thấp' if sup else 'cao'} hơn CVD trước {z.ref[1]:+.0f} (chênh {gap:.0f}) = PHÂN KỲ {'GIẢM' if sup else 'TĂNG'}")
        elif gap > 0:
            flags.append(f"{z.label}: {word.lower()} {ext:.1f}, CVD {cv:+.0f} vs {z.ref[1]:+.0f} chênh {gap:.0f} < {DIV_MIN:.0f} = nhiễu, chưa tính phân kỳ")
        else:
            flags.append(f"{z.label}: {word.lower()} {ext:.1f}, CVD {cv:+.0f} (trước {z.ref[1]:+.0f}) = không phân kỳ")
        z.ref = (ext, cv)
    if tk >= ht:
        if sup and dl > 0 and b["c"] <= b["h"] - 1.5:
            z.abs = True
            z.reasons.append(f"hấp thụ mua Δ {dl:+.0f} tick {tk:.0f} ({vn(b['t'])} VN)")
            flags.append(f"{z.label}: HẤP THỤ MUA (Δ {dl:+.0f}, tick {tk:.0f} ≥ {ht:.0f}, giá bị đẩy xuống khỏi {b['h']:.1f})")
        elif not sup and dl < 0 and b["c"] >= b["l"] + 1.5:
            z.abs = True
            z.reasons.append(f"hấp thụ bán Δ {dl:+.0f} tick {tk:.0f} ({vn(b['t'])} VN)")
            flags.append(f"{z.label}: HẤP THỤ BÁN (Δ {dl:+.0f}, tick {tk:.0f} ≥ {ht:.0f}, giá bị đẩy lên khỏi {b['l']:.1f})")
        else:
            flags.append(f"{z.label}: tick cao {tk:.0f}/phút (Δ {dl:+.0f}), giá {b['c']:.1f}")
    confirm(z, b, zones, flags, signals)
    return True


def step(zones, b, dl, tk, cv, s3, ht):
    """Xử lý một nến M1 đã đóng. Trả (cờ, đang trong vùng nào đó, tín hiệu, huỷ)."""
    flags, inside, signals, cancels = [], False, [], []
    m5_update(b)
    for z in zones:
        sup = z.side == "S"
        if z.armed:
            inside |= zone_step(z, zones, b, dl, tk, cv, s3, ht, flags, signals, cancels)
            if z.entered and z.peak is not None and not z.bad_fired:
                moved = (z.peak - b["c"]) if sup else (b["c"] - z.peak)
                for k in (5, 10):
                    if moved >= k and k not in z.push:
                        z.push.add(k)
                        flags.append(f"{z.label}: giá {'bị đẩy ngược xuống' if sup else 'bật lên'} {k}+ điểm từ {'đỉnh' if sup else 'đáy'} {z.peak:.1f} (Σ3p Δ {s3:+.0f})")
        # trạng thái armed theo giá ĐÓNG của nến này, nến sau mới dùng: nến xuyên qua vùng từ phía sai không bị tính là sai kịch bản
        approach = b["c"] < z.lo if sup else b["c"] > z.hi
        beyond = b["c"] > z.hi if sup else b["c"] < z.lo
        if approach and (not z.armed or z.bad_fired or (z.entered and 10 in z.push)):
            z.armed = True
            z.reset()   # giá quay lại phía tiếp cận sau khi xuyên qua / bị quét / đã đi 10+ điểm: lần tới vùng mới
        elif beyond:
            z.armed = False
    return flags, inside, signals, cancels


def status_line(zones, b):
    ns = min(((z.lo - b["c"], z.name) for z in zones if z.side == "S" and b["c"] < z.lo), default=None)
    nd = min(((b["c"] - z.hi, z.name) for z in zones if z.side == "D" and b["c"] > z.hi), default=None)
    return " | ".join(x for x in (f"{ns[1]} cách {ns[0]:.1f}" if ns else "", f"{nd[1]} cách {nd[0]:.1f}" if nd else "") if x)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--zones", required=True)
    ap.add_argument("--symbol", default="XAUUSDm")
    ap.add_argument("--base", default="http://localhost:8000")
    ap.add_argument("--minutes", type=float, default=29, help="thời gian theo dõi (Monitor tối đa 30 phút)")
    ap.add_argument("--replay", type=int, default=0, help="chạy lại N phút gần nhất rồi thoát")
    ap.add_argument("--bias", choices=["up", "down", "none"], help="bias trong ngày hiện tại (dòng BIAS= của analyze.py --bias-only); có thì ghi đè cờ `against` của file vùng: Supply ngược khi up, Demand ngược khi down, none = không vùng nào ngược")
    a = ap.parse_args()
    zones = load_zones(a.zones)
    if a.bias:
        for z in zones:
            z.set_against(a.bias != "none" and (z.side == "S") == (a.bias == "up"))
    end = time.time() + a.minutes * 60
    start = session_start(time.time())
    n_bars = max(1500, a.replay + 400)
    m1 = [b for b in get(a.base, a.symbol, "M1", n_bars) if b["t"] >= start]
    td = get(a.base, a.symbol, "TD", n_bars)
    now_min = int(time.time() // 60) * 60
    cut = now_min - a.replay * 60 if a.replay else now_min   # nến từ `cut` trở đi mới được xử lý, trước đó chỉ làm mốc
    cum = cum_map(td, start)
    hist = [b for b in m1 if b["t"] < cut]
    if not hist:
        print("!! chưa có nến phiên trước mốc theo dõi", flush=True)
        return
    hb, lb = max(hist, key=lambda b: b["h"]), min(hist, key=lambda b: b["l"])
    last = hist[-1]
    for z in zones:
        if z.side == "S" and z.lo - 0.3 <= hb["h"] <= z.hi:
            z.ref = (hb["h"], cum.get(hb["t"], 0))
        if z.side == "D" and z.lo <= lb["l"] <= z.hi + 0.3:
            z.ref = (lb["l"], cum.get(lb["t"], 0))
        z.armed = last["c"] <= z.hi if z.side == "S" else last["c"] >= z.lo   # vùng nằm sai phía giá chưa tính cho tới khi giá quay lại phía tiếp cận
    done = {b["t"] for b in hist}
    print(f"bắt đầu {'REPLAY ' if a.replay else 'theo dõi '}từ {vn(cut)} VN | giá {last['c']:.1f} | đỉnh phiên {hb['h']:.1f} (CVD {cum.get(hb['t'], 0):+.0f}) | "
          f"đáy phiên {lb['l']:.1f} (CVD {cum.get(lb['t'], 0):+.0f}) | " + (f"bias trong ngày {a.bias} | " if a.bias else "") + "; ".join(z.label for z in zones), flush=True)
    deltas, fails = [], 0
    while True:
        try:
            if not a.replay:
                m1 = get(a.base, a.symbol, "M1", 40)
                td = get(a.base, a.symbol, "TD", 1500)
                cum = cum_map(td, start)
            fails = 0
        except Exception as e:  # noqa: BLE001
            fails += 1
            if fails in (1, 6):
                print(f"!! lỗi đọc backend: {e}", flush=True)
            time.sleep(10)
            continue
        tdm = {b["t"]: b for b in td}
        ticks = [b["v"] for b in td[-90:]]
        ht = max(MIN_TICK, 2 * statistics.median(ticks)) if ticks else MIN_TICK
        now_min = int(time.time() // 60) * 60
        for b in sorted(m1, key=lambda b: b["t"]):
            t = b["t"]
            if t >= now_min or t in done:
                continue
            done.add(t)
            d = tdm.get(t)
            dl, tk, cv = (d["c"] if d else 0), (d["v"] if d else 0), cum.get(t, 0)
            deltas.append(dl)
            s3 = sum(deltas[-3:])
            line = (f"{vn(t)} VN | {b['o']:.1f}→{b['c']:.1f} (L {b['l']:.1f} H {b['h']:.1f}) | Δ {dl:+.0f} | tick {tk:.0f} | Σ3p {s3:+.0f} | CVD phiên {cv:+.0f}")
            flags, inside, signals, cancels = step(zones, b, dl, tk, cv, s3, ht)
            if flags:
                print("!! " + line + "  <<< " + " | ".join(flags), flush=True)
            elif inside:
                print("   " + line + "  [trong vùng]", flush=True)
            elif (t // 60) % 5 == 4:
                print(f"·  {line} | {status_line(zones, b)}", flush=True)
            for s in signals:
                print(">>> TÍN HIỆU " + json.dumps(s, ensure_ascii=False), flush=True)
            for c in cancels:
                print(">>> HUỶ " + json.dumps(c, ensure_ascii=False), flush=True)
        if a.replay or time.time() >= end:
            break
        time.sleep(10)
    print(f"hết {'replay' if a.replay else f'thời gian theo dõi ({a.minutes:g} phút)'}", flush=True)


if __name__ == "__main__":
    main()
