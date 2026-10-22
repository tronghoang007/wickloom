import { beforeEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.fn();
vi.mock("./api", async (orig) => ({ ...(await orig<typeof import("./api")>()), apiFetch: (...a: unknown[]) => apiFetch(...a) }));

import { sendClosePosition, sendMarketOrder } from "./tradeApi";

const json = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;
const DONE = { ok: true, message: "", retcode: 10009, order: 5, deal: 7, price: 4131.25, volume: 0.1 };

beforeEach(() => {
  apiFetch.mockReset();
});

describe("sendMarketOrder", () => {
  it("POST đúng đường dẫn + body (account id được mã hoá, SL/TP mặc định 0)", async () => {
    apiFetch.mockResolvedValue(json(200, DONE));
    await sendMarketOrder("Exness-MT5Trial17:123", { symbol: "XAUUSDm", side: "buy", volume: 0.1, clientId: "abc12345" });
    const [url, init] = apiFetch.mock.calls[0];
    expect(url).toBe("/accounts/Exness-MT5Trial17%3A123/orders");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ symbol: "XAUUSDm", side: "buy", volume: 0.1, sl: 0, tp: 0, client_id: "abc12345" });
  });

  it("sàn khớp → done/ok kèm giá, deal", async () => {
    apiFetch.mockResolvedValue(json(200, DONE));
    const o = await sendMarketOrder("S:1", { symbol: "X", side: "sell", volume: 1, clientId: "abc12345" });
    expect(o).toEqual({ kind: "done", result: { ok: true, message: "", retcode: 10009, order: 5, deal: 7, price: 4131.25, volume: 0.1, duplicate: false, orderType: "", typeChanged: false } });
  });

  it("sàn từ chối (HTTP 200, ok=false) → done kèm message tiếng Việt", async () => {
    apiFetch.mockResolvedValue(json(200, { ok: false, message: "Không đủ margin", retcode: 10019 }));
    const o = await sendMarketOrder("S:1", { symbol: "X", side: "buy", volume: 1, clientId: "abc12345" });
    expect(o.kind === "done" && o.result.ok === false && o.result.message === "Không đủ margin").toBe(true);
  });

  it("kết quả cũ của cùng cú bấm được đánh dấu duplicate", async () => {
    apiFetch.mockResolvedValue(json(200, { ...DONE, duplicate: true }));
    const o = await sendMarketOrder("S:1", { symbol: "X", side: "buy", volume: 1, clientId: "abc12345" });
    expect(o.kind === "done" && o.result.duplicate).toBe(true);
  });

  it("4xx/5xx trước khi tới sàn → error, lấy detail của backend, không phải 'unknown'", async () => {
    for (const status of [401, 403, 409, 422]) {
      apiFetch.mockResolvedValue(json(status, { detail: "Hiện chỉ giao dịch từ web được trên account demo" }));
      const o = await sendMarketOrder("S:1", { symbol: "X", side: "buy", volume: 1, clientId: "abc12345" });
      expect(o).toEqual({ kind: "error", status, message: "Hiện chỉ giao dịch từ web được trên account demo", unknown: false });
    }
  });

  it("504 (EA không trả lời) → unknown: có thể đã tới sàn", async () => {
    apiFetch.mockResolvedValue(json(504, { detail: "EA không trả lời trong 10s" }));
    expect(await sendMarketOrder("S:1", { symbol: "X", side: "buy", volume: 1, clientId: "abc12345" })).toMatchObject({ kind: "error", status: 504, unknown: true });
  });

  it("mất mạng giữa chừng → unknown, nhắc xem tab Positions", async () => {
    apiFetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const o = await sendMarketOrder("S:1", { symbol: "X", side: "buy", volume: 1, clientId: "abc12345" });
    expect(o).toMatchObject({ kind: "error", status: 0, unknown: true });
    expect(o.kind === "error" && o.message).toMatch(/Positions/);
  });

  it("phản hồi 200 không đọc được → unknown, không coi là thành công", async () => {
    apiFetch.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error("bad json"); } } as unknown as Response);
    expect(await sendMarketOrder("S:1", { symbol: "X", side: "buy", volume: 1, clientId: "abc12345" })).toMatchObject({ kind: "error", unknown: true });
  });

  it("trường lạ/sai kiểu trong phản hồi không làm hỏng kết quả", async () => {
    apiFetch.mockResolvedValue(json(200, { ok: "true", message: 5, retcode: "x", price: null }));
    const o = await sendMarketOrder("S:1", { symbol: "X", side: "buy", volume: 1, clientId: "abc12345" });
    expect(o).toMatchObject({ kind: "done", result: { ok: false, message: "", retcode: 0, price: 0 } }); // ok chỉ đúng khi là boolean true
  });
});

describe("sendClosePosition", () => {
  it("DELETE theo ticket, volume 0 = đóng hết", async () => {
    apiFetch.mockResolvedValue(json(200, DONE));
    await sendClosePosition("S:1", 111);
    expect(apiFetch).toHaveBeenCalledWith("/accounts/S%3A1/positions/111?volume=0", { method: "DELETE" });
    await sendClosePosition("S:1", 222, 0.05);
    expect(apiFetch.mock.calls[1][0]).toBe("/accounts/S%3A1/positions/222?volume=0.05");
  });
});
