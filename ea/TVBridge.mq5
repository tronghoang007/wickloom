//+------------------------------------------------------------------+
//| TVBridge.mq5 - đẩy symbol/tick/bar sang backend qua TCP socket   |
//| VERSION: 2.09 (xem EA_VERSION bên dưới - in ra Experts log lúc   |
//| EnsureConnected() để biết bản đang chạy có phải bản mới nhất)    |
//| - 2.00: chuyển từ WebRequest sang TCP socket                     |
//| - 2.01: fix SendLine coi SocketSend=0 (buffer đầy) là lỗi fatal  |
//| - 2.02: fix EnsureConnected tự đóng socket sống do               |
//|   SocketIsConnected() báo sai (gây reconnect loop mỗi ~2s);      |
//|   PumpRx phát hiện đúng EOF; thông báo rõ lỗi 5272               |
//| - 2.03: VẪN còn reconnect loop sau 2.02 -> thêm log chẩn đoán ở  |
//|   từng chỗ gọi CloseSocket() (SendLine lỗi/timeout, PumpRx EOF)  |
//| - 2.04: log xác nhận nguyên nhân = PumpRx tự đóng socket do đọc |
//|   lỗi tạm thời (GetLastError 5273) ngay sau connect, KHÔNG phải |
//|   server đóng - bỏ việc tự CloseSocket() khi đọc lỗi, chỉ coi    |
//|   kết nối chết thật khi SendLine gửi thất bại (-1)               |
//| - 2.05: nguyên nhân THẬT của 5273 = SocketRead(…, 4096, 10) chờ   |
//|   đủ 4096 byte -> timeout. Đọc đúng SocketIsReadable() byte; lỗi |
//|   đọc thật thì đóng + reconnect; ping 5s để phát hiện socket chết |
//| - 2.06: JsonInt bỏ qua space sau ':' (json.dumps mặc định có     |
//|   space -> count/pos/before bị đọc ra 0, backfill trả 0 bar)     |
//| - 2.07: Backfill thử lại CopyRates ~3s khi lịch sử cũ chưa dựng  |
//|   xong (trước đây coi -1 là hết dữ liệu -> dừng ở 2020 dù MT5 có |
//|   từ 2014); log mã lỗi + SERIES_TERMINAL/SERVER_FIRSTDATE        |
//| - 2.08: backfill `before` neo theo iBarShift + index thay vì cửa  |
//|   sổ thời gian cố định (M1 rơi vào gap lễ dài -> 0 bar, dừng sớm) |
//|   subscribe symbol mới chỉ stream tick từ hiện tại (msc=0 làm    |
//|   CopyTicks trả cả lịch sử tick -> backend treo, ghi đè bar)     |
//| - 2.09: hello gửi thêm ACCOUNT_SERVER (backend nhận diện nguồn    |
//|   theo server); bị server từ chối thì chờ 30s mới kết nối lại     |
//| Nếu SocketConnect báo lỗi: Tools > Options > Expert Advisors >   |
//| "Allow WebRequest for listed URL" - thêm ServerHost:ServerPort   |
//| (MT5 áp whitelist này cho cả Socket*, không chỉ WebRequest)      |
//+------------------------------------------------------------------+
#property strict
#property version "2.09"

#define EA_VERSION "2.09"

input string ServerHost = "127.0.0.1";
input int ServerPort = 8001;
input string Token = "dev-token";
input int TimerMs = 300;
input int BackfillChunk = 5000;
input int MaxTicksPerCall = 2000;

int g_sock = INVALID_HANDLE;
string g_rx = "";
ulong g_lastConnectTryMs = 0;
ulong g_lastPingMs = 0;
ulong g_backoffUntilMs = 0; // server tu choi (token sai / dang nhan EA khac) -> cho lau hon

string g_subs[];
ulong g_lastMsc[];

//--- helpers ------------------------------------------------------
int BrokerOffset() { return (int)(TimeTradeServer() - TimeGMT()); }

string Esc(string s)
{
  StringReplace(s, "\\", "\\\\");
  StringReplace(s, "\"", "\\\"");
  return s;
}

//--- socket layer ---------------------------------------------------
void CloseSocket()
{
  if (g_sock != INVALID_HANDLE)
  {
    SocketClose(g_sock);
    g_sock = INVALID_HANDLE;
  }
  g_rx = "";
}

bool SendLine(string json)
{
  if (g_sock == INVALID_HANDLE)
    return false;
  string line = json + "\n";
  uchar data[];
  int n = StringToCharArray(line, data, 0, WHOLE_ARRAY, CP_UTF8);
  ArrayResize(data, n - 1); // bỏ ký tự null cuối StringToCharArray tự thêm
  int total = ArraySize(data);
  int sent = 0;
  int stalls = 0;
  while (sent < total)
  {
    uchar chunk[];
    ArrayCopy(chunk, data, 0, sent, total - sent);
    int n2 = SocketSend(g_sock, chunk, ArraySize(chunk));
    if (n2 < 0)
    {
      PrintFormat("TVBridge: [SendLine] SocketSend loi %d (da gui %d/%d byte), dong socket de reconnect", GetLastError(), sent, total);
      CloseSocket();
      return false;
    }
    if (n2 == 0)
    {
      // Socket non-blocking: buffer gui dang day, KHONG phai loi - doi ngan roi thu lai.
      // Chi coi la chet thuc su neu stall qua lau (~1s).
      if (++stalls > 200)
      {
        PrintFormat("TVBridge: [SendLine] timeout (buffer day qua lau, da gui %d/%d byte), dong socket de reconnect", sent, total);
        CloseSocket();
        return false;
      }
      Sleep(5);
      continue;
    }
    stalls = 0;
    sent += n2;
  }
  return true;
}

bool EnsureConnected()
{
  // Coi socket la con song cho den khi SendLine/PumpRx bao loi THAT (gui -1, hoac EOF
  // luc doc) - KHONG dung SocketIsConnected() de poll moi tick, ham nay co the bao false
  // du socket van on, khien code tu dong+reconnect lien tuc (bug da gap: log in "da ket
  // noi" lap lai dung moi 2s = dung gia tri throttle ben duoi).
  if (g_sock != INVALID_HANDLE)
    return true;
  ulong now = GetTickCount64();
  if (now - g_lastConnectTryMs < 2000 || now < g_backoffUntilMs) // throttle reconnect, tránh spam
    return false;
  g_lastConnectTryMs = now;

  g_sock = SocketCreate();
  if (g_sock == INVALID_HANDLE)
    return false;
  if (!SocketConnect(g_sock, ServerHost, (uint)ServerPort, 5000))
  {
    int err = GetLastError();
    string why = (err == 5272)
      ? "chua co gi dang lang nghe o " + ServerHost + ":" + IntegerToString(ServerPort) + ", hoac ket noi bi tu choi (backend chua chay? sai port? chua whitelist?)"
      : "ma loi " + IntegerToString(err) + " (da whitelist Tools>Options>Expert Advisors chua?)";
    PrintFormat("TVBridge: SocketConnect %s:%d loi - %s", ServerHost, ServerPort, why);
    CloseSocket();
    return false;
  }

  // server = nguon du lieu (backend resync khi doi server; cung server khac login thi giu cache)
  string hello = "{\"type\":\"hello\",\"token\":\"" + Esc(Token) + "\",\"broker\":\"" + Esc(AccountInfoString(ACCOUNT_COMPANY)) + "\",\"server\":\"" + Esc(AccountInfoString(ACCOUNT_SERVER)) + "\"}";
  if (!SendLine(hello))
    return false;
  PostSymbols(); // luôn gửi lại symbols mỗi lần (re)connect - không chờ server hỏi need_symbols
  PrintFormat("TVBridge v%s: da ket noi %s:%d", EA_VERSION, ServerHost, ServerPort);
  return true;
}

string SymbolType(string s)
{
  string path = SymbolInfoString(s, SYMBOL_PATH);
  StringToLower(path);
  if (StringFind(path, "forex") >= 0)
    return "forex";
  if (StringFind(path, "metal") >= 0 || StringFind(s, "XAU") == 0 || StringFind(s, "XAG") == 0)
    return "metal";
  if (StringFind(path, "index") >= 0 || StringFind(path, "indices") >= 0)
    return "index";
  if (StringFind(path, "crypto") >= 0)
    return "crypto";
  if (StringFind(path, "stock") >= 0 || StringFind(path, "share") >= 0)
    return "stocks";
  return "other";
}

void PostSymbols()
{
  string broker = AccountInfoString(ACCOUNT_COMPANY);
  string js = "{\"type\":\"symbols\",\"broker_utc_offset\":" + IntegerToString(BrokerOffset()) + ",\"symbols\":[";
  int total = SymbolsTotal(false);
  for (int i = 0; i < total; i++)
  {
    string s = SymbolName(i, false);
    if (i > 0)
      js += ",";
    js += "{\"name\":\"" + Esc(s) + "\",\"digits\":" + IntegerToString((int)SymbolInfoInteger(s, SYMBOL_DIGITS)) + ",\"tick_size\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE), 10) + ",\"type\":\"" + SymbolType(s) + "\",\"description\":\"" + Esc(SymbolInfoString(s, SYMBOL_DESCRIPTION)) + "\",\"broker\":\"" + Esc(broker) + "\"}";
  }
  js += "]}";
  SendLine(js);
}

//--- JSON parse tối giản --------------------------------------------
string JsonStr(string obj, string key)
{
  int p = StringFind(obj, "\"" + key + "\"");
  if (p < 0)
    return "";
  p = StringFind(obj, ":", p);
  int q1 = StringFind(obj, "\"", p);
  int q2 = StringFind(obj, "\"", q1 + 1);
  if (q1 < 0 || q2 < 0)
    return "";
  return StringSubstr(obj, q1 + 1, q2 - q1 - 1);
}

long JsonInt(string obj, string key)
{
  int p = StringFind(obj, "\"" + key + "\"");
  if (p < 0)
    return 0;
  p = StringFind(obj, ":", p) + 1;
  while (p < StringLen(obj) && StringGetCharacter(obj, p) == ' ') // json.dumps mac dinh co space sau ':'
    p++;
  int e = p;
  while (e < StringLen(obj))
  {
    ushort ch = StringGetCharacter(obj, e);
    if ((ch < '0' || ch > '9') && ch != '-')
      break;
    e++;
  }
  return StringToInteger(StringSubstr(obj, p, e - p));
}

string JsonArray(string js, string key)
{
  int p = StringFind(js, "\"" + key + "\"");
  if (p < 0)
    return "";
  int s = StringFind(js, "[", p);
  int depth = 0;
  for (int i = s; i < StringLen(js); i++)
  {
    ushort ch = StringGetCharacter(js, i);
    if (ch == '[')
      depth++;
    if (ch == ']')
    {
      depth--;
      if (depth == 0)
        return StringSubstr(js, s + 1, i - s - 1);
    }
  }
  return "";
}

ENUM_TIMEFRAMES ParseTf(string tf)
{
  if (tf == "M1")
    return PERIOD_M1;
  if (tf == "M2")
    return PERIOD_M2;
  if (tf == "M3")
    return PERIOD_M3;
  if (tf == "M4")
    return PERIOD_M4;
  if (tf == "M5")
    return PERIOD_M5;
  if (tf == "M6")
    return PERIOD_M6;
  if (tf == "M10")
    return PERIOD_M10;
  if (tf == "M12")
    return PERIOD_M12;
  if (tf == "M15")
    return PERIOD_M15;
  if (tf == "M20")
    return PERIOD_M20;
  if (tf == "M30")
    return PERIOD_M30;
  if (tf == "H1")
    return PERIOD_H1;
  if (tf == "H2")
    return PERIOD_H2;
  if (tf == "H3")
    return PERIOD_H3;
  if (tf == "H4")
    return PERIOD_H4;
  if (tf == "H6")
    return PERIOD_H6;
  if (tf == "H8")
    return PERIOD_H8;
  if (tf == "H12")
    return PERIOD_H12;
  if (tf == "D1")
    return PERIOD_D1;
  if (tf == "W1")
    return PERIOD_W1;
  if (tf == "MN1")
    return PERIOD_MN1;
  return PERIOD_CURRENT;
}

//--- subscribe / ticks ----------------------------------------------
int SubIndex(string s)
{
  for (int i = 0; i < ArraySize(g_subs); i++)
    if (g_subs[i] == s)
      return i;
  return -1;
}

void ApplySubscribe(string arr)
{
  string next[];
  string parts[];
  int n = StringSplit(arr, ',', parts);
  for (int i = 0; i < n; i++)
  {
    string s = parts[i];
    StringReplace(s, "\"", "");
    StringTrimLeft(s);
    StringTrimRight(s);
    if (s == "")
      continue;
    ArrayResize(next, ArraySize(next) + 1);
    next[ArraySize(next) - 1] = s;
  }
  ulong msc[];
  ArrayResize(msc, ArraySize(next));
  for (int i = 0; i < ArraySize(next); i++)
  {
    int k = SubIndex(next[i]);
    if (k >= 0)
      msc[i] = g_lastMsc[k];
    else
    {
      SymbolSelect(next[i], true);
      // Chi stream tick tu bay gio: msc=0 -> CopyTicks(from=1) tra tu DAU lich su tick
      // (hang nam) 2000 tick/lan, backend gom thanh nen va ghi de bar chuan cua MT5.
      MqlTick cur;
      msc[i] = SymbolInfoTick(next[i], cur) ? (ulong)cur.time_msc : 0;
    }
  }
  ArrayCopy(g_subs, next);
  ArrayResize(g_subs, ArraySize(next));
  ArrayCopy(g_lastMsc, msc);
  ArrayResize(g_lastMsc, ArraySize(msc));
}

void PumpTicks()
{
  for (int i = 0; i < ArraySize(g_subs); i++)
  {
    MqlTick ticks[];
    int n = CopyTicks(g_subs[i], ticks, COPY_TICKS_ALL, g_lastMsc[i] + 1, MaxTicksPerCall);
    if (n <= 0)
    {
      MqlTick cur;
      if (SymbolInfoTick(g_subs[i], cur) && cur.time_msc > g_lastMsc[i])
      {
        ArrayResize(ticks, 1);
        ticks[0] = cur;
        n = 1;
      }
    }
    if (n <= 0)
      continue;
    string js = "{\"type\":\"ticks\",\"broker_utc_offset\":" + IntegerToString(BrokerOffset()) + ",\"symbol\":\"" + Esc(g_subs[i]) + "\",\"ticks\":[";
    for (int k = 0; k < n; k++)
    {
      if (k > 0)
        js += ",";
      js += "{\"t_msc\":" + IntegerToString(ticks[k].time_msc) + ",\"bid\":" + DoubleToString(ticks[k].bid, 8) + ",\"ask\":" + DoubleToString(ticks[k].ask, 8) + ",\"last\":" + DoubleToString(ticks[k].last, 8) + ",\"vol\":" + IntegerToString((long)ticks[k].volume) + "}";
    }
    js += "]}";
    if (SendLine(js))
      g_lastMsc[i] = ticks[n - 1].time_msc;
  }
}

//--- backfill (pos = lùi theo index nến; before = epoch UTC, lùi theo thời gian) ----
void Backfill(string symbol, string tfs, int count, int start_pos = 0, long before = 0)
{
  ENUM_TIMEFRAMES tf = ParseTf(tfs);
  if (tf == PERIOD_CURRENT)
    return;
  SymbolSelect(symbol, true);
  int offset = BrokerOffset();
  int pos = start_pos, total = 0;
  datetime cursor_utc = (datetime)before; // chỉ dùng khi before > 0, giảm dần mỗi chunk
  while (total < count)
  {
    int want = MathMin(BackfillChunk, count - total);
    MqlRates rates[];
    int n = 0, err = 0;
    datetime stop_t = (datetime)((long)cursor_utc + offset);
    // Lich su cu chua dung xong cho tf nay -> CopyRates/iBarShift tra -1 (vd 4401) va
    // terminal tai ngam; thu lai ~3s thay vi coi nhu het du lieu.
    for (int attempt = 0; attempt < 10; attempt++)
    {
      ResetLastError();
      if (before > 0)
      {
        // Neo theo index cua nen gan nhat <= stop_t (khong theo cua so thoi gian co dinh:
        // cua so roi tron vao 1 gap le/cuoi tuan dai thi tra 0 bar du phia truoc van con).
        int shift = iBarShift(symbol, tf, stop_t, false);
        n = (shift < 0) ? -1 : CopyRates(symbol, tf, shift, want, rates);
      }
      else
        n = CopyRates(symbol, tf, pos, want, rates);
      if (n > 0)
        break;
      err = GetLastError();
      Sleep(300);
    }
    if (n <= 0)
    {
      PrintFormat("Backfill %s %s: CopyRates khong co bar (loi %d, firstdate terminal %s, server %s)", symbol, tfs, err,
                  TimeToString((datetime)SeriesInfoInteger(symbol, tf, SERIES_TERMINAL_FIRSTDATE)),
                  TimeToString((datetime)SeriesInfoInteger(symbol, tf, SERIES_SERVER_FIRSTDATE)));
      break;
    }

    string js = "{\"type\":\"bars\",\"broker_utc_offset\":" + IntegerToString(offset) + ",\"symbol\":\"" + Esc(symbol) + "\",\"tf\":\"" + tfs + "\",\"bars\":[";
    for (int i = 0; i < n; i++)
    {
      if (i > 0)
        js += ",";
      js += "{\"t\":" + IntegerToString((long)rates[i].time - offset) + ",\"o\":" + DoubleToString(rates[i].open, 8) + ",\"h\":" + DoubleToString(rates[i].high, 8) + ",\"l\":" + DoubleToString(rates[i].low, 8) + ",\"c\":" + DoubleToString(rates[i].close, 8) + ",\"v\":" + IntegerToString((long)rates[i].tick_volume) + "}";
    }
    bool last = (n < want) || (total + n >= count);
    js += "],\"done\":" + (last ? "true" : "false") + "}";
    if (!SendLine(js))
      break;

    total += n;
    if (before > 0)
      cursor_utc = (datetime)((long)rates[0].time - offset - 1); // nến cũ nhất trong batch, lùi 1s cho chunk sau
    else
      pos += n;
    if (n < want)
      break;
  }
  PrintFormat("Backfill %s %s: %d bar (pos %d, before %s)", symbol, tfs, total, start_pos, IntegerToString(before));
}

//--- nhận lệnh từ backend ---------------------------------------------
void HandleCommand(string line)
{
  string type = JsonStr(line, "type");
  if (type == "need_symbols")
    PostSymbols();
  else if (type == "subscribe")
    ApplySubscribe(JsonArray(line, "symbols"));
  else if (type == "backfill")
  {
    string sym = JsonStr(line, "symbol");
    string tf = JsonStr(line, "tf");
    int count = (int)JsonInt(line, "count");
    int pos = (int)JsonInt(line, "pos");
    long before = JsonInt(line, "before");
    Backfill(sym, tf, count, pos, before);
  }
  else if (type == "error")
  {
    PrintFormat("TVBridge: server bao loi: %s (thu lai sau 30s)", JsonStr(line, "message"));
    CloseSocket(); // token sai / backend đang nhận EA của server khác - đóng, không retry mỗi 2s
    g_backoffUntilMs = GetTickCount64() + 30000;
  }
}

void PumpRx()
{
  if (g_sock == INVALID_HANDLE)
    return;
  uint avail;
  while ((avail = SocketIsReadable(g_sock)) > 0)
  {
    // Doc DUNG so byte dang co: SocketRead cho du `maxlen` byte toi khi het timeout roi
    // bao loi 5273 (nguyen nhan that cua loi "doc ngay sau connect" o 2.03/2.04).
    uchar buf[];
    int n = SocketRead(g_sock, buf, avail, 500);
    if (n <= 0)
    {
      PrintFormat("TVBridge: [PumpRx] SocketRead loi %d (co %u byte), dong socket de reconnect", GetLastError(), avail);
      CloseSocket();
      return;
    }
    g_rx += CharArrayToString(buf, 0, n, CP_UTF8);
  }
  while (true)
  {
    int p = StringFind(g_rx, "\n");
    if (p < 0)
      break;
    string line = StringSubstr(g_rx, 0, p);
    g_rx = StringSubstr(g_rx, p + 1);
    StringTrimLeft(line);
    StringTrimRight(line);
    if (line != "")
      HandleCommand(line);
  }
}

//--- events ---------------------------------------------------------
int OnInit()
{
  EventSetMillisecondTimer(TimerMs);
  EnsureConnected();
  return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
  EventKillTimer();
  CloseSocket();
}

void OnTimer()
{
  if (!EnsureConnected())
    return;
  PumpRx();
  PumpTicks();
  // Heartbeat: chua subscribe symbol nao thi khong co gi de gui -> khong bao gio phat
  // hien socket da chet. Ping dinh ky de SendLine that bai -> tu reconnect.
  ulong now = GetTickCount64();
  if (g_sock != INVALID_HANDLE && now - g_lastPingMs >= 5000)
  {
    g_lastPingMs = now;
    SendLine("{\"type\":\"ping\"}");
  }
}
