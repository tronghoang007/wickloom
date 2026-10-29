"use client";

import { useDrawingStore } from "@/drawings/store";
import ColorPicker from "./ColorPicker";
import { DEFAULT_COLOR, defaultOpts, encodeFibLevels, fibLevelsOf, optOf, POS_DEFAULTS, SPEC, settingsTabs, VP_BY, VP_DEFAULTS, type FibLevel, type SettingsTab } from "@/drawings/tools";
import type { Drawing } from "@/drawings/types";
import { UNITS, type Unit } from "@/drawings/visibility";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Close } from "../icons";
import { NumberField } from "./settingsParts";

const input =
  "w-40 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm">{label}</span>
      {children}
    </div>
  );
}

// Bảng mức Fib như TV: 2 cột, mỗi mức có bật/tắt, hệ số, màu
function FibLevels({ levels, onChange }: { levels: FibLevel[]; onChange: (lv: FibLevel[]) => void }) {
  const set = (i: number, patch: Partial<FibLevel>) => onChange(levels.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-[var(--border)] pt-3">
      {levels.map((l, i) => (
        <div key={i} className="flex items-center gap-2">
          <input type="checkbox" className="h-4 w-4" checked={l.on} onChange={(e) => set(i, { on: e.target.checked })} />
          <NumberField
            className="w-20 rounded border border-[var(--border)] bg-transparent px-2 py-1 text-sm outline-none focus:border-[var(--accent)]"
            step={0.001}
            value={l.coeff}
            onChange={(n) => set(i, { coeff: n })}
          />
          <ColorPicker value={l.color} onChange={(c) => set(i, { color: c })} className="h-7 w-7 p-1" />
        </div>
      ))}
    </div>
  );
}

// Thanh trượt 2 đầu của tab Visibility (TV): kéo từng núm giữa min và max
function RangeSlider({ min, max, from, to, disabled, onChange }: { min: number; max: number; from: number; to: number; disabled?: boolean; onChange: (from: number, to: number) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const pct = (v: number) => ((v - min) / (max - min || 1)) * 100;
  const drag = (which: "from" | "to") => (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const r = track.current!.getBoundingClientRect();
      const v = Math.round(min + Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width)) * (max - min));
      if (which === "from") onChange(Math.min(v, to), to);
      else onChange(from, Math.max(v, from));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div ref={track} className={`relative mx-2 h-1.5 flex-1 rounded-full bg-[var(--border)] ${disabled ? "opacity-50" : ""}`}>
      <div className="absolute inset-y-0 rounded-full bg-[var(--fg)]" style={{ left: `${pct(from)}%`, right: `${100 - pct(to)}%` }} />
      {(["from", "to"] as const).map((k) => (
        <div
          key={k}
          className="absolute top-1/2 h-[14px] w-[14px] -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border-2 border-[var(--fg)] bg-[var(--bg)]"
          style={{ left: `${pct(k === "from" ? from : to)}%` }}
          onPointerDown={drag(k)}
        />
      ))}
    </div>
  );
}

function Dialog({ init, startTab, onClose }: { init: Drawing; startTab: SettingsTab | null; onClose: () => void }) {
  const api = useDrawingStore((s) => s.api);
  const spec = SPEC[init.type];
  const isPos = spec.panel === "position";
  const isVol = spec.panel === "volume";
  const [d, setD] = useState<Drawing>(() => structuredClone(init));
  // Chỉnh là áp ngay lên chart (xem trước); không bấm Ok mà đóng (Cancel/X/Esc/bỏ chọn) thì trả về bản lúc mở
  const orig = useRef<Drawing>(structuredClone(init));
  const accepted = useRef(false);
  useEffect(() => {
    useDrawingStore.getState().api?.preview(d);
  }, [d]);
  useEffect(
    () => () => {
      if (!accepted.current) useDrawingStore.getState().api?.preview(orig.current);
    },
    [],
  );
  // Tab theo từng tool như TV; tab chưa có nội dung (Text của tool chưa có spec.text) thì chưa hiện
  const tabKeys: SettingsTab[] = (
    settingsTabs(init.type) ?? [...(isPos || isVol ? (["inputs"] as const) : []), "style", "text", "coords", "visibility"]
  ).filter((k) => (k !== "text" || spec.text) && (k !== "inputs" || isPos || isVol));
  const [tab, setTab] = useState<SettingsTab>(startTab && tabKeys.includes(startTab) ? startTab : (tabKeys[0] ?? "style"));
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Mở bằng double-click hình: ô nhập chữ được focus và bôi đen chữ cũ như TV
  useEffect(() => {
    if (startTab === "text") textRef.current?.select();
  }, [startTab]);
  const [templateMenu, setTemplateMenu] = useState(false);
  const o = { ...POS_DEFAULTS, ...d.opts } as typeof POS_DEFAULTS;
  const v = {
    ...(VP_BY[d.type] ?? VP_DEFAULTS),
    ...d.opts,
  } as typeof VP_DEFAULTS;

  const textSize = Number(d.opts?.fontSize) || (d.type === "text" ? 12 + d.width * 2 : Number(optOf(d, "fontSize")) || 14); // Text cũ lưu cỡ trong độ dày nét
  const setOpt = (k: string, val: number | string | boolean) =>
    setD({ ...d, opts: { ...d.opts, [k]: val } });
  const setPoint = (i: number, patch: Partial<Drawing["points"][number]>) => {
    const points = d.points.map((p) => ({ ...p }));
    points[i] = { ...points[i], ...patch };
    spec.constrain?.(points, i, undefined, d.points);
    setD({ ...d, points });
  };
  const num = (v: string, fallback: number) =>
    Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback;

  const TAB_LABEL: Record<SettingsTab, string> = { inputs: "Inputs", style: "Style", text: "Text", coords: "Coordinates", visibility: "Visibility" };
  const tabs = tabKeys.map((k) => [k, TAB_LABEL[k]] as const);
  // Như tab Visibility của TV: mỗi đơn vị khung thời gian bật/tắt + khoảng từ–đến
  const visRange = (u: Unit, max: number) => d.visibility?.[u] ?? { on: true, from: 1, to: max };
  const setVis = (u: Unit, max: number, patch: Partial<{ on: boolean; from: number; to: number }>) => {
    const r = { ...visRange(u, max), ...patch };
    r.from = Math.max(1, Math.min(max, r.from));
    r.to = Math.max(r.from, Math.min(max, r.to));
    setD({ ...d, visibility: { ...d.visibility, [u]: r } });
  };
  const check = (label: string, key: string, color?: string, dash?: string) => (
    <Row label={label}>
      <span className="flex items-center gap-3">
        {color && (
          <ColorPicker value={String(v[color as keyof typeof v])} onChange={(c) => setOpt(color, c)} className="h-8 w-8 p-1" />
        )}
        {dash && (
          <select className={`${input} w-24`} value={Number(v[dash as keyof typeof v])} onChange={(e) => setOpt(dash, Number(e.target.value))}>
            <option value={0} className="text-black">Solid</option>
            <option value={1} className="text-black">Dashed</option>
            <option value={2} className="text-black">Dotted</option>
          </select>
        )}
        <input
          type="checkbox"
          className="h-4 w-4"
          checked={Boolean(v[key as keyof typeof v])}
          onChange={(e) => setOpt(key, e.target.checked)}
        />
      </span>
    </Row>
  );
  const colorRow = (label: string, key: string) => (
    <Row label={label}>
      <ColorPicker value={String(v[key as keyof typeof v])} onChange={(c) => setOpt(key, c)} className="h-8 w-8 p-1" />
    </Row>
  );

  // tùy chọn riêng của tool (spec.options), tên theo TV
  const optionRows = spec.options?.map((o, i, all) => (
                <div key={o.key}>
                  {o.section && o.section !== all[i - 1]?.section && (
                    <div className="pb-1 pt-3 text-[11px] font-semibold tracking-wide text-[var(--muted)]">{o.section}</div>
                  )}
                {"color" in o || "choices" in o ? (
                  <Row label={o.label}>
                    {"color" in o ? (
                      <ColorPicker value={String(optOf(d, o.key) || d.color)} onChange={(c) => setOpt(o.key, c)} className="h-8 w-8 p-1" />
                    ) : (
                      <select className={input} value={String(optOf(d, o.key))} onChange={(e) => setOpt(o.key, e.target.value)}>
                        {o.choices.map(([v, label]) => (
                          <option key={v} value={v} className="text-black">{label}</option>
                        ))}
                      </select>
                    )}
                  </Row>
                ) : (
                  // Như TV: ô chọn nằm bên trái nhãn
                  <label className="flex items-center gap-3 py-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={Boolean(optOf(d, o.key))} onChange={(e) => setOpt(o.key, e.target.checked)} />
                    {o.label}
                  </label>
                )}
                </div>
              ));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[420px] max-w-[96vw] flex-col rounded-2xl popup"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-xl font-semibold">{spec.label}</h2>
          <button
            className="rounded p-1 hover:bg-[var(--hover)]"
            onClick={onClose}
            aria-label="Close"
          >
            <Close />
          </button>
        </div>
        <div className="flex gap-5 border-b border-[var(--border)] px-5">
          {tabs.map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 py-2 text-sm font-medium ${tab === id ? "border-[var(--fg)]" : "border-transparent text-[var(--muted)]"}`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-[200px] flex-1 overflow-y-auto px-5 py-2">
          {tab === "inputs" && isVol && (
            <>
              <Row label="Rows layout">
                <select
                  className={input}
                  value={v.layout}
                  onChange={(e) => setOpt("layout", e.target.value)}
                >
                  <option value="rows" className="text-black">
                    Number of rows
                  </option>
                  <option value="ticks" className="text-black">
                    Ticks per row
                  </option>
                </select>
              </Row>
              <Row label="Row size">
                <input
                  className={input}
                  type="number"
                  min={v.layout === "ticks" ? 1 : 2}
                  max={v.layout === "ticks" ? 100000 : 500}
                  value={v.rows}
                  onChange={(e) => setOpt("rows", num(e.target.value, v.rows))}
                />
              </Row>
              <Row label="Volume">
                <select
                  className={input}
                  value={v.volume}
                  onChange={(e) => setOpt("volume", e.target.value)}
                >
                  <option value="updown" className="text-black">
                    Up/Down
                  </option>
                  <option value="total" className="text-black">
                    Total
                  </option>
                  <option value="delta" className="text-black">
                    Delta
                  </option>
                  <option value="deltatotal" className="text-black">
                    Delta + Total
                  </option>
                </select>
              </Row>
              <Row label="Value Area Volume">
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={100}
                  value={v.va}
                  onChange={(e) =>
                    setOpt(
                      "va",
                      Math.min(100, Math.max(1, num(e.target.value, v.va))),
                    )
                  }
                />
              </Row>
              <Row label="Data aggregation">
                <select
                  className={input}
                  value={v.agg}
                  onChange={(e) => setOpt("agg", e.target.value)}
                >
                  <option value="time" className="text-black">
                    Time
                  </option>
                  <option value="ticks" className="text-black">
                    1 tick
                  </option>
                </select>
              </Row>
              {check("Extend right", "extend")}
            </>
          )}

          {tab === "style" && isVol && (
            <>
              <Row label="Width (% of the box)">
                <input
                  className={input}
                  type="number"
                  min={1}
                  max={100}
                  value={v.width}
                  onChange={(e) =>
                    setOpt(
                      "width",
                      Math.min(100, Math.max(1, num(e.target.value, v.width))),
                    )
                  }
                />
              </Row>
              <Row label="Placement">
                <select
                  className={input}
                  value={v.place}
                  onChange={(e) => setOpt("place", e.target.value)}
                >
                  <option value="left" className="text-black">
                    Left
                  </option>
                  <option value="right" className="text-black">
                    Right
                  </option>
                </select>
              </Row>
              {check("Values", "values")}
              {colorRow("Up Volume", "up")}
              {colorRow("Down Volume", "down")}
              {colorRow("Value Area Up", "vaUp")}
              {colorRow("Value Area Down", "vaDown")}
              {check("VAH", "showVah", "vahColor", "vahDash")}
              {check("VAL", "showVal", "valColor", "valDash")}
              {check("POC", "showPoc", "pocColor", "pocDash")}
              {colorRow("Histogram Box", "box")}
            </>
          )}

          {tab === "inputs" && isPos && (
            <>
              <Row label="Account size">
                <NumberField className={input} value={o.account} onChange={(n) => setOpt("account", n)} />
              </Row>
              <Row label="Lot size">
                <NumberField className={input} value={o.lot} onChange={(n) => setOpt("lot", n)} />
              </Row>
              <Row label="Risk">
                <span className="flex items-center gap-2">
                  <NumberField className={`${input} w-24`} step={0.1} value={o.risk} onChange={(n) => setOpt("risk", n)} />
                  {/* như TV: rủi ro theo % tài khoản hoặc theo số tiền */}
                  <select className={`${input} w-20`} value={o.riskMode} onChange={(e) => setOpt("riskMode", e.target.value)}>
                    <option value="percent" className="text-black">%</option>
                    <option value="money" className="text-black">$</option>
                  </select>
                </span>
              </Row>
              <Row label="Entry price">
                <NumberField className={input} value={d.points[0].price} onChange={(n) => setPoint(0, { price: n })} />
              </Row>
              <Row label="Leverage">
                <input
                  className={input}
                  type="number"
                  min={0}
                  value={o.leverage}
                  onChange={(e) => setOpt("leverage", num(e.target.value, o.leverage))}
                />
              </Row>
              {/* Như TV: mỗi mức có Ticks (khoảng cách tới entry) và Price, sửa ô nào thì ô kia đổi theo */}
              {([["PROFIT LEVEL", 1, 1], ["STOP LEVEL", 3, -1]] as const).map(([title, i, sign]) => {
                const tick = api?.tickSize() || 0;
                const dir = (d.type === "shortpos" ? -1 : 1) * sign; // chiều của mức so với entry
                const ticks = tick > 0 ? Math.round(Math.abs(d.points[i].price - d.points[0].price) / tick) : 0;
                return (
                  <div key={title}>
                    <div className="pb-1 pt-3 text-[11px] font-semibold tracking-wide text-[var(--muted)]">{title}</div>
                    {tick > 0 && (
                      <Row label="Ticks">
                        <input
                          className={input}
                          type="number"
                          min={1}
                          value={ticks}
                          onChange={(e) => setPoint(i, { price: d.points[0].price + dir * Math.max(1, Math.round(num(e.target.value, ticks))) * tick })}
                        />
                      </Row>
                    )}
                    <Row label="Price">
                      <NumberField className={input} value={d.points[i].price} onChange={(n) => setPoint(i, { price: n })} />
                    </Row>
                  </div>
                );
              })}
              <Row label="QTY precision">
                <select className={input} value={o.qtyPrecision} onChange={(e) => setOpt("qtyPrecision", e.target.value)}>
                  {[["default", "Default"], ["0", "Integer"], ...Array.from({ length: 10 }, (_, i) => [String(i + 1), `${i + 1} decimal${i ? "s" : ""}`])].map(([v, l]) => (
                    <option key={v} value={v} className="text-black">{l}</option>
                  ))}
                </select>
              </Row>
            </>
          )}

          {tab === "style" && isPos && (
            <>
              <Row label="Lines">
                <span className="flex items-center gap-2">
                  <ColorPicker value={o.lineColor} onChange={(c) => setOpt("lineColor", c)} className="h-8 w-8 p-1" />
                  <select className={`${input} w-20`} value={o.lineWidth} onChange={(e) => setOpt("lineWidth", Number(e.target.value))}>
                    {[1, 2, 3, 4].map((w) => (
                      <option key={w} value={w} className="text-black">{w}px</option>
                    ))}
                  </select>
                </span>
              </Row>
              <Row label="Stop color">
                <ColorPicker value={o.stop} onChange={(c) => setOpt("stop", c)} className="h-8 w-8 p-1" />
              </Row>
              <Row label="Target color">
                <ColorPicker value={o.profit} onChange={(c) => setOpt("profit", c)} className="h-8 w-8 p-1" />
              </Row>
              <Row label="Text">
                <span className="flex items-center gap-2">
                  <ColorPicker value={d.textColor ?? "#ffffff"} onChange={(c) => setD({ ...d, textColor: c })} className="h-8 w-8 p-1" />
                  <select className={`${input} w-20`} value={o.fontSize} onChange={(e) => setOpt("fontSize", Number(e.target.value))}>
                    {[10, 11, 12, 14, 16, 20, 24, 28, 32, 40].map((n) => (
                      <option key={n} value={n} className="text-black">{n}</option>
                    ))}
                  </select>
                </span>
              </Row>
              <Row label="Fill opacity (%)">
                <input
                  className={input}
                  type="number"
                  min={0}
                  max={100}
                  value={Math.round(o.alpha * 100)}
                  onChange={(e) =>
                    setOpt(
                      "alpha",
                      Math.min(1, Math.max(0, num(e.target.value, 25) / 100)),
                    )
                  }
                />
              </Row>
              {optionRows}
            </>
          )}

          {tab === "style" && !isPos && !isVol && (
            <>
              <Row label={spec.colorLabel ?? "Line color"}>
                <ColorPicker value={d.color} onChange={(c) => setD({ ...d, color: c })} className="h-8 w-8 p-1" />
              </Row>
              <Row label="Line width">
                <select
                  className={input}
                  value={d.width}
                  onChange={(e) =>
                    setD({ ...d, width: Number(e.target.value) })
                  }
                >
                  {[1, 2, 3, 4].map((w) => (
                    <option key={w} value={w} className="text-black">
                      {w}px
                    </option>
                  ))}
                </select>
              </Row>
              <Row label="Line style">
                <select
                  className={input}
                  value={d.dash ?? 0}
                  onChange={(e) =>
                    setD({ ...d, dash: Number(e.target.value) as 0 | 1 | 2 })
                  }
                >
                  <option value={0} className="text-black">
                    Solid
                  </option>
                  <option value={1} className="text-black">
                    Dashed
                  </option>
                  <option value={2} className="text-black">
                    Dotted
                  </option>
                </select>
              </Row>
              {!spec.text && (
                <Row label="Text color">
                  <ColorPicker value={d.textColor ?? d.color} onChange={(c) => setD({ ...d, textColor: c })} className="h-8 w-8 p-1" />
                </Row>
              )}
              {!spec.text && (spec.prompt || d.text !== undefined) && (
                <Row label="Text">
                  <input
                    className={input}
                    value={d.text ?? ""}
                    onChange={(e) => setD({ ...d, text: e.target.value })}
                  />
                </Row>
              )}
              {optionRows}
              {spec.levels && <FibLevels levels={fibLevelsOf(d)} onChange={(lv) => setOpt("levels", encodeFibLevels(lv))} />}
            </>
          )}

          {/* Tab Text như TV: (màu) <cỡ> B I · textarea · căn lề · Background / Border / Text wrap tùy tool */}
          {tab === "text" && spec.text && (
            <>
              <div className="flex items-center gap-2 py-2">
                {!spec.text.noColor && (
                  <ColorPicker value={d.textColor ?? spec.text.color ?? d.color} onChange={(c) => setD({ ...d, textColor: c })} className="h-8 w-8 p-1" />
                )}
                <select className={`${input} w-20`} value={textSize} onChange={(e) => setOpt("fontSize", Number(e.target.value))}>
                  {[10, 11, 12, 14, 16, 20, 24, 28, 32, 40].map((v) => (
                    <option key={v} value={v} className="text-black">{v}</option>
                  ))}
                </select>
                {!spec.text.noStyle &&
                  (["bold", "italic"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`h-8 w-8 rounded border border-[var(--border)] text-sm ${optOf(d, k) ? "bg-[var(--fg)] text-[var(--bg)]" : ""}`}
                      style={{ fontWeight: k === "bold" ? 700 : 400, fontStyle: k === "italic" ? "italic" : "normal" }}
                      onClick={() => setOpt(k, !optOf(d, k))}
                    >
                      {k === "bold" ? "B" : "I"}
                    </button>
                  ))}
              </div>
              {!spec.text.noText && (
                <textarea
                  ref={textRef}
                  autoFocus
                  className="w-full resize-y rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
                  rows={4}
                  placeholder="Add text"
                  value={d.text ?? ""}
                  onChange={(e) => setD({ ...d, text: e.target.value })}
                />
              )}
              {!spec.text.fixed && (
                <Row label="Text alignment">
                  <span className="flex gap-2">
                    <select className={`${input} w-24`} value={String(optOf(d, "vAlign"))} onChange={(e) => setOpt("vAlign", e.target.value)}>
                      {[["top", "Top"], ["middle", spec.text.kind === "box" ? "Middle" : "Center"], ["bottom", "Bottom"]].map(([v, l]) => (
                        <option key={v} value={v} className="text-black">{l}</option>
                      ))}
                    </select>
                    <select className={`${input} w-24`} value={String(optOf(d, "hAlign"))} onChange={(e) => setOpt("hAlign", e.target.value)}>
                      {[["left", "Left"], ["center", "Center"], ["right", "Right"]].map(([v, l]) => (
                        <option key={v} value={v} className="text-black">{l}</option>
                      ))}
                    </select>
                  </span>
                </Row>
              )}
              {/* Background: "main" = màu chính của hình (Callout, Comment); còn lại ô bật + màu riêng */}
              {spec.text.bg === "main" && (
                <Row label="Background">
                  <ColorPicker value={d.color} onChange={(c) => setD({ ...d, color: c })} className="h-8 w-8 p-1" />
                </Row>
              )}
              {typeof spec.text.bg === "object" && (
                <label className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={Boolean(optOf(d, "background"))} onChange={(e) => setOpt("background", e.target.checked)} />
                  <span className="flex-1">Background</span>
                  <ColorPicker value={String(optOf(d, "backgroundColor"))} onChange={(c) => setOpt("backgroundColor", c)} className="h-8 w-8 p-1" />
                </label>
              )}
              {spec.text.border &&
                (spec.text.border.always ? (
                  <Row label="Border">
                    <ColorPicker value={String(optOf(d, "borderColor") || d.color)} onChange={(c) => setOpt("borderColor", c)} className="h-8 w-8 p-1" />
                  </Row>
                ) : (
                  <label className="flex items-center gap-3 py-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={Boolean(optOf(d, "border"))} onChange={(e) => setOpt("border", e.target.checked)} />
                    <span className="flex-1">Border</span>
                    <ColorPicker value={String(optOf(d, "borderColor"))} onChange={(c) => setOpt("borderColor", c)} className="h-8 w-8 p-1" />
                  </label>
                ))}
              {spec.text.wrap && (
                <label className="flex items-center gap-3 py-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={Boolean(optOf(d, "wrap"))} onChange={(e) => setOpt("wrap", e.target.checked)} />
                  Text wrap
                </label>
              )}
            </>
          )}

          {tab === "coords" &&
            d.points.map((p, i) => {
              const timeOnly = spec.axes === "time";
              const priceOnly = spec.axes === "price";
              return (
                <div key={i} className="flex items-center justify-between gap-3 py-2">
                  <span className="text-sm">{`#${i + 1} (${[priceOnly ? "price" : timeOnly ? "" : "price", priceOnly ? "" : "bar"].filter(Boolean).join(", ")})`}</span>
                  <span className="flex gap-2">
                    {!timeOnly && (
                      <NumberField className={input} style={{ width: 110 }} value={+p.price.toFixed(api?.digits() ?? 8)} onChange={(n) => setPoint(i, { price: n })} />
                    )}
                    {!priceOnly && (
                      <input
                        className={input} style={{ width: 90 }}
                        type="number"
                        step={1}
                        value={api ? api.barIndexAt(p.time) : 0}
                        onChange={(e) => {
                          const t = api?.timeAtBar(Math.round(num(e.target.value, api.barIndexAt(p.time))));
                          if (t != null) setPoint(i, { time: t });
                        }}
                      />
                    )}
                  </span>
                </div>
              );
            })}

          {/* Như TV: [x] Đơn vị  <từ>  ——o——o——  <đến> (Ticks / Ranges chỉ có ô bật) */}
          {tab === "visibility" &&
            UNITS.map(({ id, label, max }) => {
              const r = visRange(id, max);
              return (
                <div key={id} className="flex items-center gap-3 py-2">
                  <label className="flex w-28 shrink-0 items-center gap-2 text-sm">
                    <input type="checkbox" className="h-4 w-4" checked={r.on} onChange={(e) => setVis(id, max, { on: e.target.checked })} />
                    {label}
                  </label>
                  <input
                    className={input} style={{ width: 64 }}
                    type="number"
                    min={1}
                    max={max}
                    disabled={!r.on}
                    value={r.from}
                    onChange={(e) => setVis(id, max, { from: num(e.target.value, r.from) })}
                  />
                  <RangeSlider min={1} max={max} from={r.from} to={r.to} disabled={!r.on} onChange={(from, to) => setVis(id, max, { from, to })} />
                  <input
                    className={input} style={{ width: 64 }}
                    type="number"
                    min={1}
                    max={max}
                    disabled={!r.on}
                    value={r.to}
                    onChange={(e) => setVis(id, max, { to: num(e.target.value, r.to) })}
                  />
                </div>
              );
            })}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <div className="relative">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              onClick={() => setTemplateMenu(!templateMenu)}
            >
              Template ▾
            </button>
            {templateMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setTemplateMenu(false)}
                />
                <div className="absolute bottom-9 left-0 z-40 min-w-44 rounded-lg popup p-1 text-sm">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs hover:bg-[var(--hover)]"
                    onClick={() => {
                      useDrawingStore.getState().setToolDefault(d.type, {
                        color: d.color,
                        width: d.width,
                        dash: d.dash,
                        textColor: d.textColor,
                        opts: defaultOpts(d.opts, d.type),
                      });
                      setTemplateMenu(false);
                    }}
                  >
                    Save as default
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--hover)]"
                    onClick={() => {
                      useDrawingStore.getState().resetToolDefault(d.type);
                      const st = SPEC[d.type].style ?? {};
                      setD({
                        ...d,
                        color: st.color ?? DEFAULT_COLOR,
                        width: st.width ?? 2,
                        dash: st.dash,
                        textColor: undefined,
                        opts: undefined,
                      });
                      setTemplateMenu(false);
                    }}
                  >
                    Reset to factory default
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--hover)]"
              onClick={onClose}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-lg bg-[var(--fg)] px-5 py-2 text-sm font-medium text-[var(--bg)] hover:opacity-90"
              onClick={() => {
                accepted.current = true;
                api?.replaceSelected(d, orig.current);
                onClose();
              }}
            >
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function DrawingSettings() {
  const { settingsOpen, settingsTab, selectedId, drawings } = useDrawingStore();
  const d = drawings.find((x) => x.id === selectedId);
  if (!settingsOpen || !d || !SPEC[d.type]) return null;
  return (
    <Dialog
      key={d.id}
      init={d}
      startTab={settingsTab}
      onClose={() => useDrawingStore.setState({ settingsOpen: false })}
    />
  );
}
