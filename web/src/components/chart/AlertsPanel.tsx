"use client";

import { CHANNEL_NAME, describe, failedChannels, sortAlerts, triggerLabel } from "@/alerts/model";
import { digitsOf, openCreateAlert, openEditAlert, useAlertStore } from "@/alerts/store";
import type { Alert, AlertLogRow, ChannelKind } from "@/lib/alertsApi";
import { clockAt, dayLabelAt } from "@/lib/timefmt";
import { useAuthStore } from "@/store/auth";
import { useChartStore } from "@/store/chart";
import { askConfirm } from "@/store/confirm";
import { useRailStore } from "@/store/rail";
import { toast } from "@/store/toast";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import EmptyState from "../EmptyState";
import { AlertI, Close, Plus, Trash } from "../icons";

type Tab = "alerts" | "log";
const STATE_NAME = { active: "Active", paused: "Paused", triggered: "Triggered", expired: "Expired" } as const;
const STATE_COLOR = { active: "var(--accent-text)", paused: "var(--muted)", triggered: "#089981", expired: "var(--muted)" } as const;
const CH_LETTER: Record<ChannelKind, string> = { web: "W", telegram: "T", mt5: "M" };

const iconBtn = "flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]";

function Pencil() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m10.8 2.7 2.5 2.5M2.5 13.5l.6-3L11.5 2.1a1 1 0 0 1 1.4 0l1 1a1 1 0 0 1 0 1.4L5.5 12.9z" />
    </svg>
  );
}
function PlayPause({ paused }: { paused: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paused ? <path d="M5 3.2v9.6l7.5-4.8z" /> : <path d="M5.5 3.5v9M10.5 3.5v9" />}
    </svg>
  );
}

const when = (t: number) => `${dayLabelAt(t)} ${clockAt(t)}`;

function remove(a: Alert) {
  askConfirm({
    title: "Delete alert",
    message: `Xoá alert "${a.name || describe(a, digitsOf(a.symbol))}"?`,
    confirmLabel: "Delete",
    danger: true,
    onConfirm: async () => {
      const r = await useAlertStore.getState().remove(a.id);
      if (!r.ok) toast(r.error, { kind: "error" });
    },
  });
}

async function setState(a: Alert, state: "active" | "paused") {
  const r = await useAlertStore.getState().update(a.id, { state });
  if (!r.ok) toast(r.error, { kind: "error" });
}

function AlertRow({ a }: { a: Alert }) {
  const live = a.state === "active" || a.state === "paused";
  const digits = digitsOf(a.symbol);
  return (
    <div
      className={`group flex items-start gap-2 border-b border-[var(--border)] px-3 py-2.5 text-sm hover:bg-[var(--hover)] ${live ? "" : "opacity-70"}`}
      data-testid="alert-row"
      onClick={() => useChartStore.getState().set({ symbol: a.symbol })}
    >
      <span className="mt-0.5 shrink-0" style={{ color: STATE_COLOR[a.state] }} aria-hidden>
        <AlertI />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium" title={a.name || undefined}>
          {a.name || describe(a, digits)}
        </div>
        <div className="truncate text-[12px] text-[var(--muted)]">
          {a.name ? `${describe(a, digits)} · ` : ""}
          {triggerLabel(a.trigger)}
          {a.trigger === "once_per_bar" || a.trigger === "once_per_bar_close" ? ` ${a.tf}` : ""}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--muted)]">
          <span style={{ color: STATE_COLOR[a.state] }}>{STATE_NAME[a.state]}</span>
          {a.fire_count > 0 && <span>{a.state === "triggered" ? `fired ${when(a.fired_at ?? 0)}` : `${a.fire_count}× · last ${when(a.fired_at ?? 0)}`}</span>}
          {a.expires_at !== null && live && <span>expires {when(a.expires_at)}</span>}
          {a.drawing && a.drawing.id === null && <span title="Hình vẽ đã bị xoá; alert chạy tiếp với toạ độ cuối">drawing deleted</span>}
          <span className="flex gap-1" title={(Object.keys(a.channels) as ChannelKind[]).filter((k) => a.channels[k]).map((k) => CHANNEL_NAME[k]).join(", ")}>
            {(Object.keys(CH_LETTER) as ChannelKind[]).filter((k) => a.channels[k]).map((k) => (
              <span key={k} className="rounded border border-[var(--border)] px-1 text-[10px] leading-4">
                {CH_LETTER[k]}
              </span>
            ))}
          </span>
        </div>
      </div>
      <div className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100" onClick={(e) => e.stopPropagation()}>
        <button className={iconBtn} title={live ? (a.state === "active" ? "Pause" : "Resume") : "Re-activate"} onClick={() => void setState(a, a.state === "active" ? "paused" : "active")}>
          <PlayPause paused={a.state !== "active"} />
        </button>
        <button className={iconBtn} title="Edit" onClick={() => openEditAlert(a)}>
          <Pencil />
        </button>
        <button className={iconBtn} title="Delete" onClick={() => remove(a)}>
          <Trash />
        </button>
      </div>
    </div>
  );
}

function LogRow({ r }: { r: AlertLogRow }) {
  const bad = failedChannels(r.results);
  const what = describe({ ...r, drawing: r.label ? { label: r.label } : null }, digitsOf(r.symbol));
  const keys = Object.keys(r.results) as ChannelKind[];
  return (
    <div className="border-b border-[var(--border)] px-3 py-2.5 text-sm" data-testid="alert-log-row">
      <div className="flex items-baseline justify-between gap-2">
        <span className="min-w-0 truncate font-medium">{r.name || what}</span>
        <span className="shrink-0 text-[12px] tabular-nums text-[var(--muted)]">{when(r.time)}</span>
      </div>
      <div className="truncate text-[12px] text-[var(--muted)]">
        {r.name ? `${what} · ` : ""}price {r.price}
        {r.message ? ` — ${r.message}` : ""}
      </div>
      {keys.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-3 text-[12px]">
          {keys.map((k) => {
            const ok = r.results[k] === "ok";
            const failed = bad.some((b) => b.kind === k);
            return (
              <span key={k} title={ok ? undefined : r.results[k]} className={ok ? "text-[#089981]" : failed ? "text-[#f23645]" : "text-[var(--muted)]"}>
                {ok ? "✓" : failed ? "✗" : "–"} {CHANNEL_NAME[k]}
                {!ok && <span className="text-[var(--muted)]"> · {r.results[k]}</span>}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Danh sách alert + nhật ký ở thanh bên phải. Nhật ký ghi kết quả giao từng kênh nên biết ngay Telegram / MT5 có tới không. */
export default function AlertsPanel() {
  const status = useAuthStore((s) => s.status);
  const alerts = useAlertStore((s) => s.alerts);
  const loaded = useAlertStore((s) => s.loaded);
  const error = useAlertStore((s) => s.error);
  const log = useAlertStore((s) => s.log);
  const logLoaded = useAlertStore((s) => s.logLoaded);
  const [tab, setTab] = useState<Tab>("alerts");
  const rows = useMemo(() => sortAlerts(alerts), [alerts]);

  useEffect(() => {
    if (status === "user" && tab === "log") void useAlertStore.getState().refreshLog();
  }, [status, tab]);

  const head = (body: ReactNode) => (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
        <span className="text-[18px] font-semibold leading-6">Alerts</span>
        <div className="flex items-center gap-1">
          <button className="rounded p-1 hover:bg-[var(--hover)]" title="Create alert (⌥ A)" aria-label="Create alert" onClick={() => void openCreateAlert()}>
            <Plus size={22} />
          </button>
          <button className="rounded p-1 hover:bg-[var(--hover)]" onClick={() => useRailStore.getState().setOpen(null)} aria-label="Close">
            <Close />
          </button>
        </div>
      </div>
      {body}
    </div>
  );

  if (status !== "user")
    return head(
      <EmptyState icon={<AlertI />} className="flex-1">
        {status === "loading" ? "Đang tải…" : "Đăng nhập để tạo và nhận alert."}
        {status === "guest" && (
          <button className="mt-2 block w-full text-[var(--accent-text)] hover:underline" onClick={() => void openCreateAlert()}>
            Đăng nhập
          </button>
        )}
      </EmptyState>,
    );

  return head(
    <>
      <div className="flex gap-1 border-b border-[var(--border)] px-3 py-1.5" role="tablist">
        {(["alerts", "log"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`h-7 rounded px-3 text-sm ${tab === t ? "bg-[var(--hover)] font-medium" : "text-[var(--muted)] hover:bg-[var(--hover)]"}`}
          >
            {t === "alerts" ? `Alerts${rows.length ? ` (${rows.length})` : ""}` : "Log"}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "alerts" ? (
          error && !loaded ? (
            <EmptyState className="h-full">{error}</EmptyState>
          ) : loaded && rows.length === 0 ? (
            <EmptyState icon={<AlertI />} className="h-full">
              Chưa có alert nào. Bấm + (hoặc ⌥ A, hoặc chuột phải vào chart → Add alert) để tạo.
              <span className="mt-2 block text-[12px]">Alert được kiểm tra ở backend nên vẫn nổ khi bạn tắt tab, miễn là backend và MT5 đang chạy.</span>
            </EmptyState>
          ) : (
            rows.map((a) => <AlertRow key={a.id} a={a} />)
          )
        ) : logLoaded && log.length === 0 ? (
          <EmptyState className="h-full">Chưa có alert nào nổ.</EmptyState>
        ) : (
          log.map((r) => <LogRow key={r.id} r={r} />)
        )}
      </div>
    </>,
  );
}
