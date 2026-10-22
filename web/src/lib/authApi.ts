import { apiFetch, errorMessage } from "./api";

export type User = { id: string; email: string; name: string };

/** Lỗi đã có thông báo tiếng Việt, hiển thị thẳng cho người dùng. */
export class AuthError extends Error {
  constructor(message: string, public status: number) {
    super(message);
  }
}

async function post<T>(path: string, body?: unknown, method = "POST"): Promise<T> {
  let res: Response;
  try {
    res = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new AuthError("Không kết nối được backend. Kiểm tra backend đang chạy.", 0);
  }
  if (!res.ok) throw new AuthError(await errorMessage(res), res.status);
  return res.json();
}

export const authLogin = (email: string, password: string) =>
  post<{ user: User }>("/auth/login", { email, password });

export const authRegister = (b: { email: string; password: string; name?: string; claim_legacy?: boolean }) =>
  post<{ user: User; claimed: number }>("/auth/register", b);

export const authLogout = () => post<{ ok: true }>("/auth/logout");
export const authUpdateName = (name: string) => post<{ user: User }>("/auth/me", { name }, "PATCH");
export const authChangePassword = (old: string, next: string) => post<{ ok: true }>("/auth/password", { old, new: next });

export async function authOptions(): Promise<{ allow_register: boolean; claim_legacy: boolean }> {
  try {
    const r = await apiFetch("/auth/options");
    if (r.ok) return r.json();
  } catch {
    /* backend chưa chạy: coi như mặc định */
  }
  return { allow_register: true, claim_legacy: false };
}

/** GET /auth/me: user | null (401 = khách). Ném lỗi khi không gọi được backend để store thử lại. */
export async function authMe(): Promise<User | null> {
  const r = await apiFetch("/auth/me");
  if (r.status === 401) return null;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return (await r.json()).user;
}
