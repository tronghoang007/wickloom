"use client";

import { appSession } from "@/store/appSession";
import { useAuthStore } from "@/store/auth";
import { useLayoutStore } from "@/store/layout";
import { useSessionStore } from "@/store/layoutSession";
import { useEffect, useState } from "react";
import { Chevron } from "../icons";
import PromptDialog from "./PromptDialog";

type Ask = { kind: "rename" | "copy" | "create" | "delete" } | null;
const item = "flex w-full items-center justify-between gap-6 px-4 py-2 text-left text-sm hover:bg-[var(--hover)]";

/** Khối tên layout + trạng thái lưu + menu (Save, Rename, Make a copy, Create new, Open, Delete) bên phải toolbar; Ctrl+S. */
export default function LayoutBar() {
  const name = useLayoutStore((s) => s.name);
  const layoutId = useLayoutStore((s) => s.layoutId);
  const saveState = useSessionStore((s) => s.saveState);
  const authStatus = useAuthStore((s) => s.status);
  const expired = useAuthStore((s) => s.expired);
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState<Ask>(null);

  // Ctrl/⌘+S = lưu layout ngay (khách: mời đăng nhập)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void appSession().save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const status = (() => {
    if (authStatus === "loading") return { text: "", accent: false, title: "" };
    if (authStatus === "guest") return { text: "Save", accent: true, title: "Đăng nhập để lưu layout" };
    if (expired || saveState === "expired") return { text: "Phiên hết hạn", accent: true, title: "Đăng nhập lại để tiếp tục lưu" };
    switch (saveState) {
      case "saved": return { text: "Saved", accent: false, title: "Đã lưu" };
      case "saving": return { text: "Saving…", accent: false, title: "Đang lưu" };
      case "error": return { text: "Save", accent: true, title: "Chưa lưu được — bấm để thử lại" };
      case "readonly": return { text: "Read-only", accent: false, title: "Layout từ bản app mới hơn: không ghi đè" };
      default: return { text: "Loading…", accent: false, title: "" };
    }
  })();

  const gated = (reason: string, kind: NonNullable<Ask>["kind"]) => async () => {
    setOpen(false);
    if (await appSession().requireUser(reason)) setAsk({ kind });
  };

  const submit = async (value: string) => {
    const s = appSession();
    if (ask?.kind === "rename") await s.rename(value);
    else if (ask?.kind === "copy") await s.copy(value);
    else if (ask?.kind === "create") await s.create(value);
    else if (ask?.kind === "delete") await s.remove(layoutId);
  };

  return (
    <div className="relative flex items-center">
      <button
        className="mx-1 flex h-[38px] min-w-[64px] flex-col items-start justify-center rounded px-1.5 leading-none hover:bg-[var(--hover)]"
        title={status.title}
        onClick={() => void appSession().save()}
      >
        <span className="max-w-[140px] truncate text-sm font-medium">{name}</span>
        <span className={`text-[10px] ${status.accent ? "text-[var(--accent)]" : "text-[var(--muted)]"}`}>{status.text}</span>
      </button>
      <button className="flex h-[38px] w-6 items-center justify-center rounded hover:bg-[var(--hover)]" title="Layout menu" aria-label="Layout menu" onClick={() => setOpen(!open)}>
        <Chevron />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-10 z-40 min-w-[230px] rounded-lg border border-[var(--border)] bg-[var(--bg)] py-1 shadow-2xl">
            <button className={item} onClick={() => { setOpen(false); void appSession().save(); }}>
              Save <span className="text-xs text-[var(--muted)]">Ctrl S</span>
            </button>
            <div className="my-1 h-px bg-[var(--border)]" />
            <button className={item} onClick={gated("Đăng nhập để đổi tên layout", "rename")}>Rename…</button>
            <button className={item} onClick={gated("Đăng nhập để sao chép layout", "copy")}>Make a copy…</button>
            <button className={item} onClick={gated("Đăng nhập để tạo layout", "create")}>Create new layout…</button>
            <button className={item} onClick={() => { setOpen(false); void appSession().openDialog(); }}>Open layout…</button>
            <div className="my-1 h-px bg-[var(--border)]" />
            <button className={`${item} text-[#f23645]`} onClick={gated("Đăng nhập để xoá layout", "delete")}>Delete layout…</button>
          </div>
        </>
      )}
      {ask?.kind === "rename" && <PromptDialog title="Rename layout" initial={name} confirmLabel="Save" onSubmit={submit} onClose={() => setAsk(null)} />}
      {ask?.kind === "copy" && <PromptDialog title="Make a copy" initial={`${name} (copy)`} confirmLabel="Create" onSubmit={submit} onClose={() => setAsk(null)} />}
      {ask?.kind === "create" && <PromptDialog title="Create new layout" initial="Unnamed layout" confirmLabel="Create" onSubmit={submit} onClose={() => setAsk(null)} />}
      {ask?.kind === "delete" && (
        <PromptDialog
          title="Delete layout"
          message={`Xoá layout "${name}" và hình vẽ của nó? Không hoàn tác được.`}
          input={false}
          confirmLabel="Delete"
          danger
          onSubmit={submit}
          onClose={() => setAsk(null)}
        />
      )}
    </div>
  );
}
