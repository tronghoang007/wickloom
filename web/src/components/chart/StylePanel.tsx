"use client";

import { useDrawingStore } from "@/drawings/store";
import { POS_DEFAULTS, SPEC } from "@/drawings/tools";
import { useRef, useState, type ReactNode } from "react";
import { Svg } from "../icons";

const btn =
  "relative flex h-8 w-8 items-center justify-center rounded hover:bg-[var(--hover)] disabled:opacity-40 disabled:hover:bg-transparent";

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
    <label className={`${btn} cursor-pointer`} title={title}>
      <div className="flex flex-col items-center">
        {children}
        <span
          className="-mt-0.5 h-[3px] w-5 rounded"
          style={{ background: color }}
        />
      </div>
      <input
        type="color"
        value={color.slice(0, 7)}
        onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      />
    </label>
  );
}

const DASH_LABEL = ["Solid", "Dashed", "Dotted"];
const dashLine = (dash: number) => (
  <svg width="26" height="8" viewBox="0 0 26 8">
    <line
      x1="1"
      y1="4"
      x2="25"
      y2="4"
      stroke="currentColor"
      strokeWidth="2"
      strokeDasharray={dash === 1 ? "6 4" : dash === 2 ? "2 3" : undefined}
    />
  </svg>
);

export default function StylePanel() {
  const { drawings, selectedId, api } = useDrawingStore();
  const [menu, setMenu] = useState<"width" | "dash" | "more" | null>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    sx: number;
    sy: number;
    ox: number;
    oy: number;
  } | null>(null);
  const d = drawings.find((x) => x.id === selectedId);
  if (!d || !api) return null;

  const dash = d.dash ?? 0;
  const isPos = SPEC[d.type]?.panel === "position";
  const isVol = SPEC[d.type]?.panel === "volume";
  const po = { ...POS_DEFAULTS, ...d.opts } as typeof POS_DEFAULTS;
  const popup = (items: ReactNode) => (
    <>
      <div className="fixed inset-0 z-30" onClick={() => setMenu(null)} />
      <div className="absolute left-0 top-9 z-40 min-w-28 rounded border border-[var(--border)] bg-[var(--bg)] py-1 shadow-xl">
        {items}
      </div>
    </>
  );
  const item =
    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-[var(--hover)]";

  return (
    <div
      className="absolute left-1/2 top-12 z-20 flex items-center gap-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-1.5 py-1 text-[var(--fg)] shadow-lg"
      style={{ transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)` }}
    >
      <div
        className="mr-1 flex h-8 w-4 cursor-grab items-center justify-center touch-none"
        onPointerDown={(e) => {
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
        <Svg>
          <rect x="4" y="4" width="6" height="6" />
          <rect x="14" y="4" width="6" height="6" />
          <rect x="4" y="14" width="6" height="6" />
          <path d="M17 14v6M14 17h6" />
        </Svg>
      </button>

      {isVol ? null : isPos ? (
        <>
          <ColorButton
            title="Text color"
            color={d.textColor ?? "#ffffff"}
            onChange={(c) => api.update({ textColor: c })}
          >
            <Svg>
              <path d="M6 6h12M12 6v13M9 19h6" />
            </Svg>
          </ColorButton>
          <ColorButton
            title="Profit color"
            color={po.profit}
            onChange={(c) => api.update({ opts: { profit: c } })}
          >
            <Svg>
              <path d="M5 13l7-8 7 8-7 7zM19 15c1 1.500 1.500 2.500 1.500 3.500" />
            </Svg>
          </ColorButton>
          <ColorButton
            title="Stop color"
            color={po.stop}
            onChange={(c) => api.update({ opts: { stop: c } })}
          >
            <Svg>
              <path d="M5 13l7-8 7 8-7 7zM19 15c1 1.500 1.500 2.500 1.500 3.500" />
            </Svg>
          </ColorButton>
          <button className={btn} disabled title="Add to chart (sắp có)">
            <Svg>
              <rect x="4" y="4" width="16" height="14" rx="2" />
              <path d="M7 14l3-3 3 2 4-5M12 21v-3" />
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
            <Svg>
              <path d="M4 20l1-4L16 5l3 3L8 19z" />
            </Svg>
          </ColorButton>

          <ColorButton
            title="Text color"
            color={d.textColor ?? d.color}
            onChange={(c) => api.update({ textColor: c })}
          >
            <Svg>
              <path d="M6 6h12M12 6v13M9 19h6" />
            </Svg>
          </ColorButton>

          <div className="relative">
            <button
              className={`${btn} w-auto gap-1.5 px-2 text-sm`}
              title="Line width"
              onClick={() => setMenu(menu === "width" ? null : "width")}
            >
              {dashLine(0)} {d.width}px
            </button>
            {menu === "width" &&
              popup(
                [1, 2, 3, 4].map((w) => (
                  <button
                    key={w}
                    className={item}
                    onClick={() => {
                      api.update({ width: w });
                      setMenu(null);
                    }}
                  >
                    <svg width="26" height="8">
                      <line
                        x1="1"
                        y1="4"
                        x2="25"
                        y2="4"
                        stroke="currentColor"
                        strokeWidth={w}
                      />
                    </svg>{" "}
                    {w}px
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
                    className={item}
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
        <Svg>
          <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
        </Svg>
      </button>

      <button className={btn} disabled title="Alert (sắp có)">
        <Svg>
          <circle cx="12" cy="13" r="7" />
          <path d="M12 9v4l3 2M5 4l-2 2M19 4l2 2" />
        </Svg>
      </button>

      <button
        className={btn}
        title={d.locked ? "Unlock" : "Lock"}
        onClick={() => api.update({ locked: !d.locked })}
      >
        <Svg>
          {d.locked ? (
            <>
              <rect x="5" y="11" width="14" height="9" rx="1" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </>
          ) : (
            <>
              <rect x="5" y="11" width="14" height="9" rx="1" />
              <path d="M8 11V8a4 4 0 017.5-2" />
            </>
          )}
        </Svg>
      </button>

      <button
        className={btn}
        title="Delete"
        onClick={() => api.deleteSelected()}
      >
        <Svg>
          <path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13" />
        </Svg>
      </button>

      <div className="relative">
        <button
          className={btn}
          title="More"
          onClick={() => setMenu(menu === "more" ? null : "more")}
        >
          <Svg>
            <circle cx="5" cy="12" r="1" />
            <circle cx="12" cy="12" r="1" />
            <circle cx="19" cy="12" r="1" />
          </Svg>
        </button>
        {menu === "more" &&
          popup(
            <>
              <button
                className={item}
                onClick={() => {
                  api.cloneSelected();
                  setMenu(null);
                }}
              >
                Clone
              </button>
              <button
                className={item}
                onClick={() => {
                  api.reorder("front");
                  setMenu(null);
                }}
              >
                Bring to front
              </button>
              <button
                className={item}
                onClick={() => {
                  api.reorder("back");
                  setMenu(null);
                }}
              >
                Send to back
              </button>
              <button
                className={item}
                onClick={() => {
                  api.update({ hidden: true });
                  setMenu(null);
                }}
              >
                Hide
              </button>
            </>,
          )}
      </div>
    </div>
  );
}
