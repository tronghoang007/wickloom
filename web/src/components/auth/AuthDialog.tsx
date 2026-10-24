"use client";

import { AuthError, authOptions } from "@/lib/authApi";
import { useAuthStore, type DialogState } from "@/store/auth";
import { useEffect, useRef, useState } from "react";
import BrandLogo from "../BrandLogo";
import { Close } from "../icons";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const field =
  "h-10 w-full rounded border border-[var(--border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--accent)]";

/** Popup đăng nhập / đăng ký Wickloom. Mở bằng `openAuth` hoặc `requireLogin` (store/auth.ts). */
export default function AuthDialog() {
  const dialog = useAuthStore((s) => s.dialog);
  return dialog ? <Form key={dialog.reason ?? ""} initial={dialog} /> : null;
}

function Form({ initial }: { initial: NonNullable<DialogState> }) {
  const { login, register, closeAuth } = useAuthStore.getState();
  const [mode, setMode] = useState(initial.mode);
  const [email, setEmail] = useState(() => useAuthStore.getState().user?.email ?? "");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [show, setShow] = useState(false);
  const [claimLegacy, setClaimLegacy] = useState(true);
  const [canClaim, setCanClaim] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    alive.current = true;
    emailRef.current?.focus();
    void authOptions().then((o) => alive.current && setCanClaim(o.claim_legacy));
    return () => {
      alive.current = false;
    };
  }, []);

  const creating = mode === "register";
  const valid = EMAIL_RE.test(email.trim()) && (creating ? password.length >= 8 : password.length > 0);

  const close = () => {
    if (!busy) closeAuth();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    try {
      if (creating) await register({ email: email.trim(), password, name: name.trim() || undefined, claim_legacy: canClaim && claimLegacy });
      else await login(email.trim(), password);
    } catch (err) {
      if (alive.current) setError(err instanceof AuthError ? err.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const tab = (m: "login" | "register", label: string) => (
    <button
      type="button"
      onClick={() => {
        setMode(m);
        setError("");
      }}
      className={`flex-1 border-b-2 pb-2 text-sm font-semibold ${mode === m ? "border-[var(--accent)] text-[var(--fg)]" : "border-transparent text-[var(--muted)] hover:text-[var(--fg)]"}`}
    >
      {label}
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <form
        onSubmit={submit}
        className="w-[400px] max-w-[94vw] rounded-2xl popup p-6"
        role="dialog"
        aria-label="Wickloom account"
      >
        <div className="mb-4 flex items-center justify-between">
          <BrandLogo size={28} />
          <button type="button" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={close} aria-label="Close">
            <Close size={24} />
          </button>
        </div>

        <div className="mb-4 flex gap-4">
          {tab("login", "Sign in")}
          {tab("register", "Create account")}
        </div>

        {initial.reason && (
          <div className="mb-4 rounded bg-[var(--hover)] px-3 py-2 text-[13px]">{initial.reason}</div>
        )}

        <label className="mb-1 block text-[13px] text-[var(--muted)]" htmlFor="auth-email">Email</label>
        <input
          id="auth-email"
          ref={emailRef}
          className={field}
          type="email"
          autoComplete="username"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label className="mb-1 mt-3 block text-[13px] text-[var(--muted)]" htmlFor="auth-password">Password</label>
        <div className="relative">
          <input
            id="auth-password"
            className={`${field} pr-14`}
            type={show ? "text" : "password"}
            autoComplete={creating ? "new-password" : "current-password"}
            placeholder={creating ? "Tối thiểu 8 ký tự" : ""}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-2 py-1 text-xs text-[var(--muted)] hover:text-[var(--fg)]"
            onClick={() => setShow(!show)}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>

        {creating && (
          <>
            <label className="mb-1 mt-3 block text-[13px] text-[var(--muted)]" htmlFor="auth-name">Display name (tuỳ chọn)</label>
            <input
              id="auth-name"
              className={field}
              autoComplete="nickname"
              placeholder={email.split("@")[0] || "Tên hiển thị"}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            {canClaim && (
              <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px]">
                <input type="checkbox" className="mt-0.5 h-4 w-4 accent-[var(--accent)]" checked={claimLegacy} onChange={(e) => setClaimLegacy(e.target.checked)} />
                <span>Nhận dữ liệu hiện có trên máy này (watchlist, hình vẽ) vào tài khoản mới</span>
              </label>
            )}
          </>
        )}

        {error && <div className="mt-4 text-[13px] text-[#f23645]" role="alert">{error}</div>}

        <button
          type="submit"
          disabled={!valid || busy}
          className="mt-4 flex h-11 w-full items-center justify-center rounded bg-[var(--accent)] text-sm font-semibold text-white hover:brightness-110 disabled:opacity-55 disabled:hover:brightness-100"
        >
          {busy ? "…" : creating ? "Create account" : "Sign in"}
        </button>

        <div className="mt-3 text-center text-[13px] text-[var(--muted)]">
          {creating ? "Đã có tài khoản? " : "Chưa có tài khoản? "}
          <button type="button" className="text-[var(--accent-text)] hover:underline" onClick={() => { setMode(creating ? "login" : "register"); setError(""); }}>
            {creating ? "Sign in" : "Create account"}
          </button>
        </div>

        <div className="mt-4 border-t border-[var(--border)] pt-3 text-xs text-[var(--muted)]">
          Tài khoản Wickloom chỉ để lưu watchlist, layout, hình vẽ. Account MT5 không cần mật khẩu ở đây.
        </div>
      </form>
    </div>
  );
}
