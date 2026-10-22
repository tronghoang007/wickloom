import { apiFetch } from "@/lib/api";

// Khách (chưa đăng nhập) vẫn vẽ bình thường nhưng không gì được gửi lên server: DrawingSync gọi `memoryFetch`
// thay cho fetch, hình vẽ nằm trong Map này - sống qua đổi symbol/khung, mất khi reload trang.
const docs = new Map<string, unknown>();

const key = (input: string | URL | Request) => String(input).split("?")[0];

export const memoryFetch: typeof fetch = async (input, init) => {
  const k = key(input);
  if ((init?.method ?? "GET") === "PUT") {
    docs.set(k, init?.body ? JSON.parse(String(init.body)) : null); // ghi ngay (đồng bộ), trước cả khi Promise resolve
    return new Response("{}");
  }
  return docs.has(k) ? new Response(JSON.stringify({ id: k, data: docs.get(k) })) : new Response("", { status: 404 });
};

export const guestDocs = {
  clear: () => docs.clear(),
  size: () => docs.size,
};

const hasItems = (doc: unknown) => Array.isArray((doc as { items?: unknown })?.items) && (doc as { items: unknown[] }).items.length > 0;

/** Vừa đăng nhập: hình vẽ của khách chuyển lên tài khoản, nhưng chỉ ở symbol mà server CHƯA có gì (server có dữ liệu thì
 *  server thắng - khách đã chọn đăng nhập vào tài khoản có sẵn). Mục nào chuyển lỗi thì giữ lại trong bộ nhớ.
 *  Trả số symbol đã chuyển. */
export async function adoptGuestDrawings(f: typeof fetch = apiFetch): Promise<number> {
  let moved = 0;
  for (const [url, doc] of [...docs]) {
    if (!hasItems(doc)) { docs.delete(url); continue; }
    try {
      const got = await f(url);
      if (got.status === 404) {
        const put = await f(url, { method: "PUT", body: JSON.stringify(doc), headers: { "Content-Type": "application/json" } });
        if (!put.ok) continue;
        moved++;
      } else if (!got.ok) continue;
      docs.delete(url);
    } catch {
      /* giữ lại, lần đăng nhập sau thử tiếp */
    }
  }
  return moved;
}
