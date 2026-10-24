//+------------------------------------------------------------------+
//| TVBridge.mq5 - đẩy symbol/tick/bar sang backend qua TCP socket   |
//| VERSION: 2.11 (xem EA_VERSION bên dưới - in ra Experts log lúc   |
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
//| - 2.10: hello gửi thêm login/name/mode (demo|real|contest)/      |
//|   currency/leverage và thông điệp "account" (balance/equity/     |
//|   margin_free/profit) mỗi 5s - web hiện Trading accounts +       |
//|   huy hiệu Demo/Real. Backend cũ bỏ qua các trường/thông điệp này|
//| - 2.11: CHỈ ĐỌC trạng thái giao dịch (docs/trade-plan.md T1):    |
//|   "trade" (vị thế + lệnh chờ, gửi khi đổi / mỗi 1-5s),           |
//|   "deals" (lịch sử khớp lệnh DealsDays ngày, tối đa MaxDeals),   |
//|   "account" thêm margin/margin_level/margin_mode/trade_allowed.  |
//|   KHÔNG có code gửi/sửa/đóng lệnh trong EA                       |
//| - 2.12: GIAO DỊCH từ web (docs/trade-plan.md T2): "order_send"   |
//|   (Buy/Sell market + SL/TP) và "position_close" (đóng/đóng một   |
//|   phần), trả "trade_result". MẶC ĐỊNH TẮT (TradingEnabled=false);|
//|   account không phải demo bị từ chối trừ khi AllowRealAccount.   |
//|   Luôn OrderCheck trước OrderSend. "symbols" thêm volume_min/    |
//|   max/step, contract_size, stops_level, freeze_level; "account"  |
//|   thêm ea_trading/max_lot/ea_version                             |
//| - 2.13: LỆNH CHỜ (docs/trade-plan.md T3): "order_pending" (web    |
//|   gửi hướng + giá vào, EA tự quyết Limit/Stop theo Ask/Bid lúc    |
//|   thực thi; account không phải demo mà loại lệnh khác expected_   |
//|   type thì từ chối), "order_modify" (đổi giá/SL/TP/hết hạn, không |
//|   đổi loại), "order_delete". Kiểm tra stops level. Thời gian      |
//|   time/time_setup/expiration gửi lên là UTC (trước đây giờ server)|
//| - 2.14: "symbols" thêm tick_value / tick_value_loss (giá trị một   |
//|   tick theo tiền account, để web tính lãi/lỗi dự kiến của SL/TP);  |
//|   "position_modify" (đổi SL/TP của vị thế đang mở, kéo trên chart) |
//| - 2.15: "calendar": doc lich kinh te CO SAN cua MT5 (CalendarValue-  |
//|   History: su kien, quoc gia/tien te, muc quan trong, thuc te/du   |
//|   bao/ky truoc) gui len backend moi CalendarRefreshSec giay, ca    |
//|   cua so [CalendarDaysBack, CalendarDaysAhead] ngay - web ve bang   |
//|   lich + bieu tuong su kien tren chart, khong phu thuoc mang ngoai  |
//|   (docs/calendar-plan.md). Tat bang SendCalendar=false              |
//| - 2.16: lenh "backfill" voi tf "TD" = lich su TICK cho CVD "1 tick" |
//|   cua web (docs/indicators-plan.md): doc CopyTicksRange cua `count` |
//|   nen M1 ket thuc o phut chua `before` (cat o gio hien tai), gui    |
//|   "ticks_hist" (mang gia/trong so tung tick, cat o ranh gioi phut, |
//|   toi da TickHistChunk tick moi thong diep) - backend tu phan loai  |
//|   len/xuong va luu delta tung phut. Bang khung nen: gia = Bid neu   |
//|   chart theo Bid, Last (trong so = volume) neu chart theo Last      |
//| - 2.17: "ticks" truc tiep gui them co tick ("f", ENUM_TICK_FLAG) va  |
//|   "lm":1 neu nen theo Last - backend tu phan loai tick realtime cho |
//|   CVD / Big Trades theo CUNG quy tac voi lich su tick (chi tick doi  |
//|   Bid, hoac tick giao dich neu theo Last), khong con phai cho EA     |
//|   tinh lai moi 15 giay                                              |
//| Nếu SocketConnect báo lỗi: Tools > Options > Expert Advisors >   |
//| "Allow WebRequest for listed URL" - thêm ServerHost:ServerPort   |
//| (MT5 áp whitelist này cho cả Socket*, không chỉ WebRequest)      |
//+------------------------------------------------------------------+
#property strict
#property version "2.17"

#define EA_VERSION "2.17"

input string ServerHost = "127.0.0.1";
input int ServerPort = 8001;
input string Token = "dev-token";
input int TimerMs = 300;
input int BackfillChunk = 5000;
input int MaxTicksPerCall = 2000;
input int TickHistChunk = 20000; // so tick toi da trong mot thong diep "ticks_hist" (lich su tick cho CVD 1 tick)
input int DealsDays = 30;  // lich su deal gui len web (chi doc)
input int MaxDeals = 200;

input group "Giao dich tu web (mac dinh TAT)"
input bool TradingEnabled = false;   // cho phep web dat/dong lenh qua EA nay
input bool AllowRealAccount = false; // khoa them: account KHONG phai demo chi duoc giao dich khi bat cai nay
input int MagicNumber = 20261022;    // magic cua lenh do app dat (phan biet voi lenh tay / EA khac)
input double MaxLotPerOrder = 1.0;   // EA tu choi lenh lon hon, ke ca khi web gui sai
input int Deviation = 100;           // truot gia toi da (diem) cho lenh market

input group "Lich kinh te (doc tu lich co san cua MT5)"
input bool SendCalendar = true;      // gui lich kinh te cua MT5 len web
input int CalendarDaysBack = 1;      // lay tu may ngay truoc (web chi ve lich sap toi; giu 1 ngay de backend nhan ra su kien bi huy/doi)
input int CalendarDaysAhead = 14;    // toi may ngay sau
input int CalendarRefreshSec = 300;  // lam moi dinh ky (so thuc te / du bao thay doi moi khi co cong bo)

int g_sock = INVALID_HANDLE;
string g_rx = "";
ulong g_lastConnectTryMs = 0;
ulong g_lastPingMs = 0;
ulong g_backoffUntilMs = 0; // server tu choi (token sai / dang nhan EA khac) -> cho lau hon

string g_lastTradeSig = ""; // chu ky cau truc cua vi the/lenh cho: doi -> gui ngay
ulong g_lastTradeMs = 0;
bool g_dealsDirty = true;
ulong g_lastDealsMs = 0;
ulong g_lastCalendarMs = 0;
bool g_calendarOk = false;      // da gui duoc it nhat mot lan: tu do lam moi theo CalendarRefreshSec (chua duoc thi thu lai moi 30s)
bool g_calendarWarned = false;  // chi log loi lich mot lan cho den khi gui duoc
bool g_calendarLogged = false;
long g_calCountryId[];          // cache quoc gia (id -> ma nuoc / tien te) de khong goi CalendarCountryById cho tung su kien
string g_calCountryCode[];
string g_calCountryCur[];

string g_subs[];
ulong g_lastMsc[];

//--- helpers ------------------------------------------------------
int BrokerOffset() { return (int)(TimeTradeServer() - TimeGMT()); }
// Gio server cua MT5 -> epoch UTC (0 = khong co: giu 0). Web hien moi thoi gian nhu UTC, giong cach nen da gui (rates.time - offset)
long ToUtc(long serverTime) { return serverTime > 0 ? serverTime - BrokerOffset() : 0; }

string Esc(string s)
{
  StringReplace(s, "\\", "\\\\");
  StringReplace(s, "\"", "\\\"");
  StringReplace(s, "\r", " ");  // comment cua lenh co the chua xuong dong/tab -> JSON hong
  StringReplace(s, "\n", " ");
  StringReplace(s, "\t", " ");
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
  string hello = "{\"type\":\"hello\",\"token\":\"" + Esc(Token) + "\",\"broker\":\"" + Esc(AccountInfoString(ACCOUNT_COMPANY)) + "\",\"server\":\"" + Esc(AccountInfoString(ACCOUNT_SERVER)) + "\""
               + ",\"login\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LOGIN))
               + ",\"name\":\"" + Esc(AccountInfoString(ACCOUNT_NAME)) + "\""
               + ",\"mode\":\"" + AccountMode() + "\""
               + ",\"currency\":\"" + Esc(AccountInfoString(ACCOUNT_CURRENCY)) + "\""
               + ",\"leverage\":" + IntegerToString((long)AccountInfoInteger(ACCOUNT_LEVERAGE)) + "}";
  if (!SendLine(hello))
    return false;
  PostAccount();
  g_lastTradeSig = ""; // vừa (re)connect: gửi ngay vị thế/lệnh/deal ở OnTimer kế tiếp
  g_dealsDirty = true;
  g_lastDealsMs = 0;
  g_lastCalendarMs = 0; // gui lich ngay o OnTimer ke tiep
  PostSymbols(); // luôn gửi lại symbols mỗi lần (re)connect - không chờ server hỏi need_symbols
  PrintFormat("TVBridge v%s: da ket noi %s:%d", EA_VERSION, ServerHost, ServerPort);
  return true;
}

// demo / real / contest (cuộc thi) - web đánh dấu REAL màu đỏ để không nhầm với demo
string AccountMode()
{
  switch ((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE))
  {
    case ACCOUNT_TRADE_MODE_DEMO:
      return "demo";
    case ACCOUNT_TRADE_MODE_REAL:
      return "real";
    case ACCOUNT_TRADE_MODE_CONTEST:
      return "contest";
  }
  return "";
}

string MarginMode()
{
  switch ((ENUM_ACCOUNT_MARGIN_MODE)AccountInfoInteger(ACCOUNT_MARGIN_MODE))
  {
    case ACCOUNT_MARGIN_MODE_RETAIL_NETTING:
      return "netting";
    case ACCOUNT_MARGIN_MODE_RETAIL_HEDGING:
      return "hedging";
    case ACCOUNT_MARGIN_MODE_EXCHANGE:
      return "exchange";
  }
  return "";
}

string JsonBool(bool v) { return v ? "true" : "false"; }

// Số dư account (chỉ đọc) - backend giữ bản mới nhất để web hiện trong dropdown avatar + panel Trading
void PostAccount()
{
  string js = "{\"type\":\"account\",\"balance\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2)
            + ",\"equity\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2)
            + ",\"margin\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN), 2)
            + ",\"margin_free\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_FREE), 2)
            + ",\"margin_level\":" + DoubleToString(AccountInfoDouble(ACCOUNT_MARGIN_LEVEL), 2)
            + ",\"profit\":" + DoubleToString(AccountInfoDouble(ACCOUNT_PROFIT), 2)
            + ",\"margin_mode\":\"" + MarginMode() + "\""
            + ",\"trade_allowed\":" + JsonBool(AccountInfoInteger(ACCOUNT_TRADE_ALLOWED) != 0)
            + ",\"terminal_trade_allowed\":" + JsonBool(TerminalInfoInteger(TERMINAL_TRADE_ALLOWED) != 0)
            + ",\"ea_trading\":" + JsonBool(TradingEnabled)
            + ",\"max_lot\":" + DoubleToString(MaxLotPerOrder, 2)
            + ",\"ea_version\":\"" + EA_VERSION + "\"}";
  SendLine(js);
}

//--- trang thai giao dich (CHI DOC: khong co code gui/sua/dong lenh) ---------
int PriceDigits(string sym)
{
  return (int)SymbolInfoInteger(sym, SYMBOL_DIGITS);
}

// Vi the dang mo; `sig` = chu ky cau truc (ticket/volume/sl/tp) de biet khi nao phai gui ngay
string PositionsJson(string &sig)
{
  string js = "[";
  int n = PositionsTotal();
  for (int i = 0; i < n; i++)
  {
    ulong tk = PositionGetTicket(i); // chon vi the thu i
    if (tk == 0)
      continue;
    string sym = PositionGetString(POSITION_SYMBOL);
    int dg = PriceDigits(sym);
    double vol = PositionGetDouble(POSITION_VOLUME);
    double sl = PositionGetDouble(POSITION_SL);
    double tp = PositionGetDouble(POSITION_TP);
    if (js != "[")
      js += ",";
    js += "{\"ticket\":" + IntegerToString((long)tk) + ",\"symbol\":\"" + Esc(sym) + "\""
        + ",\"type\":\"" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "buy" : "sell") + "\""
        + ",\"volume\":" + DoubleToString(vol, 8)
        + ",\"price_open\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), dg)
        + ",\"sl\":" + DoubleToString(sl, dg) + ",\"tp\":" + DoubleToString(tp, dg)
        + ",\"price_current\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_CURRENT), dg)
        + ",\"profit\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2)
        + ",\"swap\":" + DoubleToString(PositionGetDouble(POSITION_SWAP), 2)
        + ",\"time\":" + IntegerToString(ToUtc(PositionGetInteger(POSITION_TIME)))
        + ",\"magic\":" + IntegerToString((long)PositionGetInteger(POSITION_MAGIC))
        + ",\"comment\":\"" + Esc(PositionGetString(POSITION_COMMENT)) + "\"}";
    sig += IntegerToString((long)tk) + ":" + DoubleToString(vol, 8) + ":" + DoubleToString(sl, dg) + ":" + DoubleToString(tp, dg) + ";";
  }
  return js + "]";
}

string OrderTypeStr(long t)
{
  switch ((int)t)
  {
    case ORDER_TYPE_BUY_LIMIT:
      return "buy_limit";
    case ORDER_TYPE_SELL_LIMIT:
      return "sell_limit";
    case ORDER_TYPE_BUY_STOP:
      return "buy_stop";
    case ORDER_TYPE_SELL_STOP:
      return "sell_stop";
    case ORDER_TYPE_BUY_STOP_LIMIT:
      return "buy_stop_limit";
    case ORDER_TYPE_SELL_STOP_LIMIT:
      return "sell_stop_limit";
  }
  return "";
}

// Lenh cho (pending) dang co
string OrdersJson(string &sig)
{
  string js = "[";
  int n = OrdersTotal();
  for (int i = 0; i < n; i++)
  {
    ulong tk = OrderGetTicket(i); // chon lenh thu i
    if (tk == 0)
      continue;
    string sym = OrderGetString(ORDER_SYMBOL);
    int dg = PriceDigits(sym);
    double vol = OrderGetDouble(ORDER_VOLUME_CURRENT);
    double price = OrderGetDouble(ORDER_PRICE_OPEN);
    double sl = OrderGetDouble(ORDER_SL);
    double tp = OrderGetDouble(ORDER_TP);
    if (js != "[")
      js += ",";
    js += "{\"ticket\":" + IntegerToString((long)tk) + ",\"symbol\":\"" + Esc(sym) + "\""
        + ",\"type\":\"" + OrderTypeStr(OrderGetInteger(ORDER_TYPE)) + "\""
        + ",\"volume\":" + DoubleToString(vol, 8)
        + ",\"price_open\":" + DoubleToString(price, dg)
        + ",\"price_stoplimit\":" + DoubleToString(OrderGetDouble(ORDER_PRICE_STOPLIMIT), dg)
        + ",\"sl\":" + DoubleToString(sl, dg) + ",\"tp\":" + DoubleToString(tp, dg)
        + ",\"time_setup\":" + IntegerToString(ToUtc(OrderGetInteger(ORDER_TIME_SETUP)))
        + ",\"expiration\":" + IntegerToString(ToUtc(OrderGetInteger(ORDER_TIME_EXPIRATION)))
        + ",\"magic\":" + IntegerToString((long)OrderGetInteger(ORDER_MAGIC))
        + ",\"comment\":\"" + Esc(OrderGetString(ORDER_COMMENT)) + "\"}";
    sig += IntegerToString((long)tk) + ":" + DoubleToString(vol, 8) + ":" + DoubleToString(price, dg) + ":" + DoubleToString(sl, dg) + ":" + DoubleToString(tp, dg) + ";";
  }
  return js + "]";
}

// Vi the + lenh cho: gui khi cau truc doi (mo/dong/sua SL-TP), con lai moi 1s (co vi the: P/L doi theo gia) hoac 5s (khong co gi)
void PostTrade(bool force)
{
  string sigP = "";
  string sigO = "";
  string pos = PositionsJson(sigP);
  string ord = OrdersJson(sigO);
  string sig = sigP + "|" + sigO;
  ulong now = GetTickCount64();
  ulong every = (sigP != "" || sigO != "") ? 1000 : 5000;
  if (!force && sig == g_lastTradeSig && now - g_lastTradeMs < every)
    return;
  if (SendLine("{\"type\":\"trade\",\"positions\":" + pos + ",\"orders\":" + ord + "}"))
  {
    g_lastTradeSig = sig;
    g_lastTradeMs = now;
  }
}

string DealTypeStr(long t)
{
  if (t == DEAL_TYPE_BUY)
    return "buy";
  if (t == DEAL_TYPE_SELL)
    return "sell";
  if (t == DEAL_TYPE_BALANCE)
    return "balance";
  return "";
}

string DealEntryStr(long e)
{
  if (e == DEAL_ENTRY_IN)
    return "in";
  if (e == DEAL_ENTRY_OUT || e == DEAL_ENTRY_OUT_BY)
    return "out";
  if (e == DEAL_ENTRY_INOUT)
    return "inout";
  return "";
}

// Lich su khop lenh DealsDays ngay gan nhat (toi da MaxDeals, moi nhat truoc)
void PostDeals()
{
  g_dealsDirty = false;
  g_lastDealsMs = GetTickCount64();
  datetime to = TimeCurrent();
  datetime from = (datetime)((long)to - (long)DealsDays * 86400);
  if (!HistorySelect(from, to))
    return;
  int total = HistoryDealsTotal();
  int stop = MathMax(0, total - MaxDeals);
  string js = "[";
  for (int i = total - 1; i >= stop; i--)
  {
    ulong tk = HistoryDealGetTicket(i);
    if (tk == 0)
      continue;
    string sym = HistoryDealGetString(tk, DEAL_SYMBOL);
    int dg = sym == "" ? 2 : PriceDigits(sym);
    if (js != "[")
      js += ",";
    js += "{\"ticket\":" + IntegerToString((long)tk) + ",\"order\":" + IntegerToString((long)HistoryDealGetInteger(tk, DEAL_ORDER))
        + ",\"symbol\":\"" + Esc(sym) + "\""
        + ",\"type\":\"" + DealTypeStr(HistoryDealGetInteger(tk, DEAL_TYPE)) + "\""
        + ",\"entry\":\"" + DealEntryStr(HistoryDealGetInteger(tk, DEAL_ENTRY)) + "\""
        + ",\"volume\":" + DoubleToString(HistoryDealGetDouble(tk, DEAL_VOLUME), 8)
        + ",\"price\":" + DoubleToString(HistoryDealGetDouble(tk, DEAL_PRICE), dg)
        + ",\"profit\":" + DoubleToString(HistoryDealGetDouble(tk, DEAL_PROFIT), 2)
        + ",\"commission\":" + DoubleToString(HistoryDealGetDouble(tk, DEAL_COMMISSION), 2)
        + ",\"swap\":" + DoubleToString(HistoryDealGetDouble(tk, DEAL_SWAP), 2)
        + ",\"time\":" + IntegerToString(ToUtc(HistoryDealGetInteger(tk, DEAL_TIME)))
        + ",\"magic\":" + IntegerToString((long)HistoryDealGetInteger(tk, DEAL_MAGIC))
        + ",\"comment\":\"" + Esc(HistoryDealGetString(tk, DEAL_COMMENT)) + "\"}";
  }
  SendLine("{\"type\":\"deals\",\"deals\":" + js + "]}");
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
    js += "{\"name\":\"" + Esc(s) + "\",\"digits\":" + IntegerToString((int)SymbolInfoInteger(s, SYMBOL_DIGITS)) + ",\"tick_size\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_SIZE), 10) + ",\"type\":\"" + SymbolType(s) + "\",\"description\":\"" + Esc(SymbolInfoString(s, SYMBOL_DESCRIPTION)) + "\",\"broker\":\"" + Esc(broker) + "\""
        + ",\"volume_min\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_VOLUME_MIN), 8)
        + ",\"volume_max\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_VOLUME_MAX), 8)
        + ",\"volume_step\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_VOLUME_STEP), 8)
        + ",\"contract_size\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_TRADE_CONTRACT_SIZE), 8)
        + ",\"tick_value\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE_PROFIT), 8)
        + ",\"tick_value_loss\":" + DoubleToString(SymbolInfoDouble(s, SYMBOL_TRADE_TICK_VALUE_LOSS), 8)
        + ",\"stops_level\":" + IntegerToString((int)SymbolInfoInteger(s, SYMBOL_TRADE_STOPS_LEVEL))
        + ",\"freeze_level\":" + IntegerToString((int)SymbolInfoInteger(s, SYMBOL_TRADE_FREEZE_LEVEL)) + "}";
  }
  js += "]}";
  SendLine(js);
}

// Ma nuoc + tien te cua mot country_id (cache). Su kien toan cau khong co quoc gia thi de rong.
bool CalendarCountry(long id, string &code, string &cur)
{
  int sz = ArraySize(g_calCountryId);
  for (int i = 0; i < sz; i++)
  {
    if (g_calCountryId[i] == id)
    {
      code = g_calCountryCode[i];
      cur = g_calCountryCur[i];
      return true;
    }
  }
  MqlCalendarCountry c;
  if (!CalendarCountryById(id, c))
    return false;
  ArrayResize(g_calCountryId, sz + 1);
  ArrayResize(g_calCountryCode, sz + 1);
  ArrayResize(g_calCountryCur, sz + 1);
  g_calCountryId[sz] = id;
  g_calCountryCode[sz] = c.code;
  g_calCountryCur[sz] = c.currency;
  code = c.code;
  cur = c.currency;
  return true;
}

string CalNum(bool has, double v) { return has ? DoubleToString(v, 6) : "null"; }

// Lich kinh te co san cua MT5 -> "calendar" (ca cua so [from, to]; backend thay the sach su kien trong cua so do). Thoi gian la gio server MT5 -> doi sang UTC
// nhu moi thoi gian khac. Lan dau tren terminal moi lich co the chua dong bo (tra false / rong): KHONG gui gi (de backend khong xoa nham), thu lai sau 30s.
bool PostCalendar()
{
  g_lastCalendarMs = GetTickCount64();
  datetime from = (datetime)((long)TimeCurrent() - (long)CalendarDaysBack * 86400);
  datetime to = (datetime)((long)TimeCurrent() + (long)CalendarDaysAhead * 86400);
  MqlCalendarValue values[];
  ResetLastError();
  if (!CalendarValueHistory(values, from, to))
  {
    if (!g_calendarWarned)
      PrintFormat("TVBridge: CalendarValueHistory loi %d (lich kinh te cua MT5 chua san sang? se thu lai sau 30s)", GetLastError());
    g_calendarWarned = true;
    return false;
  }
  int n = ArraySize(values);
  string js = "";
  int cnt = 0;
  for (int i = 0; i < n && cnt < 3000; i++)
  {
    MqlCalendarEvent e;
    if (!CalendarEventById(values[i].event_id, e))
      continue;
    string code = "";
    string cur = "";
    CalendarCountry((long)e.country_id, code, cur);
    if (cnt > 0)
      js += ",";
    js += "{\"id\":" + IntegerToString((long)values[i].id)
        + ",\"event_id\":" + IntegerToString((long)values[i].event_id)
        + ",\"time\":" + IntegerToString(ToUtc((long)values[i].time))
        + ",\"country\":\"" + Esc(code) + "\",\"currency\":\"" + Esc(cur) + "\""
        + ",\"name\":\"" + Esc(e.name) + "\""
        + ",\"importance\":" + IntegerToString((int)e.importance)
        + ",\"unit\":" + IntegerToString((int)e.unit)
        + ",\"multiplier\":" + IntegerToString((int)e.multiplier)
        + ",\"digits\":" + IntegerToString((int)e.digits)
        + ",\"time_mode\":" + IntegerToString((int)e.time_mode)
        + ",\"impact\":" + IntegerToString((int)values[i].impact_type)
        + ",\"actual\":" + CalNum(values[i].HasActualValue(), values[i].GetActualValue())
        + ",\"forecast\":" + CalNum(values[i].HasForecastValue(), values[i].GetForecastValue())
        + ",\"previous\":" + CalNum(values[i].HasPreviousValue(), values[i].GetPreviousValue())
        + ",\"revised\":" + CalNum(values[i].HasRevisedValue(), values[i].GetRevisedValue()) + "}";
    cnt++;
  }
  if (cnt == 0)
  {
    if (!g_calendarWarned)
      Print("TVBridge: lich kinh te cua MT5 dang rong (chua dong bo?), se thu lai sau 30s");
    g_calendarWarned = true;
    return false;
  }
  string msg = "{\"type\":\"calendar\",\"from\":" + IntegerToString(ToUtc((long)from)) + ",\"to\":" + IntegerToString(ToUtc((long)to)) + ",\"events\":[" + js + "]}";
  if (!SendLine(msg))
    return false;
  g_calendarOk = true;
  g_calendarWarned = false;
  if (!g_calendarLogged)
    PrintFormat("TVBridge: da gui %d su kien kinh te (tu %d ngay truoc toi %d ngay sau), lam moi moi %ds", cnt, CalendarDaysBack, CalendarDaysAhead, CalendarRefreshSec);
  g_calendarLogged = true;
  return true;
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
    string js = "{\"type\":\"ticks\",\"broker_utc_offset\":" + IntegerToString(BrokerOffset()) + ",\"symbol\":\"" + Esc(g_subs[i]) + "\""
                + (SymbolInfoInteger(g_subs[i], SYMBOL_CHART_MODE) == SYMBOL_CHART_MODE_LAST ? ",\"lm\":1" : "") + ",\"ticks\":[";
    for (int k = 0; k < n; k++)
    {
      if (k > 0)
        js += ",";
      js += "{\"t_msc\":" + IntegerToString(ticks[k].time_msc) + ",\"bid\":" + DoubleToString(ticks[k].bid, 8) + ",\"ask\":" + DoubleToString(ticks[k].ask, 8) + ",\"last\":" + DoubleToString(ticks[k].last, 8) + ",\"vol\":" + IntegerToString((long)ticks[k].volume) + ",\"f\":" + IntegerToString((int)ticks[k].flags) + "}";
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

//--- lich su tick cho CVD "1 tick" (tf "TD") ----------------------------
// Gia + trong so dung de phan loai len/xuong: nen theo Bid -> tick doi Bid, trong so 1 (giong tick_volume cua nen);
// nen theo Last (san) -> tick giao dich, trong so = volume. Tick khong thuoc loai do bi bo qua.
bool TickPrice(const MqlTick &tk, bool useLast, double &price, double &weight)
{
  if (useLast)
  {
    if ((tk.flags & TICK_FLAG_LAST) == 0 || tk.last <= 0)
      return false;
    price = tk.last;
    weight = (double)tk.volume;
    if (weight <= 0)
      weight = 1;
    return true;
  }
  if ((tk.flags & TICK_FLAG_BID) == 0 || tk.bid <= 0)
    return false;
  price = tk.bid;
  weight = 1;
  return true;
}

// Noi cac so thanh "a,b,c" theo tung khoi nho (cong chuoi dai lien tuc rat cham)
string JoinLongs(const long &a[], int n)
{
  string all = "", part = "";
  for (int i = 0; i < n; i++)
  {
    part += (i > 0 ? "," : "") + IntegerToString(a[i]);
    if ((i & 255) == 255)
    {
      all += part;
      part = "";
    }
  }
  return all + part;
}

string JoinDoubles(const double &a[], int n, int digits)
{
  string all = "", part = "";
  for (int i = 0; i < n; i++)
  {
    part += (i > 0 ? "," : "") + DoubleToString(a[i], digits);
    if ((i & 255) == 255)
    {
      all += part;
      part = "";
    }
  }
  return all + part;
}

bool SendTickChunk(string symbol, int offset, int digits, const long &t[], const double &p[], const double &w[], int n, bool useW, double pb, int pd, bool cont, bool done)
{
  string js = "{\"type\":\"ticks_hist\",\"broker_utc_offset\":" + IntegerToString(offset) + ",\"symbol\":\"" + Esc(symbol) + "\",\"pb\":" + DoubleToString(pb, 8) + ",\"pd\":" + IntegerToString(pd)
              + ",\"cont\":" + (cont ? "true" : "false") + ",\"done\":" + (done ? "true" : "false")
              + ",\"t\":[" + JoinLongs(t, n) + "],\"p\":[" + JoinDoubles(p, n, digits) + "]";
  if (useW)
    js += ",\"w\":[" + JoinDoubles(w, n, 2) + "]";
  return SendLine(js + "}");
}

// Tick cua `minutes` nen M1 (dem lui theo chi so nen nhu Backfill nen nhay qua cuoi tuan / gio dong cua), nen cuoi la nen chua `before`
// (epoch UTC); nen chua toi (hien tai) thi cat o bay gio -> phut do chua tron, lan sau web xin lai (backend ghi de ca phut).
// Cua so luon tron phut nen moi phut nam tron trong mot thong diep.
void TickHistory(string symbol, int minutes, long before)
{
  if (minutes <= 0)
    return;
  minutes = MathMin(minutes, 2880);
  SymbolSelect(symbol, true);
  int offset = BrokerOffset();
  long offMs = (long)offset * 1000;
  bool useLast = (SymbolInfoInteger(symbol, SYMBOL_CHART_MODE) == SYMBOL_CHART_MODE_LAST);
  int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
  long nowMs = (long)TimeGMT() * 1000 + 999;
  long endMs = MathMin((before / 60 + 1) * 60 * 1000, nowMs); // het phut chua `before`, khong qua bay gio
  long startMs = ((endMs - 1) / 60000 - minutes + 1) * 60000; // du phong neu terminal chua co nen M1 o do: theo gio dong ho
  MqlRates r1[];
  int shift = iBarShift(symbol, PERIOD_M1, (datetime)((endMs - 1) / 1000 + offset), false);
  if (shift >= 0 && CopyRates(symbol, PERIOD_M1, shift, minutes, r1) > 0)
    startMs = ((long)r1[0].time - offset) * 1000;

  // gia + chieu cua tick lien truoc cua so (5 phut truoc do): de tick dau co chieu dung (khong co thi backend lay mac dinh)
  double pb = 0, price = 0, weight = 0;
  int pd = 1;
  MqlTick pre[];
  int np = CopyTicksRange(symbol, pre, COPY_TICKS_ALL, (ulong)(startMs + offMs - 300000), (ulong)(startMs + offMs - 1));
  for (int k = 0; k < np; k++)
    if (TickPrice(pre[k], useLast, price, weight))
    {
      if (pb > 0 && price != pb)
        pd = (price > pb) ? 1 : -1;
      pb = price;
    }

  MqlTick ticks[];
  int n = -1;
  for (int attempt = 0; attempt < 5; attempt++)
  {
    ResetLastError();
    n = CopyTicksRange(symbol, ticks, COPY_TICKS_ALL, (ulong)(startMs + offMs), (ulong)(endMs + offMs - 1));
    if (n >= 0)
      break;
    Sleep(300); // lich su tick cu chua tai xong -> thu lai
  }
  if (n <= 0)
  {
    PrintFormat("TickHistory %s: khong co tick (n=%d, loi %d, %d nen M1 toi %s)", symbol, n, GetLastError(), minutes, IntegerToString(endMs / 1000));
    return;
  }

  int cap = TickHistChunk * 2;
  long tt[];
  double pp[], ww[];
  ArrayResize(tt, cap);
  ArrayResize(pp, cap);
  ArrayResize(ww, cap);
  int cnt = 0, sent = 0;
  long curMin = -1;
  bool cont = false;
  for (int i = 0; i < n; i++)
  {
    if (!TickPrice(ticks[i], useLast, price, weight))
      continue;
    long m = (long)ticks[i].time_msc / 60000;
    if (cnt > 0 && ((m != curMin && cnt >= TickHistChunk) || cnt >= cap)) // cat o ranh gioi phut; qua cap thi cat luon (phut do bi chia hai, hiem)
    {
      if (!SendTickChunk(symbol, offset, digits, tt, pp, ww, cnt, useLast, pb, pd, cont, false))
        return;
      sent += cnt;
      cnt = 0;
      cont = true;
    }
    curMin = m;
    tt[cnt] = (long)ticks[i].time_msc;
    pp[cnt] = price;
    ww[cnt] = weight;
    cnt++;
  }
  if (cnt > 0 && SendTickChunk(symbol, offset, digits, tt, pp, ww, cnt, useLast, pb, pd, cont, true))
    sent += cnt;
  PrintFormat("TickHistory %s: %d tick (%d nen M1 toi %s, %s)", symbol, sent, minutes, IntegerToString(endMs / 1000), useLast ? "Last" : "Bid");
}

//--- giao dich tu web (T2): market Buy/Sell + dong vi the -------------------
double JsonDbl(string obj, string key)
{
  int p = StringFind(obj, "\"" + key + "\"");
  if (p < 0)
    return 0;
  p = StringFind(obj, ":", p) + 1;
  while (p < StringLen(obj) && StringGetCharacter(obj, p) == ' ')
    p++;
  int e = p;
  while (e < StringLen(obj))
  {
    ushort ch = StringGetCharacter(obj, e);
    if ((ch < '0' || ch > '9') && ch != '-' && ch != '.' && ch != 'e' && ch != 'E' && ch != '+')
      break;
    e++;
  }
  return StringToDouble(StringSubstr(obj, p, e - p));
}

// Ket qua cho backend: ok=true khi san da khop (retcode 10009/10010/10008); reason = ma loi cua EA (backend dich sang tieng Viet)
void SendTradeResult(string req, bool ok, uint retcode, string reason, string comment, ulong order = 0, ulong deal = 0, double price = 0, double volume = 0, string orderType = "")
{
  SendLine("{\"type\":\"trade_result\",\"req_id\":\"" + Esc(req) + "\",\"ok\":" + JsonBool(ok) + ",\"order_type\":\"" + orderType + "\""
           + ",\"retcode\":" + IntegerToString((long)retcode) + ",\"reason\":\"" + Esc(reason) + "\",\"comment\":\"" + Esc(comment) + "\""
           + ",\"order\":" + IntegerToString((long)order) + ",\"deal\":" + IntegerToString((long)deal)
           + ",\"price\":" + DoubleToString(price, 8) + ",\"volume\":" + DoubleToString(volume, 8) + "}");
}

// "" = duoc phep giao dich; nguoc lai tra ma ly do (khop voi bang dich cua backend/app/trade.py)
string TradeGuard()
{
  if (!TradingEnabled)
    return "ea_trading_off";
  if ((ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO && !AllowRealAccount)
    return "real_blocked";
  if (!TerminalInfoInteger(TERMINAL_TRADE_ALLOWED))
    return "terminal_trade_off";
  if (!MQLInfoInteger(MQL_TRADE_ALLOWED))
    return "ea_trade_off";
  if (!AccountInfoInteger(ACCOUNT_TRADE_ALLOWED))
    return "account_trade_off";
  if (!AccountInfoInteger(ACCOUNT_TRADE_EXPERT))
    return "expert_not_allowed";
  return "";
}

ENUM_ORDER_TYPE_FILLING FillingFor(string sym)
{
  long m = SymbolInfoInteger(sym, SYMBOL_FILLING_MODE);
  if ((m & SYMBOL_FILLING_FOK) != 0)
    return ORDER_FILLING_FOK;
  if ((m & SYMBOL_FILLING_IOC) != 0)
    return ORDER_FILLING_IOC;
  return ORDER_FILLING_RETURN;
}

// Khoi luong hop le theo min/max/step cua symbol (tra "" neu duoc, nguoc lai ma loi)
string CheckVolume(string sym, double vol)
{
  double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
  double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
  double vmax = SymbolInfoDouble(sym, SYMBOL_VOLUME_MAX);
  if (vol <= 0 || vol < vmin - 1e-9 || vol > vmax + 1e-9)
    return "bad_volume";
  if (step > 0 && MathAbs(vol / step - MathRound(vol / step)) > 1e-6)
    return "bad_volume";
  if (vol > MaxLotPerOrder + 1e-9)
    return "lot_over_limit";
  return "";
}

// OrderCheck truoc OrderSend: bat loi margin/stops/volume ma khong gui lenh that. `check` = false cho sua/xoa lenh cho (OrderCheck khong dung cho
// TRADE_ACTION_MODIFY/REMOVE). `orderType` = loai lenh cho da quyet (tra ve cho web)
void ExecuteRequest(string req, MqlTradeRequest &rq, string orderType = "", bool check = true)
{
  if (check)
  {
    MqlTradeCheckResult ck;
    ZeroMemory(ck);
    ResetLastError();
    bool passed = OrderCheck(rq, ck);
    if (!passed && ck.retcode == TRADE_RETCODE_INVALID_FILL) // kieu khop lenh khong duoc ho tro: thu cac kieu con lai
    {
      ENUM_ORDER_TYPE_FILLING alt[3] = {ORDER_FILLING_RETURN, ORDER_FILLING_IOC, ORDER_FILLING_FOK};
      for (int i = 0; i < 3 && ck.retcode == TRADE_RETCODE_INVALID_FILL; i++)
      {
        if (alt[i] == rq.type_filling)
          continue;
        rq.type_filling = alt[i];
        ZeroMemory(ck);
        passed = OrderCheck(rq, ck);
      }
    }
    if (!passed || (ck.retcode != 0 && ck.retcode != TRADE_RETCODE_DONE))
    {
      PrintFormat("TVBridge: [trade] OrderCheck tu choi %s %s %s %.2f: retcode %u (%s)", rq.symbol, EnumToString(rq.action), EnumToString(rq.type), rq.volume, ck.retcode, ck.comment);
      SendTradeResult(req, false, ck.retcode, "check_failed", ck.comment, 0, 0, 0, 0, orderType);
      return;
    }
  }
  MqlTradeResult res;
  ZeroMemory(res);
  bool sent = OrderSend(rq, res);
  bool done = sent && (res.retcode == TRADE_RETCODE_DONE || res.retcode == TRADE_RETCODE_DONE_PARTIAL || res.retcode == TRADE_RETCODE_PLACED);
  PrintFormat("TVBridge: [trade] %s %s %s %.2f -> retcode %u deal %I64u order %I64u price %.5f (%s)", rq.symbol, EnumToString(rq.action), EnumToString(rq.type), rq.volume,
              res.retcode, res.deal, res.order, res.price, res.comment);
  SendTradeResult(req, done, res.retcode, done ? "" : "rejected", res.comment, res.order, res.deal, res.price, res.volume, orderType);
}

void HandleOrderSend(string line)
{
  string req = JsonStr(line, "req_id");
  string sym = JsonStr(line, "symbol");
  string side = JsonStr(line, "side");
  double vol = JsonDbl(line, "volume");
  double sl = JsonDbl(line, "sl");
  double tp = JsonDbl(line, "tp");
  string cid = JsonStr(line, "client_id");

  string why = TradeGuard();
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  if ((side != "buy" && side != "sell") || sym == "" || !SymbolSelect(sym, true))
  {
    SendTradeResult(req, false, 0, "bad_request", "");
    return;
  }
  why = CheckVolume(sym, vol);
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  MqlTick tick;
  if (!SymbolInfoTick(sym, tick) || tick.ask <= 0 || tick.bid <= 0)
  {
    SendTradeResult(req, false, 0, "no_quote", "");
    return;
  }
  int dg = PriceDigits(sym);
  bool buy = (side == "buy");
  MqlTradeRequest rq;
  ZeroMemory(rq);
  rq.action = TRADE_ACTION_DEAL;
  rq.symbol = sym;
  rq.volume = vol;
  rq.type = buy ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
  rq.price = NormalizeDouble(buy ? tick.ask : tick.bid, dg);
  rq.sl = sl > 0 ? NormalizeDouble(sl, dg) : 0;
  rq.tp = tp > 0 ? NormalizeDouble(tp, dg) : 0;
  rq.deviation = Deviation;
  rq.magic = MagicNumber;
  rq.comment = StringSubstr("wl:" + cid, 0, 31); // MT5 gioi han comment 31 ky tu
  rq.type_filling = FillingFor(sym);
  ExecuteRequest(req, rq);
}

// Dong vi the theo ticket; volume = 0 -> dong het, khac 0 -> dong mot phan
void HandlePositionClose(string line)
{
  string req = JsonStr(line, "req_id");
  ulong ticket = (ulong)JsonInt(line, "ticket");
  double vol = JsonDbl(line, "volume");

  string why = TradeGuard();
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  if (ticket == 0 || !PositionSelectByTicket(ticket))
  {
    SendTradeResult(req, false, 0, "no_position", "");
    return;
  }
  string sym = PositionGetString(POSITION_SYMBOL);
  double have = PositionGetDouble(POSITION_VOLUME);
  bool wasBuy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
  if (vol <= 0 || vol > have)
    vol = have;
  double step = SymbolInfoDouble(sym, SYMBOL_VOLUME_STEP);
  double vmin = SymbolInfoDouble(sym, SYMBOL_VOLUME_MIN);
  if (vol < vmin - 1e-9 || (step > 0 && MathAbs(vol / step - MathRound(vol / step)) > 1e-6))
  {
    SendTradeResult(req, false, 0, "bad_volume", "");
    return;
  }
  MqlTick tick;
  if (!SymbolInfoTick(sym, tick) || tick.ask <= 0 || tick.bid <= 0)
  {
    SendTradeResult(req, false, 0, "no_quote", "");
    return;
  }
  int dg = PriceDigits(sym);
  MqlTradeRequest rq;
  ZeroMemory(rq);
  rq.action = TRADE_ACTION_DEAL;
  rq.position = ticket;
  rq.symbol = sym;
  rq.volume = vol;
  rq.type = wasBuy ? ORDER_TYPE_SELL : ORDER_TYPE_BUY; // dong = lenh nguoc chieu
  rq.price = NormalizeDouble(wasBuy ? tick.bid : tick.ask, dg);
  rq.deviation = Deviation;
  rq.magic = MagicNumber;
  rq.comment = "wl:close";
  rq.type_filling = FillingFor(sym);
  ExecuteRequest(req, rq);
}

//--- lenh cho (T3): dat / sua / xoa --------------------------------------
// Loai lenh cho tu gia vao so voi gia thi truong LUC THUC THI (plan muc 3): Buy duoi Ask = Limit, tren Ask = Stop; Sell tren Bid = Limit, duoi Bid = Stop.
// Bang gia thi truong thi khong dat duoc (tra false)
bool ResolvePending(bool buy, double price, double bid, double ask, ENUM_ORDER_TYPE &ot)
{
  if (buy)
  {
    if (price < ask)
      ot = ORDER_TYPE_BUY_LIMIT;
    else if (price > ask)
      ot = ORDER_TYPE_BUY_STOP;
    else
      return false;
  }
  else
  {
    if (price > bid)
      ot = ORDER_TYPE_SELL_LIMIT;
    else if (price < bid)
      ot = ORDER_TYPE_SELL_STOP;
    else
      return false;
  }
  return true;
}

bool IsBuyType(ENUM_ORDER_TYPE ot) { return ot == ORDER_TYPE_BUY_LIMIT || ot == ORDER_TYPE_BUY_STOP; }

// Gia vao qua gan gia thi truong (trong SYMBOL_TRADE_STOPS_LEVEL)? level la so diem broker bat buoc toi thieu
bool TooClose(string sym, ENUM_ORDER_TYPE ot, double price, double bid, double ask)
{
  double point = SymbolInfoDouble(sym, SYMBOL_POINT);
  double lv = (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * point;
  if (lv <= 0)
    return false;
  double d;
  if (ot == ORDER_TYPE_BUY_LIMIT)
    d = ask - price;
  else if (ot == ORDER_TYPE_BUY_STOP)
    d = price - ask;
  else if (ot == ORDER_TYPE_SELL_LIMIT)
    d = price - bid;
  else
    d = bid - price;
  return d < lv - point / 2;
}

string StopsLevelPoints(string sym) { return IntegerToString((long)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL)); }

void HandleOrderPending(string line)
{
  string req = JsonStr(line, "req_id");
  string sym = JsonStr(line, "symbol");
  string side = JsonStr(line, "side");
  double price = JsonDbl(line, "price");
  double vol = JsonDbl(line, "volume");
  double sl = JsonDbl(line, "sl");
  double tp = JsonDbl(line, "tp");
  long expUtc = JsonInt(line, "expiration"); // epoch UTC; 0 = GTC
  string expected = JsonStr(line, "expected_type");
  string cid = JsonStr(line, "client_id");

  string why = TradeGuard();
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  if ((side != "buy" && side != "sell") || sym == "" || price <= 0 || !SymbolSelect(sym, true))
  {
    SendTradeResult(req, false, 0, "bad_request", "");
    return;
  }
  why = CheckVolume(sym, vol);
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  if (expUtc > 0 && expUtc <= (long)TimeGMT() + 60)
  {
    SendTradeResult(req, false, 0, "bad_expiration", "");
    return;
  }
  MqlTick tick;
  if (!SymbolInfoTick(sym, tick) || tick.ask <= 0 || tick.bid <= 0)
  {
    SendTradeResult(req, false, 0, "no_quote", "");
    return;
  }
  int dg = PriceDigits(sym);
  price = NormalizeDouble(price, dg);
  ENUM_ORDER_TYPE ot;
  if (!ResolvePending(side == "buy", price, tick.bid, tick.ask, ot))
  {
    SendTradeResult(req, false, 0, "too_close", StopsLevelPoints(sym));
    return;
  }
  string resolved = OrderTypeStr(ot);
  if (TooClose(sym, ot, price, tick.bid, tick.ask))
  {
    SendTradeResult(req, false, 0, "too_close", StopsLevelPoints(sym), 0, 0, 0, 0, resolved);
    return;
  }
  // Gia nhay lam loai lenh doi so voi cai nguoi dung nhin thay (vd Buy Limit -> Buy Stop = mua hoi thanh mua breakout): demo van dat, account
  // khac demo thi KHONG dat, web hien lai ticket voi loai moi de xac nhan lai
  if (expected != "" && expected != resolved && (ENUM_ACCOUNT_TRADE_MODE)AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
  {
    SendTradeResult(req, false, 0, "type_changed", "", 0, 0, 0, 0, resolved);
    return;
  }
  MqlTradeRequest rq;
  ZeroMemory(rq);
  rq.action = TRADE_ACTION_PENDING;
  rq.symbol = sym;
  rq.volume = vol;
  rq.type = ot;
  rq.price = price;
  rq.sl = sl > 0 ? NormalizeDouble(sl, dg) : 0;
  rq.tp = tp > 0 ? NormalizeDouble(tp, dg) : 0;
  rq.magic = MagicNumber;
  rq.comment = StringSubstr("wl:" + cid, 0, 31);
  rq.type_filling = ORDER_FILLING_RETURN;
  rq.type_time = expUtc > 0 ? ORDER_TIME_SPECIFIED : ORDER_TIME_GTC;
  rq.expiration = expUtc > 0 ? (datetime)(expUtc + BrokerOffset()) : (datetime)0;
  ExecuteRequest(req, rq, resolved);
}

// Sua gia / SL / TP / het han cua lenh cho (khong doi duoc loai: keo qua gia thi web dat lenh moi roi xoa lenh cu)
void HandleOrderModify(string line)
{
  string req = JsonStr(line, "req_id");
  ulong ticket = (ulong)JsonInt(line, "ticket");
  double price = JsonDbl(line, "price");
  double sl = JsonDbl(line, "sl");
  double tp = JsonDbl(line, "tp");
  long expUtc = JsonInt(line, "expiration");

  string why = TradeGuard();
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  if (ticket == 0 || !OrderSelect(ticket))
  {
    SendTradeResult(req, false, 0, "no_order", "");
    return;
  }
  string sym = OrderGetString(ORDER_SYMBOL);
  ENUM_ORDER_TYPE ot = (ENUM_ORDER_TYPE)OrderGetInteger(ORDER_TYPE);
  if (price <= 0 || (ot != ORDER_TYPE_BUY_LIMIT && ot != ORDER_TYPE_SELL_LIMIT && ot != ORDER_TYPE_BUY_STOP && ot != ORDER_TYPE_SELL_STOP))
  {
    SendTradeResult(req, false, 0, "bad_request", "");
    return;
  }
  if (expUtc > 0 && expUtc <= (long)TimeGMT() + 60)
  {
    SendTradeResult(req, false, 0, "bad_expiration", "");
    return;
  }
  MqlTick tick;
  if (!SymbolInfoTick(sym, tick) || tick.ask <= 0 || tick.bid <= 0)
  {
    SendTradeResult(req, false, 0, "no_quote", "");
    return;
  }
  int dg = PriceDigits(sym);
  price = NormalizeDouble(price, dg);
  ENUM_ORDER_TYPE now;
  if (!ResolvePending(IsBuyType(ot), price, tick.bid, tick.ask, now))
  {
    SendTradeResult(req, false, 0, "too_close", StopsLevelPoints(sym), 0, 0, 0, 0, OrderTypeStr(ot));
    return;
  }
  if (now != ot)
  {
    SendTradeResult(req, false, 0, "type_would_change", "", 0, 0, 0, 0, OrderTypeStr(now));
    return;
  }
  if (TooClose(sym, ot, price, tick.bid, tick.ask))
  {
    SendTradeResult(req, false, 0, "too_close", StopsLevelPoints(sym), 0, 0, 0, 0, OrderTypeStr(ot));
    return;
  }
  MqlTradeRequest rq;
  ZeroMemory(rq);
  rq.action = TRADE_ACTION_MODIFY;
  rq.order = ticket;
  rq.symbol = sym;
  rq.price = price;
  rq.sl = sl > 0 ? NormalizeDouble(sl, dg) : 0;
  rq.tp = tp > 0 ? NormalizeDouble(tp, dg) : 0;
  rq.type_time = expUtc > 0 ? ORDER_TIME_SPECIFIED : ORDER_TIME_GTC;
  rq.expiration = expUtc > 0 ? (datetime)(expUtc + BrokerOffset()) : (datetime)0;
  ExecuteRequest(req, rq, OrderTypeStr(ot), false);
}

void HandleOrderDelete(string line)
{
  string req = JsonStr(line, "req_id");
  ulong ticket = (ulong)JsonInt(line, "ticket");
  string why = TradeGuard();
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  if (ticket == 0 || !OrderSelect(ticket))
  {
    SendTradeResult(req, false, 0, "no_order", "");
    return;
  }
  MqlTradeRequest rq;
  ZeroMemory(rq);
  rq.action = TRADE_ACTION_REMOVE;
  rq.order = ticket;
  rq.symbol = OrderGetString(ORDER_SYMBOL);
  ExecuteRequest(req, rq, OrderTypeStr(OrderGetInteger(ORDER_TYPE)), false);
}

// Doi SL/TP cua vi the dang mo (keo tren chart). SL/TP do tu gia DONG vi the (Buy dong o Bid, Sell o Ask) va phai cach it nhat stops level; 0 = bo
void HandlePositionModify(string line)
{
  string req = JsonStr(line, "req_id");
  ulong ticket = (ulong)JsonInt(line, "ticket");
  double sl = JsonDbl(line, "sl");
  double tp = JsonDbl(line, "tp");

  string why = TradeGuard();
  if (why != "")
  {
    SendTradeResult(req, false, 0, why, "");
    return;
  }
  if (ticket == 0 || !PositionSelectByTicket(ticket))
  {
    SendTradeResult(req, false, 0, "no_position", "");
    return;
  }
  string sym = PositionGetString(POSITION_SYMBOL);
  bool buy = (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY);
  MqlTick tick;
  if (!SymbolInfoTick(sym, tick) || tick.ask <= 0 || tick.bid <= 0)
  {
    SendTradeResult(req, false, 0, "no_quote", "");
    return;
  }
  int dg = PriceDigits(sym);
  double point = SymbolInfoDouble(sym, SYMBOL_POINT);
  double lv = (double)SymbolInfoInteger(sym, SYMBOL_TRADE_STOPS_LEVEL) * point;
  double ref = buy ? tick.bid : tick.ask;
  sl = sl > 0 ? NormalizeDouble(sl, dg) : 0;
  tp = tp > 0 ? NormalizeDouble(tp, dg) : 0;
  bool wrongSide = (sl > 0 && (buy ? sl >= ref : sl <= ref)) || (tp > 0 && (buy ? tp <= ref : tp >= ref));
  if (wrongSide)
  {
    SendTradeResult(req, false, 0, "bad_stops", "");
    return;
  }
  if (lv > 0 && ((sl > 0 && MathAbs(sl - ref) < lv - point / 2) || (tp > 0 && MathAbs(tp - ref) < lv - point / 2)))
  {
    SendTradeResult(req, false, 0, "too_close", StopsLevelPoints(sym));
    return;
  }
  MqlTradeRequest rq;
  ZeroMemory(rq);
  rq.action = TRADE_ACTION_SLTP;
  rq.position = ticket;
  rq.symbol = sym;
  rq.sl = sl;
  rq.tp = tp;
  ExecuteRequest(req, rq, "", false);
}

//--- nhận lệnh từ backend ---------------------------------------------
void HandleCommand(string line)
{
  string type = JsonStr(line, "type");
  if (type == "need_symbols")
    PostSymbols();
  else if (type == "order_send")
    HandleOrderSend(line);
  else if (type == "position_close")
    HandlePositionClose(line);
  else if (type == "position_modify")
    HandlePositionModify(line);
  else if (type == "order_pending")
    HandleOrderPending(line);
  else if (type == "order_modify")
    HandleOrderModify(line);
  else if (type == "order_delete")
    HandleOrderDelete(line);
  else if (type == "subscribe")
    ApplySubscribe(JsonArray(line, "symbols"));
  else if (type == "backfill")
  {
    string sym = JsonStr(line, "symbol");
    string tf = JsonStr(line, "tf");
    int count = (int)JsonInt(line, "count");
    int pos = (int)JsonInt(line, "pos");
    long before = JsonInt(line, "before");
    if (tf == "TD")
      TickHistory(sym, count, before); // lich su tick cho CVD "1 tick": count = so nen M1
    else
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

// Co giao dich xay ra (mo/dong/sua lenh, tu MT5 hay tay): gui lai vi the + deal ngay lan OnTimer ke tiep
void OnTradeTransaction(const MqlTradeTransaction &trans, const MqlTradeRequest &request, const MqlTradeResult &result)
{
  g_lastTradeSig = "";
  if (trans.type == TRADE_TRANSACTION_DEAL_ADD || trans.type == TRADE_TRANSACTION_HISTORY_ADD)
    g_dealsDirty = true;
}

void OnTimer()
{
  if (!EnsureConnected())
    return;
  PumpRx();
  PumpTicks();
  PostTrade(false);
  ulong nowMs = GetTickCount64();
  if ((g_dealsDirty && nowMs - g_lastDealsMs >= 1000) || nowMs - g_lastDealsMs >= 60000)
    PostDeals();
  if (SendCalendar)
  {
    ulong calDue = g_calendarOk ? (ulong)CalendarRefreshSec * 1000 : 30000;
    if (g_lastCalendarMs == 0 || nowMs - g_lastCalendarMs >= calDue)
      PostCalendar();
  }
  // Heartbeat: chua subscribe symbol nao thi khong co gi de gui -> khong bao gio phat
  // hien socket da chet. Ping dinh ky de SendLine that bai -> tu reconnect.
  ulong now = GetTickCount64();
  if (g_sock != INVALID_HANDLE && now - g_lastPingMs >= 5000)
  {
    g_lastPingMs = now;
    if (SendLine("{\"type\":\"ping\"}"))
      PostAccount(); // cùng nhịp heartbeat: số dư luôn mới trong vòng 5s
  }
}
