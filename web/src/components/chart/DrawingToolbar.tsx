"use client";

import {
  toggleFavorite,
  useDrawingStore,
  type CursorMode,
  type MagnetMode,
} from "@/drawings/store";
import { GROUPS, SPEC, type Group } from "@/drawings/tools";
import { useIndicatorStore } from "@/indicators/store";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Eye, FlyoutArrowI, Lock, Magnet, StarI, Stay, Trash } from "../icons";
import { ToolIcon } from "../toolIcons";

const base = "relative flex h-[38px] w-[38px] items-center justify-center rounded";
// Nút nhóm kiểu TradingView: icon 38px giữa cột 52px + vùng mũi tên 11px ở mép phải
// (mũi tên hiện khi hover hoặc khi flyout đang mở). Ngón tay: mũi tên 11px nằm sát icon, chạm trúng cái nào là ngẫu nhiên, nên chạm vào mũi tên làm
// y như chạm icon (useTouchFlyout); chuột bấm mũi tên vẫn mở danh sách như TV.
const wrap = "group relative flex w-full justify-center"; // w-full: cột chỉ rộng 51px (52 trừ viền), w-[52px] làm tràn 1px và hiện thanh cuộn ngang
const arrowBtn = (open: boolean) =>
  `absolute right-0 top-1/2 flex h-[34px] w-[11px] -translate-y-1/2 items-center justify-center rounded-sm text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] ${
    // ẩn bằng opacity (không dùng visibility) để vẫn click/focus được; màn cảm ứng không có hover nên luôn hiện (iPad, user 10-29)
    open ? "bg-[var(--hover)] text-[var(--fg)]" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
  }`;

const LONG_PRESS_MS = 450;
/** Ngón tay trên nút có flyout (iPad, user 10-29: mũi tên 11px "tay to khó bấm"): chạm = `onTouchTap` của click (thường là mở flyout), nhấn giữ = mở
 *  flyout; cú click sau khi nhả tay nhấn giữ bị bỏ để không chọn luôn công cụ. Chuột / bút giữ như TradingView desktop. Trả props gắn vào nút chính. */
function useTouchFlyout(open: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const touched = useRef(false);
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      touched.current = e.pointerType === "touch";
      if (!touched.current) return;
      clear();
      timer.current = setTimeout(() => {
        fired.current = true;
        open();
      }, LONG_PRESS_MS);
    },
    onPointerUp: clear,
    // flyout mở trong lúc giữ thì lớp nền đóng flyout nằm ngay dưới ngón tay: không chặn thì click khi nhả tay rơi vào nó và đóng flyout luôn
    onTouchEnd: (e: React.TouchEvent) => {
      if (fired.current && e.cancelable) e.preventDefault();
    },
    onPointerCancel: clear,
    onPointerLeave: clear,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(), // Android bắn contextmenu khi nhấn giữ
    /** Gọi trong onClick của nút: `f` cho chuột / bàn phím, `onTouchTap` (nếu có) cho cú chạm bằng ngón tay; bỏ cú click ngay sau khi nhấn giữ đã mở flyout. */
    click: (f: () => void, onTouchTap?: () => void) => {
      if (fired.current) {
        fired.current = false;
        return;
      }
      if (touched.current && onTouchTap) onTouchTap();
      else f();
    },
  };
}
const holdCls = "[-webkit-touch-callout:none]"; // iOS: nhấn giữ không hiện bảng xem trước / chép
const cls = (active: boolean) =>
  `${base} ${active ? "bg-[var(--hover)] text-[var(--accent-text)]" : "text-[var(--fg)] hover:bg-[var(--hover)]"}`;

function Flyout({
  rect,
  onClose,
  children,
  width = 330, // đủ cho nhãn dài nhất ("Elliott triple combo wave (W·X·Y·X·Z)") + ngôi sao
}: {
  rect: DOMRect;
  onClose: () => void;
  children: ReactNode;
  width?: number;
}) {
  // Như TV: flyout dính sát cột toolbar, canh theo nút rồi đẩy lên cho vừa màn hình;
  // danh sách dài thì cao tối đa cả cửa sổ.
  const top = Math.max(0, Math.min(rect.top, window.innerHeight - 440));
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div
        className="drawing-flyout fixed z-50 overflow-y-auto rounded-md popup py-1"
        // cao tối đa tới đáy cửa sổ (max-h-screen tính từ top sẽ tràn ra ngoài, mục cuối không cuộn tới được)
        style={{ left: rect.right, top, width, maxHeight: window.innerHeight - top }}
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
      // group/item: flyout nằm trong nút nhóm (cũng là "group") - tên riêng để hover 1 hàng
      // chỉ hiện ngôi sao của hàng đó
      className={`group/item flex h-10 items-center gap-2 px-2.5 text-sm ${spec.disabled ? "opacity-55" : "cursor-pointer hover:bg-[var(--hover)]"}`}
      onClick={() => !spec.disabled && onPick(id)}
      title={spec.disabled ? "Sắp có" : undefined}
    >
      <ToolIcon id={id} />
      <span className="flex-1 truncate">{spec.label}</span>
      {!spec.disabled && (
        // ô 24x24 bo 4px, sao 13x12 như TV (đo trên flyout TV: nút 24, svg 18, sao 13.1x12.4); hover: nền #464646 (≈ fg 22%), sao đã yêu thích sáng trắng
        <button
          className={`-mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-[4px] hover:bg-[color-mix(in_srgb,var(--fg)_22%,transparent)] ${fav ? "text-[var(--fg)] hover:!text-[var(--solid,#f2f2f2)]" : "text-transparent group-hover/item:text-[var(--muted)] pointer-coarse:text-[var(--muted)] hover:!text-[var(--fg)]"}`}
          onClick={(e) => {
            e.stopPropagation();
            toggleFavorite(id);
          }}
          title={fav ? "Remove from favorites" : "Add to favorites"}
        >
          <StarI on={fav} size={17.5} />
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
  const openFlyout = () => setRect(ref.current!.getBoundingClientRect());
  const { click, ...hold } = useTouchFlyout(openFlyout);
  const pick = () => api?.setTool(active ? null : current);
  const touchTap = () => (active ? pick() : openFlyout()); // ngón tay: nhóm đang cầm công cụ thì chạm = bỏ công cụ (như chuột); chưa thì mở danh sách để chọn

  return (
    <div ref={ref} className={wrap}>
      <button
        className={`${cls(active)} ${holdCls}`}
        title={group.label}
        {...hold}
        onClick={() => click(pick, touchTap)}
      >
        <ToolIcon id={current} />
      </button>
      <button
        className={arrowBtn(!!rect)}
        {...hold}
        onClick={() => click(openFlyout, touchTap)}
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
// Có trên TV nhưng chưa làm - hiện disabled để danh sách giống TV
const CURSOR_SOON = [
  { label: "Demonstration", icon: "demo", soon: true },
  { label: "Magic", icon: "magic", soon: true },
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
  const openFlyout = () => setRect(ref.current!.getBoundingClientRect());
  const { click, ...hold } = useTouchFlyout(openFlyout);
  // ngón tay: đang cầm công cụ vẽ thì chạm = về con trỏ (huỷ công cụ); đang ở con trỏ rồi thì mở danh sách kiểu con trỏ
  const touchTap = () => (tool !== null && tool !== "eraser" ? choose(cursor) : openFlyout());

  return (
    <div ref={ref} className={wrap}>
      <button
        className={`${cls(tool === null || tool === "eraser")} ${holdCls}`}
        title="Cursors"
        {...hold}
        onClick={() => click(() => choose(cursor), touchTap)}
      >
        <ToolIcon id={cur.icon} />
      </button>
      <button
        className={arrowBtn(!!rect)}
        {...hold}
        onClick={() => click(openFlyout, touchTap)}
        title="Cursors"
      >
        <FlyoutArrowI />
      </button>
      {rect && (
        <Flyout rect={rect} onClose={() => setRect(null)} width={200}>
          <div className="px-3 pb-1 pt-2 text-[11px] font-semibold tracking-wide text-[var(--muted)]">
            CURSORS
          </div>
          {/* thứ tự như TV: con trỏ, (Demonstration, Magic chưa có), vạch ngăn, Eraser */}
          {[...CURSORS.slice(0, 3), ...CURSOR_SOON, null, CURSORS[3]].map((c, i) =>
            c === null ? (
              <div key={`sep${i}`} className="my-1 h-px bg-[var(--border)]" />
            ) : "soon" in c ? (
              <div key={c.icon} className="flex h-10 items-center gap-2 px-2.5 text-sm opacity-55" title="Sắp có">
                <ToolIcon id={c.icon} /> {c.label}
              </div>
            ) : (
              <div
                key={c.v}
                className={`flex h-10 cursor-pointer items-center gap-2 px-2.5 text-sm hover:bg-[var(--hover)] ${cursor === c.v ? "text-[var(--accent-text)]" : ""}`}
                onClick={() => choose(c.v)}
              >
                <ToolIcon id={c.icon} /> {c.label}
              </div>
            ),
          )}
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

// Như TV: click bật/tắt magnet; mũi tên mở chọn Weak / Strong magnet
function MagnetButton() {
  const { magnet, magnetMode } = useDrawingStore();
  const [rect, setRect] = useState<DOMRect | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const choose = (m: MagnetMode) => {
    useDrawingStore.setState({ magnet: true, magnetMode: m });
    setRect(null);
  };
  const label = magnetMode === "strong" ? "Strong magnet" : "Weak magnet";
  // nam châm: chạm vẫn bật / tắt (danh sách chỉ có Weak / Strong, không tắt được), nhấn giữ hay chạm mũi tên mới mở danh sách
  const openFlyout = () => setRect(ref.current!.getBoundingClientRect());
  const toggle = () => useDrawingStore.setState({ magnet: !magnet });
  const { click, ...hold } = useTouchFlyout(openFlyout);
  return (
    <div ref={ref} className={wrap}>
      <button
        className={`${cls(magnet)} ${holdCls}`}
        title={`${label} (giữ Ctrl/Cmd để đảo tạm thời)`}
        {...hold}
        onClick={() => click(toggle)}
      >
        <Magnet strong={magnetMode === "strong"} />
      </button>
      <button className={arrowBtn(!!rect)} {...hold} onClick={() => click(openFlyout, toggle)} title="Magnet mode">
        <FlyoutArrowI />
      </button>
      {rect && (
        <Flyout rect={rect} onClose={() => setRect(null)} width={200}>
          {(["weak", "strong"] as const).map((m) => (
            <div
              key={m}
              className={`flex h-10 cursor-pointer items-center gap-2 px-2.5 text-sm hover:bg-[var(--hover)] ${magnet && magnetMode === m ? "text-[var(--accent-text)]" : ""}`}
              onClick={() => choose(m)}
            >
              <Magnet strong={m === "strong"} /> {m === "strong" ? "Strong magnet" : "Weak magnet"}
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
  const { tool, stay, lockAll, hideAll, showFavs, api } = useDrawingStore();
  const toolbarRef = useRef<HTMLDivElement>(null);
  const divider = <div className="my-1 h-px w-8 shrink-0 bg-[var(--border)]" />;
  const toggle = (k: "stay" | "lockAll" | "hideAll", v: boolean) =>
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
      className="flex w-[52px] shrink-0 flex-col items-center overflow-y-auto overflow-x-hidden border-r border-[var(--border)] py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
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
      <MagnetButton />
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
        // chọn: ô sáng 34x34 bo 6px như TV (đo từ ảnh TV: ô 34x34, sao 18x18 nét tối); my-0.5 để chiều cao nút vẫn 38 như các nút khác
        className={showFavs ? "relative my-0.5 flex h-[34px] w-[34px] items-center justify-center rounded-md bg-[var(--solid,#f2f2f2)] text-[var(--on-solid,#0f0f0f)]" : cls(false)}
        title="Favorites toolbar"
        aria-pressed={showFavs}
        onClick={() => useDrawingStore.setState({ showFavs: !showFavs })}
      >
        <StarI on={false} />
      </button>
    </div>
  );
}
