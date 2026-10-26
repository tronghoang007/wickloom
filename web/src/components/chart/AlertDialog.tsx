"use client";

import {
  ALERT_TFS,
  COND_OPTIONS,
  EXPIRY_OPTIONS,
  MAX_LIVE,
  MAX_MESSAGE,
  MAX_NAME,
  TRIGGER_HINT,
  TRIGGER_OPTIONS,
  checkForm,
  defaultForm,
  describe,
  fmtLevel,
  formFromAlert,
  liveCount,
  needsTf,
  type AlertForm,
} from "@/alerts/model";
import { condsFor, spanText } from "@/alerts/drawingSpec";
import { digitsOf, openAlertSettings, useAlertDialog, useAlertPrefs, useAlertStore } from "@/alerts/store";
import type { AlertChannels, AlertPatch, ChannelsInfo } from "@/lib/alertsApi";
import { chartGlobal } from "@/store/chart";
import { toast } from "@/store/toast";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Close } from "../icons";

const input = "h-9 w-full rounded border border-[var(--border)] bg-transparent px-3 text-sm outline-none focus:border-[var(--accent)] disabled:opacity-55";
const errCls = "mt-1 text-[12px] text-[#f23645]";

function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-3">
      <label className="mb-1 block text-[12px] font-medium text-[var(--muted)]">{label}</label>
      {children}
      {error ? <div className={errCls}>{error}</div> : hint ? <div className="mt-1 text-[12px] text-[var(--muted)]">{hint}</div> : null}
    </div>
  );
}

/** Dòng trạng thái dưới mỗi kênh thông báo: kênh dùng được hay chưa và vì sao. */
function channelNote(kind: keyof AlertChannels, info: ChannelsInfo | null): { note: string; blocked: boolean; warn: boolean; settings?: boolean } {
  if (kind === "web") return { note: "Toast, âm báo và thông báo trình duyệt khi còn tab Wickloom mở.", blocked: false, warn: false };
  if (!info) return { note: "", blocked: false, warn: false };
  if (kind === "telegram") {
    if (!info.telegram.configured) return { note: "Backend chưa có WICKLOOM_TG_BOT_TOKEN.", blocked: true, warn: true };
    if (!info.telegram.linked) return { note: "Chưa kết nối Telegram.", blocked: true, warn: true, settings: true };
    return { note: info.telegram.name ? `Đã kết nối (${info.telegram.name}).` : "Đã kết nối.", blocked: false, warn: false };
  }
  const m = info.mt5;
  if (!m.online) return { note: "EA đang offline: tin sẽ bị bỏ nếu lúc nổ vẫn offline.", blocked: false, warn: true };
  if (!m.supports) return { note: "EA cần bản 2.19 trở lên (biên dịch lại TVBridge bằng F7).", blocked: false, warn: true };
  if (m.push_enabled === false) return { note: "MT5 chưa bật Push Notifications (Tools → Options → Notifications).", blocked: false, warn: true };
  return { note: "Đẩy sang điện thoại qua MetaQuotes ID đã nhập trong MT5.", blocked: false, warn: false };
}

/** Hộp thoại tạo / sửa alert kiểu TradingView (docs/alerts-plan.md 5.5). Mở bằng `openCreateAlert` / `openEditAlert`. */
export default function AlertDialog() {
  const seed = useAlertDialog((s) => s.seed);
  const editing = useAlertDialog((s) => s.editing);
  if (!seed && !editing) return null;
  return <Form key={editing?.id ?? `new:${seed?.symbol}:${seed?.price}`} />;
}

function Form() {
  const seed = useAlertDialog((s) => s.seed);
  const editing = useAlertDialog((s) => s.editing);
  const close = useAlertDialog((s) => s.close);
  const info = useAlertStore((s) => s.channels);
  const alerts = useAlertStore((s) => s.alerts);
  const symbols = chartGlobal((s) => s.symbols);
  const prefs = useAlertPrefs((s) => s.channels);
  const [f, setF] = useState<AlertForm>(() => (editing ? formFromAlert(editing) : defaultForm(seed!.symbol, seed!.price, seed!.tf, prefs, digitsOf(seed!.symbol), seed!.drawing ?? null)));
  const now = seed?.now ?? null; // mức / dải giá hiện tại của hình (chỉ có khi vừa mở từ hình vẽ)
  const conds = COND_OPTIONS.filter((o) => condsFor(f.drawing).includes(o.value));
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [tried, setTried] = useState(false);
  const levelRef = useRef<HTMLInputElement>(null);
  const names = useMemo(() => symbols.map((s) => s.name), [symbols]);
  const [openedAt] = useState(() => Date.now() / 1000); // mốc để báo lỗi hạn trong lúc nhập; lúc bấm Create tính lại bằng giờ thật
  const check = checkForm(f, openedAt, names, info);
  const set = (p: Partial<AlertForm>) => {
    setServerError(null);
    setF((cur) => ({ ...cur, ...p }));
  };
  const full = !editing && liveCount(alerts) >= MAX_LIVE;

  useEffect(() => {
    levelRef.current?.focus();
    levelRef.current?.select();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTried(true);
    const final = checkForm(f, Date.now() / 1000, names, info);
    if (busy || !final.input) return;
    setBusy(true);
    const store = useAlertStore.getState();
    const x = final.input;
    const r = editing
      ? await store.update(editing.id, {
          cond: x.cond, level: x.level, trigger: x.trigger, tf: x.tf, name: x.name, message: x.message, channels: x.channels,
          ...(x.expires_at === null ? { clear_expiry: true } : { expires_at: x.expires_at }),
        } as AlertPatch)
      : await store.create(x);
    setBusy(false);
    if (!r.ok) return setServerError(r.error);
    toast(describe(r.data, digitsOf(r.data.symbol)), { title: editing ? "Alert updated" : "Alert created", kind: "success" });
    close();
  };

  const err = tried ? check.errors : {};
  const shape = f.drawing;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50" onMouseDown={(ev) => ev.target === ev.currentTarget && !busy && close()} onKeyDown={(ev) => ev.key === "Escape" && !busy && close()}>
      <form onSubmit={submit} role="dialog" aria-label={editing ? "Edit alert" : "Create alert"} className="flex max-h-[94vh] w-[480px] max-w-[96vw] flex-col rounded-2xl popup">
        <div className="flex items-center justify-between px-5 pb-1 pt-4">
          <span className="text-lg font-semibold">{editing ? `Edit alert on ${shape?.label ?? editing.symbol}` : `Create alert on ${shape?.label ?? (f.symbol || "…")}`}</span>
          <button type="button" className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)]" onClick={close} aria-label="Close">
            <Close size={22} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2 pt-3">
          <Field label="Symbol" error={err.symbol}>
            <input list="alert-symbols" value={f.symbol} disabled={!!editing || !!shape} onChange={(ev) => set({ symbol: ev.target.value })} className={input} autoComplete="off" />
            <datalist id="alert-symbols">
              {names.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </Field>
          <div className="flex gap-3">
            <div className="w-1/2">
              <Field label="Condition">
                <select value={f.cond} onChange={(ev) => set({ cond: ev.target.value as AlertForm["cond"] })} className={`${input} bg-[var(--bg)]`}>
                  {conds.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="w-1/2">
              {shape ? (
                <Field label="Level" error={err.drawing}>
                  <div className="flex h-9 items-center rounded border border-[var(--border)] px-3 text-sm text-[var(--muted)]" title="Mức giá do hình vẽ quyết định, đổi theo từng nến">
                    {now ? spanText(now.lo, now.hi, (v) => fmtLevel(v, digitsOf(f.symbol))) : "theo hình vẽ"}
                  </div>
                </Field>
              ) : (
                <Field label="Value" error={err.level}>
                  <input ref={levelRef} value={f.level} inputMode="decimal" onChange={(ev) => set({ level: ev.target.value })} className={input} />
                </Field>
              )}
            </div>
          </div>
          {shape && (
            <div className="-mt-1 mb-3 text-[12px] text-[var(--muted)]">
              {shape.id === null
                ? "Hình vẽ đã bị xoá: alert chạy tiếp với toạ độ cuối của hình."
                : `Alert đi theo hình vẽ (kéo hình là alert theo), đánh giá trên nến ${f.tf} ở giá của hình tại nến hiện tại. ${shape.ext === "none" && shape.pts.length > 1 ? "Hình không kéo dài sang phải nên alert hết hiệu lực khi qua điểm cuối." : ""}`}
            </div>
          )}
          {(f.cond === "gt" || f.cond === "lt" || f.cond === "inside" || f.cond === "outside") && (
            <div className="-mt-1 mb-3 text-[12px] text-[var(--muted)]">Điều kiện kiểu trạng thái: nổ ngay khi giá đang thoả mãn.</div>
          )}
          <div className="flex gap-3">
            <div className={needsTf(f.trigger) && !shape ? "w-1/2" : "w-full"}>
              <Field label="Trigger" hint={TRIGGER_HINT[f.trigger]}>
                <select value={f.trigger} onChange={(ev) => set({ trigger: ev.target.value as AlertForm["trigger"] })} className={`${input} bg-[var(--bg)]`}>
                  {TRIGGER_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            {needsTf(f.trigger) && !shape && (
              <div className="w-1/2">
                <Field label="Timeframe">
                  <select value={f.tf} onChange={(ev) => set({ tf: ev.target.value })} className={`${input} bg-[var(--bg)]`}>
                    {ALERT_TFS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
            )}
          </div>
          <Field label="Expiration" error={err.expiry}>
            <div className="flex gap-3">
              <select value={f.expiry} onChange={(ev) => set({ expiry: ev.target.value as AlertForm["expiry"] })} className={`${input} bg-[var(--bg)] ${f.expiry === "custom" ? "w-1/2" : ""}`}>
                {EXPIRY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              {f.expiry === "custom" && <input type="datetime-local" value={f.expiresAt} onChange={(ev) => set({ expiresAt: ev.target.value })} className={`${input} w-1/2`} />}
            </div>
          </Field>
          <Field label="Name (optional)" error={err.name}>
            <input value={f.name} maxLength={MAX_NAME + 20} onChange={(ev) => set({ name: ev.target.value })} className={input} placeholder="Tiêu đề của thông báo" />
          </Field>
          <Field label={`Message (optional) · ${f.message.length}/${MAX_MESSAGE}`} error={err.message}>
            <textarea value={f.message} rows={2} onChange={(ev) => set({ message: ev.target.value })} className={`${input} h-auto resize-none py-2`} />
          </Field>
          <Field label="Notify via" error={err.channels}>
            {(["web", "telegram", "mt5"] as const).map((k) => {
              const n = channelNote(k, info);
              return (
                <label key={k} className={`mb-1.5 flex items-start gap-2 ${n.blocked && !f.channels[k] ? "opacity-70" : ""}`}>
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 accent-[var(--accent)]"
                    checked={f.channels[k]}
                    disabled={n.blocked && !f.channels[k]}
                    onChange={(ev) => set({ channels: { ...f.channels, [k]: ev.target.checked } })}
                  />
                  <span className="min-w-0 text-sm">
                    {k === "web" ? "Web (this browser)" : k === "telegram" ? "Telegram" : "MT5 mobile push"}
                    {n.note && (
                      <span className={`block text-[12px] ${n.warn ? "text-[#ff9800]" : "text-[var(--muted)]"}`}>
                        {n.note}
                        {n.settings && (
                          <button
                            type="button"
                            className="ml-1 text-[var(--accent-text)] hover:underline"
                            onClick={() => {
                              close();
                              openAlertSettings();
                            }}
                          >
                            Mở Settings → Alerts
                          </button>
                        )}
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </Field>
          {full && <div className={errCls}>Đã đủ {MAX_LIVE} alert đang chạy — xoá bớt rồi tạo tiếp.</div>}
          {serverError && <div className={errCls}>{serverError}</div>}
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4 pt-2">
          <button type="button" className="h-9 rounded border border-[var(--border)] px-4 text-sm hover:bg-[var(--hover)]" onClick={close}>
            Cancel
          </button>
          <button type="submit" disabled={busy || full} className="h-9 rounded bg-[var(--fg)] px-5 text-sm font-medium text-[var(--bg)] hover:opacity-90 disabled:opacity-55">
            {editing ? "Save" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}
