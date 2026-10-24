"use client";

import { useDrawingStore } from "@/drawings/store";
import ColorPicker from "./ColorPicker";
import { POS_DEFAULTS, SPEC } from "@/drawings/tools";
import { visibleOn } from "@/drawings/visibility";
import { useChartStore } from "@/store/chart";
import { useRef, useState, type ReactNode } from "react";
import { AlertI, AnchorI, BucketI, DotsI, Lock, PenI, SettingsI, Svg, TemplatesI, TextColorI, Trash } from "../icons";
import ChartContextMenu from "./ChartContextMenu";
import { drawingMenuItems } from "./drawingMenu";

// Thanh nổi kiểu TradingView: cao 38px, nút 34px với icon 28px, vạch màu 3px dưới icon.
const btn =
  "relative flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded text-[var(--fg)] hover:bg-[var(--hover)] disabled:opacity-55 disabled:hover:bg-transparent";

const Grip = () => (
  <svg
    width="10"
    height="18"
    viewBox="0 0 10 18"
    fill="currentColor"
    opacity="0.4"
  >
    {[3, 9, 15].map((y) =>
      [2, 8].map((x) => <circle key={`${x}${y}`} cx={x} cy={y} r="1" />),
    )}
  </svg>
);

function ColorButton({
  title,
  color,
  onChange,
  children,
}: {
  title: string;
  color: string;
  onChange: (c: string) => void;
  children: ReactNode;
}) {
  return (
    <ColorPicker value={color} onChange={onChange} title={title} className={`${btn} cursor-pointer`}>
      {children}
      <span
        className="absolute bottom-[3px] left-1/2 h-[3px] w-[18px] -translate-x-1/2 rounded-[1px]"
        style={{ background: color }}
      />
    </ColorPicker>
  );
}

const DASH_LABEL = ["Line", "Dashed line", "Dotted line"];
// Mẫu nét; w = độ dày thật (menu độ dày / nút hiện đúng 1-4px)
const dashLine = (dash: number, w = 2) => (
  <svg width="26" height="8" viewBox="0 0 26 8">
    <line
      x1="1"
      y1="4"
      x2="25"
      y2="4"
      stroke="currentColor"
      strokeWidth={w}
      strokeDasharray={dash === 1 ? "6 4" : dash === 2 ? "2 3" : undefined}
    />
  </svg>
);

export default function StylePanel() {
  const { drawings, selectedId, api } = useDrawingStore();
  const [menu, setMenu] = useState<"width" | "dash" | null>(null);
  const [more, setMore] = useState<{ x: number; y: number } | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const tf = useChartStore((s) => s.tf);
  const d = drawings.find((x) => x.id === selectedId);
  // Measure: không có toolbar như TV; hình ẩn ở khung đang xem (Visibility) cũng không
  if (!d || !api || SPEC[d.type]?.ephemeral || !visibleOn(d.visibility, tf)) return null;

  const dash = d.dash ?? 0;
  const isPos = SPEC[d.type]?.panel === "position";
  const isVol = SPEC[d.type]?.panel === "volume";
  const po = { ...POS_DEFAULTS, ...d.opts } as typeof POS_DEFAULTS;
  // Menu thả xuống của nút width / style: dòng đang chọn đảo màu như TV
  const popup = (items: ReactNode) => (
    <div className="absolute left-0 top-[38px] z-40 min-w-[120px] whitespace-nowrap rounded-md border border-[var(--border)] bg-[var(--bg)] py-1 shadow-2xl">
      {items}
    </div>
  );
  const item = (on: boolean) =>
    `flex h-8 w-full items-center gap-2 px-3 text-left text-sm ${on ? "bg-[var(--selected)] text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-[var(--hover)]"}`;

  return (
    <>
      {/* Nền bắt click ngoài để đóng menu: nằm ngoài thanh (thanh có transform nên fixed bên trong không phủ cả màn hình) */}
      {menu && <div className="absolute inset-0 z-[19]" onMouseDown={() => setMenu(null)} />}
      <div
        className="absolute left-1/2 top-12 z-20 flex h-[38px] select-none items-center gap-0.5 rounded-md bg-[var(--panel)] px-0.5 text-[var(--fg)] shadow-[0_2px_4px_rgba(0,0,0,0.4)]"
        style={{ transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` }}
      >
        <div
          className="flex h-[34px] w-4 cursor-grab items-center justify-center touch-none active:cursor-grabbing"
          onPointerDown={(e) => {
            e.preventDefault(); // kéo thanh không bôi đen (select) chữ trên trang
            e.currentTarget.setPointerCapture(e.pointerId);
            dragRef.current = {
              sx: e.clientX,
              sy: e.clientY,
              ox: pos.x,
              oy: pos.y,
            };
          }}
          onPointerMove={(e) => {
            const s = dragRef.current;
            if (!s) return;
            if (e.buttons === 0) {
              dragRef.current = null;
              return;
            }
            setPos({ x: s.ox + e.clientX - s.sx, y: s.oy + e.clientY - s.sy });
          }}
          onPointerUp={() => (dragRef.current = null)}
          onPointerCancel={() => (dragRef.current = null)}
          onLostPointerCapture={() => (dragRef.current = null)}
        >
          <Grip />
        </div>

        <button className={btn} disabled title="Template (sắp có)">
          <TemplatesI />
        </button>

        {/* Table như TV: thêm cột bên phải / hàng bên dưới */}
        {SPEC[d.type]?.grid && (
          <>
            <button className={btn} title="Add column" onClick={() => api.tableAdd("col")}>
              <Svg>
                <rect x="6.5" y="7.5" width="9" height="13" />
                <path d="M20.5 11v6M17.5 14h6" />
              </Svg>
            </button>
            <button className={btn} title="Add row" onClick={() => api.tableAdd("row")}>
              <Svg>
                <rect x="7.5" y="6.5" width="13" height="9" />
                <path d="M14 18.5v5M11.5 21h5" />
              </Svg>
            </button>
          </>
        )}

        {isVol ? null : isPos ? (
          <>
            <ColorButton
              title="Text color"
              color={d.textColor ?? "#ffffff"}
              onChange={(c) => api.update({ textColor: c })}
            >
              <TextColorI />
            </ColorButton>
            <ColorButton
              title="Profit color"
              color={po.profit}
              onChange={(c) => api.update({ opts: { profit: c } })}
            >
              <BucketI />
            </ColorButton>
            <ColorButton
              title="Stop color"
              color={po.stop}
              onChange={(c) => api.update({ opts: { stop: c } })}
            >
              <BucketI />
            </ColorButton>
            <button className={btn} disabled title="Add to chart (sắp có)">
              <Svg>
                <rect x="5.5" y="6.5" width="17" height="12" rx="2" />
                <path d="M9 15l3-3 3 2 4-5M14 21.5v-3" />
              </Svg>
            </button>
          </>
        ) : (
          <>
            <ColorButton
              title="Line color"
              color={d.color}
              onChange={(c) => api.update({ color: c })}
            >
              <PenI />
            </ColorButton>

            <ColorButton
              title="Text color"
              color={d.textColor ?? d.color}
              onChange={(c) => api.update({ textColor: c })}
            >
              <TextColorI />
            </ColorButton>

            <div className="relative">
              <button
                className={`${btn} w-auto gap-1.5 px-1.5 text-[13px]`}
                title="Line width"
                onClick={() => setMenu(menu === "width" ? null : "width")}
              >
                {dashLine(0, d.width)} {d.width}px
              </button>
              {menu === "width" &&
                popup(
                  [1, 2, 3, 4].map((w) => (
                    <button
                      key={w}
                      className={item(d.width === w)}
                      onClick={() => {
                        api.update({ width: w });
                        setMenu(null);
                      }}
                    >
                      {dashLine(0, w)} {w}px
                    </button>
                  )),
                )}
            </div>

            <div className="relative">
              <button
                className={btn}
                title="Line style"
                onClick={() => setMenu(menu === "dash" ? null : "dash")}
              >
                {dashLine(dash)}
              </button>
              {menu === "dash" &&
                popup(
                  [0, 1, 2].map((v) => (
                    <button
                      key={v}
                      className={item(dash === v)}
                      onClick={() => {
                        api.update({ dash: v as 0 | 1 | 2 });
                        setMenu(null);
                      }}
                    >
                      {dashLine(v)} {DASH_LABEL[v]}
                    </button>
                  )),
                )}
            </div>
          </>
        )}

        <button
          className={btn}
          title="Settings"
          onClick={() => useDrawingStore.setState({ settingsOpen: true })}
        >
          <SettingsI />
        </button>

        <button className={btn} disabled title="Alert (sắp có)">
          <AlertI />
        </button>

        <button
          className={btn}
          title={d.locked ? "Unlock" : "Lock"}
          onClick={() => api.update({ locked: !d.locked })}
        >
          <Lock open={!d.locked} />
        </button>

        {/* Anchor như TV: ghim cố định trên màn hình, không chạy theo chart */}
        {SPEC[d.type]?.anchorable && (
          <button
            className={`${btn} ${d.opts?.anchored ? "text-[var(--accent-text)]" : ""}`}
            title={d.opts?.anchored ? "Unanchor" : "Anchor"}
            onClick={() => api.toggleAnchor()}
          >
            <AnchorI />
          </button>
        )}

        <button className={btn} title="Remove" onClick={() => api.deleteSelected()}>
          <Trash />
        </button>

        <button
          className={btn}
          title="More"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenu(null);
            setMore({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <DotsI />
        </button>
      </div>
      {more && <ChartContextMenu x={more.x} y={more.y} items={drawingMenuItems(api, d, tf, true)} onClose={() => setMore(null)} />}
    </>
  );
}
