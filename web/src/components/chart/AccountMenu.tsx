"use client";

import { accountSub, accountTitle, badgeColor, fmtMoney, tradingTooltip } from "@/lib/mt5Format";
import ModeBadge from "./ModeBadge";
import { useAuthStore } from "@/store/auth";
import { startMt5Polling, useMt5Store } from "@/store/mt5";
import { toast } from "@/store/toast";
import { useTradeStore } from "@/trading/store";
import { useEffect, useState } from "react";
import AccountSettings from "../auth/AccountSettings";
import Avatar from "../auth/Avatar";
import EmptyState from "../EmptyState";
import { EmptyPlugI } from "../icons";
import AccountDetails from "./AccountDetails";

const item = "flex w-full items-center px-4 py-2 text-left text-sm hover:bg-[var(--hover)]";

/** Avatar góc trên trái: người dùng Wickloom. Khách → mời đăng nhập; đã login → tên/email, Trading accounts (MT5), Account settings, Sign out.
 *  Huy hiệu góc dưới phải = account MT5 đang cấp dữ liệu: đỏ Real, xanh lá Demo, xám offline (chỉ khi đã đăng nhập). */
export default function AccountMenu() {
  const { status, user, hint, expired, openAuth } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [busy, setBusy] = useState(false);
  const accounts = useMt5Store((s) => s.accounts);
  const loadedAccounts = useMt5Store((s) => s.loaded);

  // Account MT5 chỉ cho user đã đăng nhập (có số dư): hỏi backend định kỳ, đăng xuất thì xoá sạch
  useEffect(() => {
    if (status === "user") return startMt5Polling();
    useMt5Store.getState().clear();
  }, [status]);

  const shownName = user?.name ?? (status === "loading" ? hint : null);
  const title = expired
    ? "Phiên hết hạn — bấm để đăng nhập lại"
    : user
      ? `${user.name} (${user.email})`
      : status === "guest"
        ? "Guest — bấm để đăng nhập"
        : "Wickloom";
  const trading = user ? tradingTooltip(accounts) : "";
  const active = accounts.find((a) => a.active);

  const signOut = async () => {
    setBusy(true);
    try {
      await useAuthStore.getState().logout();
      setOpen(false);
    } catch (err) {
      toast(`Không đăng xuất được: ${err instanceof Error && err.message ? err.message : "backend không trả lời"}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <button
        className={`relative flex h-[38px] w-[38px] items-center justify-center rounded-full hover:bg-[var(--hover)] ${open ? "bg-[var(--hover)]" : ""}`}
        title={trading ? `${title} · ${trading}` : title}
        aria-label="Account"
        onClick={() => (expired ? openAuth("login", "Phiên đăng nhập hết hạn — đăng nhập lại để tiếp tục lưu") : setOpen(!open))}
      >
        <Avatar name={shownName} id={user?.id} />
        {expired && <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full border border-[var(--bg)] bg-[#f23645]" />}
        {user && loadedAccounts && (
          <span
            data-testid="mt5-badge"
            className="absolute bottom-0.5 right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[var(--bg)]"
            style={{ background: badgeColor(active) }}
          />
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-1 top-10 z-40 w-[320px] overflow-hidden rounded-lg popup">
            {user ? (
              <>
                <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
                  <Avatar name={user.name} id={user.id} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{user.name}</div>
                    <div className="truncate text-xs text-[var(--muted)]">{user.email}</div>
                  </div>
                </div>
                <TradingAccounts />
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

/** Khối "TRADING ACCOUNTS (MT5)" trong dropdown. Backend hiện chỉ nhận dữ liệu từ 1 account một lúc nên chưa có nút chuyển. */
function TradingAccounts() {
  const accounts = useMt5Store((s) => s.accounts);
  const loaded = useMt5Store((s) => s.loaded);
  const switchable = useMt5Store((s) => s.switchable);
  const trade = useTradeStore((s) => s.real); // số liệu MT5, kể cả khi panel đang hiện account giả lập của Replay
  return (
    <div className="border-b border-[var(--border)] px-4 py-3">
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)]">Trading accounts (MT5)</div>
      {!loaded && <EmptyState compact>Đang tải…</EmptyState>}
      {loaded && accounts.length === 0 && (
        <EmptyState compact icon={<EmptyPlugI size={28} />}>
          Chưa có account MT5 nào kết nối. Mở MT5 và gắn EA TVBridge.
        </EmptyState>
      )}
      {accounts.map((a) => (
        <div key={a.id} className="py-1" data-testid="mt5-account">
        <div className="flex items-start gap-2">
          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: a.online ? "#089981" : "#787b86" }} title={a.online ? "Online" : "Offline"} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium">{accountTitle(a)}</span>
              <ModeBadge mode={a.mode} />
            </div>
            <div className="break-words text-xs text-[var(--muted)]">{accountSub(a)}</div>
            {a.login === null && <div className="text-xs text-[var(--muted)]">EA cũ — cập nhật TVBridge 2.10 để thấy login và Demo/Real.</div>}
          </div>
          {a.balance !== undefined && (
            <div className="shrink-0 text-right">
              <div className="text-sm tabular-nums">{fmtMoney(a.balance, a.currency)}</div>
              {a.equity !== undefined && a.equity !== a.balance && <div className="text-xs tabular-nums text-[var(--muted)]">Equity {fmtMoney(a.equity, "")}</div>}
            </div>
          )}
        </div>
        {a.active && trade && <AccountDetails data={trade} />}
        </div>
      ))}
      {!switchable && loaded && (
        <div className="mt-2 text-xs text-[var(--muted)]">App nhận dữ liệu từ 1 account MT5 một lúc. Muốn đổi account: đăng nhập account khác trong MT5, EA tự báo lại.</div>
      )}
    </div>
  );
}
