"use client";

import { AuthError, authChangePassword } from "@/lib/authApi";
import { useAuthStore } from "@/store/auth";
import { toast } from "@/store/toast";
import { useState } from "react";
import { Close } from "../icons";

const field =
  "h-10 w-full rounded border border-[var(--border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-60";

/** Account settings: tên hiển thị, đổi mật khẩu; email chỉ đọc. Không có xoá tài khoản ở v1. */
export default function AccountSettings({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);
  const [name, setName] = useState(user?.name ?? "");
  const [oldPw, setOldPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!user) return null;

  const wantsPw = oldPw !== "" || newPw !== "";
  const nameChanged = name.trim() !== user.name;
  const canSave = !busy && (nameChanged || (wantsPw && oldPw !== "" && newPw.length >= 8));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError("");
    try {
      if (nameChanged) await useAuthStore.getState().updateName(name.trim());
      if (wantsPw) await authChangePassword(oldPw, newPw);
      toast(wantsPw ? "Đã lưu; mật khẩu mới có hiệu lực, các thiết bị khác phải đăng nhập lại" : "Đã lưu");
      onClose();
    } catch (err) {
      setError(err instanceof AuthError ? err.message : "Có lỗi xảy ra, thử lại sau");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50"
      onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}
      onKeyDown={(e) => e.key === "Escape" && !busy && onClose()}
    >
      <form onSubmit={save} className="w-[400px] max-w-[94vw] rounded-2xl popup p-6">
        <div className="mb-4 flex items-center justify-between">
          <span className="text-xl font-semibold">Account settings</span>
          <button type="button" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={onClose} aria-label="Close">
            <Close size={24} />
          </button>
        </div>

        <label className="mb-1 block text-[13px] text-[var(--muted)]">Email</label>
        <input className={field} value={user.email} disabled readOnly />

        <label className="mb-1 mt-3 block text-[13px] text-[var(--muted)]" htmlFor="acc-name">Display name</label>
        <input id="acc-name" className={field} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />

        <div className="mb-1 mt-5 text-[13px] font-semibold">Đổi mật khẩu</div>
        <input className={field} type="password" autoComplete="current-password" placeholder="Mật khẩu hiện tại" value={oldPw} onChange={(e) => setOldPw(e.target.value)} />
        <input className={`${field} mt-2`} type="password" autoComplete="new-password" placeholder="Mật khẩu mới (tối thiểu 8 ký tự)" value={newPw} onChange={(e) => setNewPw(e.target.value)} />

        {error && <div className="mt-4 text-[13px] text-[#f23645]" role="alert">{error}</div>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="h-10 rounded border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]" onClick={onClose}>Cancel</button>
          <button type="submit" disabled={!canSave} className="h-10 rounded bg-[var(--accent)] px-5 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-55 disabled:hover:brightness-100">
            {busy ? "…" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}
