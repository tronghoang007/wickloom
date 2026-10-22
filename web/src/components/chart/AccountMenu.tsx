"use client";

import { useAuthStore } from "@/store/auth";
import { toast } from "@/store/toast";
import { useState } from "react";
import AccountSettings from "../auth/AccountSettings";
import Avatar from "../auth/Avatar";

const item = "flex w-full items-center px-4 py-2 text-left text-sm hover:bg-[var(--hover)]";

/** Avatar góc trên trái: người dùng Wickloom. Khách → mời đăng nhập; đã login → tên/email, Account settings, Sign out.
 *  (Khối "Trading accounts" MT5 + huy hiệu Real/Demo thêm ở phase U5.) */
export default function AccountMenu() {
  const { status, user, hint, expired, openAuth } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);

  const shownName = user?.name ?? (status === "loading" ? hint : null);
  const title = expired
    ? "Phiên hết hạn — bấm để đăng nhập lại"
    : user
      ? `${user.name} (${user.email})`
      : status === "guest"
        ? "Guest — bấm để đăng nhập"
        : "Wickloom";

  const signOut = async () => {
    setBusy(true);
    try {
      await useAuthStore.getState().logout();
      setOpen(false);
    } catch {
      toast("Không đăng xuất được: backend không trả lời");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        className="relative flex h-[38px] w-[38px] items-center justify-center rounded-full hover:bg-[var(--hover)]"
        title={title}
        aria-label="Account"
        onClick={() => (expired ? openAuth("login", "Phiên đăng nhập hết hạn — đăng nhập lại để tiếp tục lưu") : setOpen(!open))}
      >
        <Avatar name={shownName} id={user?.id} />
        {expired && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-[var(--bg)] bg-[#f23645]" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-1 top-10 z-40 w-[280px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--bg)] shadow-xl">
            {user ? (
              <>
                <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                  <Avatar name={user.name} id={user.id} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{user.name}</div>
                    <div className="truncate text-xs text-[var(--muted)]">{user.email}</div>
                  </div>
                </div>
                <button className={item} onClick={() => { setOpen(false); setSettings(true); }}>
                  Account settings…
                </button>
                <button className={item} disabled={busy} onClick={signOut}>
                  Sign out
                </button>
              </>
            ) : (
              <div className="px-4 py-3">
                <div className="text-sm font-semibold">Guest</div>
                <div className="mt-1 text-[13px] text-[var(--muted)]">Đăng nhập để lưu layout, watchlist và trade.</div>
                <div className="mt-3 flex gap-2">
                  <button className="h-9 flex-1 rounded bg-[var(--accent)] text-sm font-semibold text-white hover:brightness-110" onClick={() => { setOpen(false); openAuth("login"); }}>
                    Sign in
                  </button>
                  <button className="h-9 flex-1 rounded border border-[var(--border)] text-sm hover:bg-[var(--hover)]" onClick={() => { setOpen(false); openAuth("register"); }}>
                    Create account
                  </button>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      {settings && <AccountSettings onClose={() => setSettings(false)} />}
    </div>
  );
}
