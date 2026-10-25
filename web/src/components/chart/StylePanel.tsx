"use client";

import { useDrawingStore } from "@/drawings/store";
import ColorPicker from "./ColorPicker";
import { floatBar, fontSizeOf, POS_DEFAULTS, SPEC } from "@/drawings/tools";
import { visibleOn } from "@/drawings/visibility";
import { useChartStore } from "@/store/chart";
import { snapPrice } from "@/trading/orderType";
import { useTicketStore } from "@/trading/ticket";
import { Fragment, useRef, useState, type ReactNode } from "react";
import { AlertI, AnchorI, BucketI, DotsI, LimitOrderI, Lock, PenI, SettingsI, Svg, TemplatesAddI, TextColorI, Trash } from "../icons";
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
  const [menu, setMenu] = useState<"width" | "dash" | "font" | null>(null);
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
  const createLimitOrder = () => {
    const { symbol, symbols } = useChartStore.getState();
    const info = symbols.find((x) => x.name === symbol);
    const digits = info?.digits ?? 5;
    const [entry, target, , stop] = d.points;
    useTicketStore.getState().open({
      symbol,
      side: d.type === "shortpos" ? "sell" : "buy",
      mode: "pending",
      price: snapPrice(entry.price, info?.tick_size ?? 10 ** -digits, digits),
      digits,
    });
    useTicketStore.getState().patch({ tp: target.price.toFixed(digits), sl: stop.price.toFixed(digits) });
  };
  // Menu thả xuống của nút width / style: dòng đang chọn đảo màu như TV
  const popup = (items: ReactNode) => (
    <div className="absolute left-0 top-[38px] z-40 min-w-[120px] whitespace-nowrap rounded-md popup py-1">
      {items}
    </div>
  );
  const item = (on: boolean) =>
    `flex h-8 w-full items-center gap-2 px-3 text-left text-sm ${on ? "bg-[var(--selected)] text-[var(--fg)] shadow-[inset_2px_0_0_var(--accent)]" : "hover:bg-[var(--hover)]"}`;

  const tokens = isVol ? [] : floatBar(d.type);
  // Màu chữ mặc định của nhãn theo tool (nhãn trên nền màu: trắng; ô tối: xám sáng)
  const textDefault = ["callout", "comment", "pricelabel"].includes(d.type) ? "#ffffff" : ["signpost", "pin", "table"].includes(d.type) ? "#dbdbdb" : isPos ? "#ffffff" : d.color;
  const bgValue = String(d.opts?.backgroundColor || d.color);
  const dropdown = (key: "width" | "dash" | "font", title: string, label: ReactNode, rows: { on: boolean; label: ReactNode; pick: () => void }[], wide = false) => (
    <div className="relative">
      <button className={`${btn} ${wide ? "w-auto gap-1.5 px-1.5 text-[13px]" : ""}`} title={title} onClick={() => setMenu(menu === key ? null : key)}>
        {label}
      </button>
      {menu === key &&
        popup(
          rows.map((r, i) => (
            <button
              key={i}
              className={item(r.on)}
              onClick={() => {
                r.pick();
                setMenu(null);
              }}
            >
              {r.label}
            </button>
          )),
        )}
    </div>
  );
  const token = (t: string): ReactNode => {
    switch (t) {
      case "lc":
        return <ColorButton title="Line color" color={d.color} onChange={(c) => api.update({ color: c })}><PenI /></ColorButton>;
      case "fill":
        return <ColorButton title="Background color" color={d.color} onChange={(c) => api.update({ color: c })}><BucketI /></ColorButton>;
      case "bg":
        return <ColorButton title="Background color" color={bgValue} onChange={(c) => api.update({ opts: { backgroundColor: c } })}><BucketI /></ColorButton>;
      case "profit":
        return <ColorButton title="Profit background color" color={po.profit} onChange={(c) => api.update({ opts: { profit: c } })}><BucketI /></ColorButton>;
      case "stop":
        return <ColorButton title="Stop background color" color={po.stop} onChange={(c) => api.update({ opts: { stop: c } })}><BucketI /></ColorButton>;
      case "tc":
        return <ColorButton title="Text color" color={d.textColor ?? textDefault} onChange={(c) => api.update({ textColor: c })}><TextColorI /></ColorButton>;
      case "limit":
        // Như TV: mở bảng đặt lệnh với entry / SL / TP của Position (Long = Buy, Short = Sell)
        return <button className={btn} title="Create limit order" onClick={createLimitOrder}><LimitOrderI /></button>;
      case "w":
        return dropdown("width", "Line width", <>{dashLine(0, d.width)} {d.width}px</>, [1, 2, 3, 4].map((w) => ({ on: d.width === w, label: <>{dashLine(0, w)} {w}px</>, pick: () => api.update({ width: w }) })), true);
      case "st":
        return dropdown("dash", "Line style", dashLine(dash), [0, 1, 2].map((v) => ({ on: dash === v, label: <>{dashLine(v)} {DASH_LABEL[v]}</>, pick: () => api.update({ dash: v as 0 | 1 | 2 }) })));
      case "fs": {
        const size = fontSizeOf(d);
        return dropdown("font", "Font size", <span className="px-1">{size}</span>, [10, 11, 12, 14, 16, 20, 24, 28, 32, 40].map((v) => ({ on: size === v, label: <>{v}</>, pick: () => api.update({ opts: { fontSize: v } }) })), true);
      }
      case "col":
        return (
          <button className={btn} title="Add column" onClick={() => api.tableAdd("col")}>
            <Svg>
              <rect x="6.5" y="7.5" width="9" height="13" />
              <path d="M20.5 11v6M17.5 14h6" />
            </Svg>
          </button>
        );
      case "row":
        return (
          <button className={btn} title="Add row" onClick={() => api.tableAdd("row")}>
            <Svg>
              <rect x="7.5" y="6.5" width="13" height="9" />
              <path d="M14 18.5v5M11.5 21h5" />
            </Svg>
          </button>
        );
      default:
        return null;
    }
  };

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
          <TemplatesAddI />
        </button>

        {/* Nút của tool theo TV (floatBar), rồi Settings · alert · Lock · anchor · Remove · More */}
        {tokens.filter((t) => t !== "al" && t !== "anc").map((t) => <Fragment key={t}>{token(t)}</Fragment>)}

        <button
          className={btn}
          title="Settings"
          onClick={() => useDrawingStore.setState({ settingsOpen: true, settingsTab: null })}
        >
          <SettingsI />
        </button>

        {tokens.includes("al") && (
          <button className={btn} disabled title="Alert (sắp có)">
            <AlertI />
          </button>
        )}

        <button
          className={btn}
          title={d.locked ? "Unlock" : "Lock"}
          onClick={() => api.update({ locked: !d.locked })}
        >
          <Lock open={!d.locked} />
        </button>

        {/* Anchor như TV: ghim cố định trên màn hình, không chạy theo chart */}
        {tokens.includes("anc") && SPEC[d.type]?.anchorable && (
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
