import { apiFetch } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { toast } from "@/store/toast";
import { memoryFetch } from "./guest";

/** fetch của DrawingSync: user → backend (/me/drawings), khách → bộ nhớ (không gửi gì lên server). Lúc chưa biết là ai
 *  (đang hỏi /auth/me) thì báo lỗi mạng để DrawingSync tự thử lại, tránh ghi nhầm chỗ. */
export const drawingsFetch: typeof fetch = (input, init) => {
  const { status } = useAuthStore.getState();
  if (status === "user") return apiFetch(input, init);
  if (status === "guest") return memoryFetch(input, init);
  return Promise.reject(new TypeError("Chưa biết trạng thái đăng nhập"));
};

let told = false;

/** Lần vẽ đầu tiên của khách trong phiên: nhắc đăng nhập để lưu, không chặn thao tác. */
export function noteGuestDrawing() {
  const s = useAuthStore.getState();
  if (told || s.status !== "guest") return;
  told = true;
  toast("Đăng nhập để lưu hình vẽ", {
    action: { label: "Sign in", run: () => s.openAuth("login", "Đăng nhập để lưu hình vẽ") },
    ms: 7000,
  });
}
