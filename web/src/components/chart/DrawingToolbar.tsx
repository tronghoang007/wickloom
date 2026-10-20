"use client";

import {
  toggleFavorite,
  useDrawingStore,
  type CursorMode,
} from "@/drawings/store";
import { GROUPS, SPEC, type Group } from "@/drawings/tools";
import { useIndicatorStore } from "@/indicators/store";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, FlyoutArrowI, Lock, Magnet, StarI, Stay, Trash } from "../icons";
import { ToolIcon } from "../toolIcons";

const base = "relative flex h-[38px] w-[38px] items-center justify-center rounded";
// Nút nhóm kiểu TradingView: icon 38px giữa cột 52px + vùng mũi tên 11px ở mép phải
// (mũi tên hiện khi hover hoặc khi flyout đang mở).
const wrap = "group relative flex w-[52px] justify-center";
const arrowBtn = (open: boolean) =>
  `absolute right-0 top-1/2 flex h-[34px] w-[11px] -translate-y-1/2 items-center justify-center rounded-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] ${
    open ? "visible bg-[var(--hover)] text-[var(--fg)]" : "invisible group-hover:visible"
  }`;
const cls = (active: boolean) =>
  `${base} ${active ? "bg-[var(--hover)] text-[var(--accent)]" : "text-[var(--fg)] hover:bg-[var(--hover)]"}`;

function Flyout({
  rect,
  onClose,
  children,
  width = 300,
}: {
  rect: DOMRect;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  const top = Math.max(8, Math.min(rect.top, window.innerHeight - 440));
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="drawing-flyout fixed z-50 max-h-[80vh] overflow-y-auto rounded-md border border-[var(--border)] bg-[var(--bg)] py-1 shadow-2xl"
        style={{ left: rect.right + 6, top, width }}
      >
        {children}
      </div>
    </>
  );
}

function ToolItem({
  id,
  onPick,
}: {
  id: string;
  onPick: (id: string) => void;
}) {
  const spec = SPEC[id];
  const fav = useDrawingStore((s) => s.favorites.includes(id));
  return (
    <div
      className={`group flex items-center gap-3 px-3 py-1.5 text-sm ${spec.disabled ? "opacity-40" : "cursor-pointer hover:bg-[var(--hover)]"}`}
      onClick={() => !spec.disabled && onPick(id)}
      title={spec.disabled ? "Sắp có" : undefined}
    >
      <ToolIcon id={id} />
      <span className="flex-1 truncate">{spec.label}</span>
      {!spec.disabled && (
        <button
          className={`${fav ? "text-[var(--fg)]" : "text-transparent group-hover:text-[var(--muted)]"} hover:!text-[var(--fg)]`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(id);
          }}
          title="Favorites"
        >
          <StarI on={fav} />
        </button>
      )}
    </div>
  );
}

function GroupButton({ group }: { group: Group }) {
  const { tool, api, lastTool } = useDrawingStore();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const ids = group.sections.flatMap((s) => s.ids);
  const current =
    lastTool[group.id] && ids.includes(lastTool[group.id])
      ? lastTool[group.id]
      : group.icon;
  const active = !!tool && ids.includes(tool);

  return (
    <div ref={ref} className={wrap}>
      <button
        className={cls(active)}
        title={group.label}
        onClick={() => api?.setTool(active ? null : current)}
      >
        <ToolIcon id={current} />
      </button>
      <button
        className={arrowBtn(!!rect)}
        onClick={() => setRect(ref.current!.getBoundingClientRect())}
        title={group.label}
      >
        <FlyoutArrowI />
      </button>
      {rect && (
        <Flyout rect={rect} onClose={() => setRect(null)}>
          {group.sections.map((s, i) => (
            <div key={i}>
              {i > 0 && <div className="my-1 h-px bg-[var(--border)]" />}
              {s.title && (
                <div className="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
                  {s.title}
                </div>
              )}
              {s.ids.map((id) => (
                <ToolItem
                  key={id}
                  id={id}
                  onPick={(t) => {
                    api?.setTool(t);
                    setRect(null);
                  }}
                />
              ))}
            </div>
          ))}
        </Flyout>
      )}
    </div>
  );
}
const CURSORS: { v: CursorMode; label: string; icon: string }[] = [
  { v: "cross", label: "Cross", icon: "cross" },
  { v: "dot", label: "Dot", icon: "dotc" },
  { v: "arrow", label: "Arrow", icon: "arrowc" },
  { v: "eraser", label: "Eraser", icon: "eraser" },
];

function CursorButton() {
  const { tool, cursor, api } = useDrawingStore();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const cur = CURSORS.find((c) => c.v === cursor)!;
  const choose = (v: CursorMode) => {
    useDrawingStore.setState({ cursor: v });
    api?.setTool(v === "eraser" ? "eraser" : null);
    setRect(null);
  };

  return (
    <div ref={ref} className={wrap}>
      <button
        className={cls(tool === null || tool === "eraser")}
        title="Cursors"
        onClick={() => choose(cursor)}
      >
        <ToolIcon id={cur.icon} />
      </button>
      <button
        className={arrowBtn(!!rect)}
        onClick={() => setRect(ref.current!.getBoundingClientRect())}
        title="Cursors"
      >
        <FlyoutArrowI />
      </button>
      {rect && (
        <Flyout rect={rect} onClose={() => setRect(null)} width={200}>
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
            CURSORS
          </div>
          {CURSORS.map((c) => (
            <div
              key={c.v}
              className="flex cursor-pointer items-center gap-3 px-3 py-1.5 text-sm hover:bg-[var(--hover)]"
              onClick={() => choose(c.v)}
            >
              <ToolIcon id={c.icon} /> {c.label}
            </div>
          ))}
        </Flyout>
      )}
    </div>
  );
}

const EMOJIS: { title: string; list: string }[] = [
  {
    title: "SMILES & PEOPLE",
    list: "😀😃😄😁😆😅😂🤣😊😇🙂😉😍🥰😘😋😛😜🤪🤓😎🥳😏😒😞😔😟😕🙁😣😖😫😩🥺😢😭😤😠😡🤬🤯😳🥵🥶😱😨😰😥😓🤗🤔🤭🤫😶😐😑😬🙄😯😦😮😲🥱😴🤤😪🤑🤠",
  },
  { title: "GESTURES", list: "👍👎👌✌🤞🤟🤘👈👉👆👇✋🖐👋🤝🙏💪👏🙌" },
  {
    title: "SYMBOLS",
    list: "❤🧡💛💚💙💜🖤💔🔥⭐🌟✨💥💯✅❌⚠❓❗🚀📈📉💰💵💎🎯🏆🔔📌🔒🔑⏰🌙☀⚡🌈",
  },
  {
    title: "ANIMALS",
    list: "🐶🐱🐭🐹🐰🦊🐻🐼🐨🐯🦁🐮🐷🐸🐵🐔🐧🐦🦅🦉🐺🐗🐴🦄🐝🦋🐢🐍🐙🐬🐳🦈🐂🐻‍❄️",
  },
];

function EmojiButton() {
  const { tool, api } = useDrawingStore();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div ref={ref}>
      <button
        className={cls(tool === "emoji")}
        title="Emojis, stickers and icons"
        onClick={() => setRect(ref.current!.getBoundingClientRect())}
      >
        <ToolIcon id="emoji" />
      </button>
      {rect && (
        <Flyout rect={rect} onClose={() => setRect(null)} width={340}>
          <div className="px-3 pb-2 pt-1 text-sm font-semibold">Emojis</div>
          {EMOJIS.map((g) => (
            <div key={g.title} className="px-3 pb-2">
              <div className="pb-1 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
                {g.title}
              </div>
              <div className="flex flex-wrap">
                {Array.from(
                  new Intl.Segmenter(undefined, {
                    granularity: "grapheme",
                  }).segment(g.list),
                  (s) => s.segment,
                ).map((e, i) => (
                  <button
                    key={i}
                    className="h-9 w-9 rounded text-2xl hover:bg-[var(--hover)]"
                    onClick={() => {
                      api?.setTool("emoji", e);
                      setRect(null);
                    }}
                  >
                    {e}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </Flyout>
      )}
    </div>
  );
}

function TrashButton() {
  const api = useDrawingStore((s) => s.api);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const item =
    "block w-full px-3 py-2 text-left text-sm hover:bg-[var(--hover)]";
  return (
    <div ref={ref}>
      <button
        className={cls(false)}
        title="Remove objects"
        onClick={() => setRect(ref.current!.getBoundingClientRect())}
      >
        <Trash />
      </button>
      {rect && (
        <Flyout rect={rect} onClose={() => setRect(null)} width={220}>
          <button
            className={item}
            onClick={() => {
              api?.clearAll();
              setRect(null);
            }}
          >
            Remove drawings
          </button>
          <button
            className={item}
            onClick={() => {
              useIndicatorStore.setState({ list: [] });
              setRect(null);
            }}
          >
            Remove indicators
          </button>
          <button
            className={item}
            onClick={() => {
              api?.clearAll();
              useIndicatorStore.setState({ list: [] });
              setRect(null);
            }}
          >
            Remove all
          </button>
        </Flyout>
      )}
    </div>
  );
}

export default function DrawingToolbar() {
  const { tool, magnet, stay, lockAll, hideAll, showFavs, api } =
    useDrawingStore();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const divider = <div className="my-1 h-px w-8 shrink-0 bg-[var(--border)]" />;
  const toggle = (k: "magnet" | "stay" | "lockAll" | "hideAll", v: boolean) =>
    useDrawingStore.setState({ [k]: !v });

  useEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest(".drawing-flyout")) return;
      e.preventDefault();
      e.stopPropagation();
      const delta =
        e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)
          ? e.deltaX || e.deltaY
          : e.deltaY;
      toolbar.scrollTop += delta;
    };
    toolbar.addEventListener("wheel", onWheel, { passive: false });
    return () => toolbar.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <div
      ref={toolbarRef}
      className="flex w-[52px] shrink-0 flex-col items-center overflow-y-auto overflow-x-visible border-r border-[var(--border)] py-2"
    >
      <CursorButton />
      {divider}
      {GROUPS.map((g) => (
        <GroupButton key={g.id} group={g} />
      ))}
      <EmojiButton />
      {divider}
      <button
        className={cls(tool === "measure")}
        title="Measure"
        onClick={() => api?.setTool(tool === "measure" ? null : "measure")}
      >
        <ToolIcon id="measure" />
      </button>
      <button
        className={cls(tool === "zoom")}
        title="Zoom in"
        onClick={() => api?.setTool(tool === "zoom" ? null : "zoom")}
      >
        <ToolIcon id="zoom" />
      </button>
      {divider}
      <button
        className={cls(magnet)}
        title="Magnet mode"
        onClick={() => toggle("magnet", magnet)}
      >
        <Magnet />
      </button>
      <button
        className={cls(stay)}
        title="Stay in drawing mode"
        onClick={() => toggle("stay", stay)}
      >
        <Stay />
      </button>
      <button
        className={cls(lockAll)}
        title="Lock all drawings"
        onClick={() => toggle("lockAll", lockAll)}
      >
        <Lock open={!lockAll} />
      </button>
      <button
        className={cls(hideAll)}
        title="Hide all drawings"
        onClick={() => toggle("hideAll", hideAll)}
      >
        <Eye off={hideAll} />
      </button>
      {divider}
      <TrashButton />
      <div className="flex-1" />
      <button
        className={cls(showFavs)}
        title="Favorites toolbar"
        onClick={() => useDrawingStore.setState({ showFavs: !showFavs })}
      >
        <StarI on={showFavs} />
      </button>
    </div>
  );
}
