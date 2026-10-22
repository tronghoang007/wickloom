import { createLayoutSession, type Session } from "./layoutSession";

let inst: Session | null = null;

/** Phiên layout của app (tạo lười, chỉ chạy ở client vì dùng localStorage). */
export function appSession(): Session {
  if (!inst) {
    inst = createLayoutSession(localStorage, {
      onUnload: (flush) => {
        window.addEventListener("pagehide", flush);
        return () => window.removeEventListener("pagehide", flush);
      },
    });
  }
  return inst;
}
