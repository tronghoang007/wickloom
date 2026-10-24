// Phân loại symbol MT5 → icon vẽ (docs: lấy theo kiểu TradingView): cặp forex = hai lá cờ chồng nhau, crypto = đồng coin màu thương hiệu, kim loại = thỏi màu theo kim loại,
// dầu / khí = biểu tượng riêng, chỉ số = cờ nước, cổ phiếu = chữ cái mã. Hàm thuần (không React) để test được; `components/SymbolIcon.tsx` vẽ.

export type Glyph =
  | { t: "flag"; code: string } // code cờ: US, EU, GB, JP... (xem components/flags.tsx)
  | { t: "coin"; sym: string }
  | { t: "metal"; m: string } // XAU, XAG, XPT, XPD, XCU...
  | { t: "oil"; brent: boolean }
  | { t: "gas" }
  | { t: "dxy" }
  | { t: "text"; text: string; color: string };

/** `base` vẽ ở góc trên trái; có `quote` thì vẽ thêm một vòng nhỏ chồng ở góc dưới phải (cặp tiền). */
export type IconSpec = { base: Glyph; quote?: Glyph };

/** Mã tiền → mã cờ. Tiền không có trong bảng thì vẽ huy hiệu chữ 3 ký tự. */
export const CURRENCY_FLAG: Record<string, string> = {
  USD: "US", EUR: "EU", GBP: "GB", JPY: "JP", AUD: "AU", NZD: "NZ", CAD: "CA", CHF: "CH", CNH: "CN", CNY: "CN", HKD: "HK", SGD: "SG", SEK: "SE", NOK: "NO", DKK: "DK",
  PLN: "PL", CZK: "CZ", HUF: "HU", TRY: "TR", ZAR: "ZA", MXN: "MX", ILS: "IL", INR: "IN", THB: "TH", RUB: "RU", RUR: "RU", BRL: "BR", KRW: "KR", TWD: "TW", BWP: "BW",
  IDR: "ID", AED: "AE", EGP: "EG", ARS: "AR", COP: "CO", UAH: "UA", PHP: "PH", VND: "VN", NGN: "NG", RON: "RO", BGN: "BG", ISK: "IS", MAD: "MA", TND: "TN",
};

const INDEX_FLAG: [RegExp, string][] = [
  [/^AUS/, "AU"], [/^DE/, "DE"], [/^FR/, "FR"], [/^HK/, "HK"], [/^IN\d/, "IN"], [/^JP/, "JP"], [/^(STOXX|EU)/, "EU"], [/^UK/, "GB"], [/^US/, "US"], [/^ES/, "ES"], [/^IT/, "IT"],
  [/^NL/, "NL"], [/^CH\d/, "CH"], [/^CN/, "CN"], [/^SG/, "SG"],
];

const METALS = ["XAU", "XAG", "XPT", "XPD", "XCU", "XAL", "XNI", "XPB", "XZN"];

// Đồng coin hay gặp: màu thương hiệu + ký hiệu trong vòng tròn (không có thì vẽ chữ đầu của mã trên nền màu băm từ mã)
export const COINS: Record<string, { color: string; glyph: string }> = {
  BTC: { color: "#f7931a", glyph: "₿" }, ETH: { color: "#627eea", glyph: "Ξ" }, XRP: { color: "#23292f", glyph: "X" }, LTC: { color: "#345d9d", glyph: "Ł" }, BCH: { color: "#8dc351", glyph: "₿" },
  DOGE: { color: "#c2a633", glyph: "Ð" }, ADA: { color: "#0033ad", glyph: "₳" }, DOT: { color: "#e6007a", glyph: "●" }, SOL: { color: "#0f0f14", glyph: "S" }, LINK: { color: "#2a5ada", glyph: "L" },
  BNB: { color: "#f3ba2f", glyph: "B" }, UNI: { color: "#ff007a", glyph: "U" }, MATIC: { color: "#8247e5", glyph: "M" }, AAVE: { color: "#b6509e", glyph: "A" }, XTZ: { color: "#2c7df7", glyph: "ꜩ" },
  USDT: { color: "#26a17b", glyph: "₮" }, SNX: { color: "#00d1ff", glyph: "S" }, COMP: { color: "#00d395", glyph: "C" }, MANA: { color: "#ff2d55", glyph: "M" }, ENJ: { color: "#624dbf", glyph: "E" },
  FIL: { color: "#0090ff", glyph: "F" }, THETA: { color: "#2ab8e6", glyph: "Θ" }, HBAR: { color: "#222222", glyph: "ℏ" }, CAKE: { color: "#d1884f", glyph: "C" }, BAT: { color: "#ff5000", glyph: "B" },
  "1INCH": { color: "#1b314f", glyph: "1" }, IOST: { color: "#1c1c1c", glyph: "I" }, HT: { color: "#2da0e6", glyph: "H" },
};
const CRYPTO_QUOTES = ["USDT", "USD", "BTC", "ETH", "EUR", "GBP", "AUD", "JPY", "THB", "ZAR", "CNH", "XAU", "XAG"];

// Màu thương hiệu cổ phiếu hay gặp (không có thì băm từ mã)
const STOCK_COLOR: Record<string, string> = {
  AAPL: "#7d8590", AMZN: "#ff9900", GOOGL: "#4285f4", GOOG: "#4285f4", MSFT: "#00a4ef", TSLA: "#cc0000", NFLX: "#e50914", FB: "#1877f2", META: "#1877f2", NVDA: "#76b900", AMD: "#ed1c24",
  INTC: "#0071c5", IBM: "#1f70c1", ADBE: "#fa0f00", BABA: "#ff6a00", BIDU: "#2932e1", JPM: "#117aca", BAC: "#e31837", C: "#056dae", KO: "#f40009", MCD: "#ffc72c", DIS: "#113ccf",
  NKE: "#f36e21", V: "#1a1f71", MA: "#eb001b", PYPL: "#003087", UBER: "#222222", F: "#0b5fff", GM: "#0170ce", BA: "#1d439c", T: "#00a8e0", VZ: "#cd040b", XOM: "#ed1b2d", PFE: "#0093d0",
};

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
/** Màu nền ổn định theo chuỗi (cùng mã luôn cùng màu). */
export const hashColor = (s: string) => `hsl(${hash(s) % 360} 52% 42%)`;

/** Bỏ hậu tố của sàn: "m" thường cuối tên (Exness: EURUSDm, AAPLm), "_x10"/"_x100" (hợp đồng nhân) và "247". */
export function baseName(name: string): string {
  const n = /^.+m$/.test(name) ? name.slice(0, -1) : name;
  return n.replace(/(_x\d+|247)$/i, "");
}

function currencyGlyph(code: string): Glyph {
  if (METALS.includes(code)) return { t: "metal", m: code };
  const flag = CURRENCY_FLAG[code];
  if (flag) return { t: "flag", code: flag };
  if (COINS[code]) return { t: "coin", sym: code };
  return { t: "text", text: code, color: hashColor(code) };
}

/** Tách "BTCUSD" → {base:"BTC", quote:"USD"} theo các đồng định giá hay gặp của crypto; null nếu không có hậu tố đó. */
function splitCrypto(core: string): { base: string; quote: string } | null {
  const quote = CRYPTO_QUOTES.find((q) => core.length > q.length && core.endsWith(q));
  return quote ? { base: core.slice(0, -quote.length), quote } : null;
}

// Cặp crypto/USD(T) chỉ vẽ đồng coin (như TV); định giá bằng đồng khác (BTCJPY, ETHBTC, BTCXAU) thì thêm vòng nhỏ của đồng đó
function cryptoSpec(core: string): IconSpec {
  const sp = splitCrypto(core);
  const coin: Glyph = { t: "coin", sym: sp ? sp.base : core };
  return sp && sp.quote !== "USD" && sp.quote !== "USDT" ? { base: coin, quote: currencyGlyph(sp.quote) } : { base: coin };
}

const INDEX_NAME = /^(US(TEC|30|500)|UK100|DE\d\d|FR40|HK50|JP225|AUS200|IN50|STOXX50|ES35|IT40|NL25|CH20|CN50|SG30)$/;

/** Icon của một symbol. `type` (forex / stocks / crypto / index / other / metal) chỉ dùng khi tên không đủ để nhận ra. */
export function iconSpec(name: string, type?: string): IconSpec {
  const core = baseName(name);
  if (core === "DXY") return { base: { t: "dxy" } };
  const metal = /^(X(?:AU|AG|PT|PD|CU|AL|NI|PB|ZN))[A-Z]{0,3}$/.exec(core);
  if (metal && type !== "stocks") return { base: { t: "metal", m: metal[1] } };
  if (/^(USOIL|UKOIL|WTI|BRENT)/.test(core)) return { base: { t: "oil", brent: /^(UKOIL|BRENT)/.test(core) } };
  if (/^XNG/.test(core) && type !== "stocks") return { base: { t: "gas" } };
  if (type === "index" || INDEX_NAME.test(core)) {
    const hit = INDEX_FLAG.find(([re]) => re.test(core));
    if (hit) return { base: { t: "flag", code: hit[1] } };
  }
  const sp = splitCrypto(core);
  if (type === "crypto" || (type !== "stocks" && sp && COINS[sp.base])) return cryptoSpec(core);
  if (type !== "stocks" && /^[A-Z]{6}$/.test(core)) return { base: currencyGlyph(core.slice(0, 3)), quote: currencyGlyph(core.slice(3)) };
  return { base: { t: "text", text: core.slice(0, 2).toUpperCase(), color: STOCK_COLOR[core] ?? hashColor(core) } };
}

// Đồng tiền "của" một symbol: lịch kinh tế trên chart chỉ hiện sự kiện của các đồng này (như TV hiện theo quốc gia của symbol).
const INDEX_CURRENCY: Record<string, string> = { US: "USD", GB: "GBP", DE: "EUR", FR: "EUR", ES: "EUR", IT: "EUR", NL: "EUR", EU: "EUR", JP: "JPY", AU: "AUD", HK: "HKD", IN: "INR", CH: "CHF", CN: "CNY", SG: "SGD" };
const isCurrency = (c: string) => c in CURRENCY_FLAG;

export function symbolCurrencies(name: string, type?: string): string[] {
  const core = baseName(name);
  const { base, quote } = iconSpec(name, type);
  if (base.t === "flag" && !quote) return [INDEX_CURRENCY[base.code] ?? "USD"]; // chỉ số: tiền của nước đó
  if (base.t === "metal") return [isCurrency(core.slice(3)) ? core.slice(3) : "USD"]; // XAUEUR → EUR; XAUUSD → USD
  if (base.t === "coin") return [quote && isCurrency(core.slice(-3)) ? core.slice(-3) : "USD"]; // BTCJPY → JPY; BTCUSD / ETHBTC → USD
  if (quote) {
    const pair = [core.slice(0, 3), core.slice(3)].filter(isCurrency); // cặp forex: cả hai đồng
    return pair.length > 0 ? pair : ["USD"];
  }
  return ["USD"]; // dầu, khí, chỉ số đô la, cổ phiếu
}
