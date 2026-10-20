"use client";

import { useDrawingStore } from "@/drawings/store";
import { POS_DEFAULTS, SPEC, VP_BY, VP_DEFAULTS } from "@/drawings/tools";
import type { Drawing } from "@/drawings/types";
import { useState, type ReactNode } from "react";
import { Close } from "../icons";

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

const toLocal = (t: number) => {
  const d = new Date(t * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

function Dialog({ init, onClose }: { init: Drawing; onClose: () => void }) {
  const api = useDrawingStore((s) => s.api);
  const spec = SPEC[init.type];
  const isPos = spec.panel === "position";
  const isVol = spec.panel === "volume";
  const [d, setD] = useState<Drawing>(() => structuredClone(init));
  const [tab, setTab] = useState<"inputs" | "style" | "coords">(
    isPos || isVol ? "inputs" : "style",
  );
  const [templateMenu, setTemplateMenu] = useState(false);
  const o = { ...POS_DEFAULTS, ...d.opts } as typeof POS_DEFAULTS;
  const v = {
    ...(VP_BY[d.type] ?? VP_DEFAULTS),
    ...d.opts,
  } as typeof VP_DEFAULTS;

  const setOpt = (k: string, val: number | string | boolean) =>
    setD({ ...d, opts: { ...d.opts, [k]: val } });
  const setPoint = (i: number, patch: Partial<Drawing["points"][number]>) => {
    const points = d.points.map((p) => ({ ...p }));
    points[i] = { ...points[i], ...patch };
    spec.constrain?.(points, i);
    setD({ ...d, points });
  };
  const num = (v: string, fallback: number) =>
    Number.isFinite(Number(v)) && v !== "" ? Number(v) : fallback;

  const tabs = [
    ...(isPos || isVol ? [["inputs", "Inputs"] as const] : []),
    ["style", "Style"] as const,
    ["coords", "Coordinates"] as const,
  ];
  const check = (label: string, key: string, color?: string) => (
    <Row label={label}>
      <span className="flex items-center gap-3">
        {color && (
          <input
            type="color"
            value={String(v[color as keyof typeof v])}
            onChange={(e) => setOpt(color, e.target.value)}
            className="h-8 w-12 cursor-pointer bg-transparent"
          />
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
      <input
        type="color"
        value={String(v[key as keyof typeof v])}
        onChange={(e) => setOpt(key, e.target.value)}
        className="h-8 w-14 cursor-pointer bg-transparent"
      />
    </Row>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-[420px] flex-col rounded-2xl border border-[var(--border)] bg-[var(--bg)] text-[var(--fg)] shadow-2xl"
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
              <Row label="Row size (rows)">
                <input
                  className={input}
                  type="number"
                  min={2}
                  max={500}
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
              {check("VAH", "showVah", "vahColor")}
              {check("VAL", "showVal", "valColor")}
              {check("POC", "showPoc", "pocColor")}
            </>
          )}

          {tab === "inputs" && isPos && (
            <>
              <Row label="Account size">
                <input
                  className={input}
                  type="number"
                  value={o.account}
                  onChange={(e) =>
                    setOpt("account", num(e.target.value, o.account))
                  }
                />
              </Row>
              <Row label="Lot size">
                <input
                  className={input}
                  type="number"
                  value={o.lot}
                  onChange={(e) => setOpt("lot", num(e.target.value, o.lot))}
                />
              </Row>
              <Row label="Risk (%)">
                <input
                  className={input}
                  type="number"
                  step="0.1"
                  value={o.risk}
                  onChange={(e) => setOpt("risk", num(e.target.value, o.risk))}
                />
              </Row>
              <Row label="Entry price">
                <input
                  className={input}
                  type="number"
                  value={d.points[0].price}
                  onChange={(e) =>
                    setPoint(0, {
                      price: num(e.target.value, d.points[0].price),
                    })
                  }
                />
              </Row>
              <Row label="Profit level (price)">
                <input
                  className={input}
                  type="number"
                  value={d.points[1].price}
                  onChange={(e) =>
                    setPoint(1, {
                      price: num(e.target.value, d.points[1].price),
                    })
                  }
                />
              </Row>
              <Row label="Stop level (price)">
                <input
                  className={input}
                  type="number"
                  value={d.points[3].price}
                  onChange={(e) =>
                    setPoint(3, {
                      price: num(e.target.value, d.points[3].price),
                    })
                  }
                />
              </Row>
            </>
          )}

          {tab === "style" && isPos && (
            <>
              <Row label="Profit color">
                <input
                  type="color"
                  value={o.profit}
                  onChange={(e) => setOpt("profit", e.target.value)}
                  className="h-8 w-14 cursor-pointer bg-transparent"
                />
              </Row>
              <Row label="Stop color">
                <input
                  type="color"
                  value={o.stop}
                  onChange={(e) => setOpt("stop", e.target.value)}
                  className="h-8 w-14 cursor-pointer bg-transparent"
                />
              </Row>
              <Row label="Text color">
                <input
                  type="color"
                  value={d.textColor ?? "#ffffff"}
                  onChange={(e) => setD({ ...d, textColor: e.target.value })}
                  className="h-8 w-14 cursor-pointer bg-transparent"
                />
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
            </>
          )}

          {tab === "style" && !isPos && !isVol && (
            <>
              <Row label="Line color">
                <input
                  type="color"
                  value={d.color}
                  onChange={(e) => setD({ ...d, color: e.target.value })}
                  className="h-8 w-14 cursor-pointer bg-transparent"
                />
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
              <Row label="Text color">
                <input
                  type="color"
                  value={d.textColor ?? d.color}
                  onChange={(e) => setD({ ...d, textColor: e.target.value })}
                  className="h-8 w-14 cursor-pointer bg-transparent"
                />
              </Row>
              {(spec.prompt || d.text !== undefined) && (
                <Row label="Text">
                  <input
                    className={input}
                    value={d.text ?? ""}
                    onChange={(e) => setD({ ...d, text: e.target.value })}
                  />
                </Row>
              )}
            </>
          )}

          {tab === "coords" &&
            d.points.map((p, i) => (
              <div
                key={i}
                className="border-b border-[var(--border)] py-2 last:border-0"
              >
                <div className="pb-1 text-xs font-semibold text-[var(--muted)]">
                  POINT {i + 1}
                </div>
                <Row label="Price">
                  <input
                    className={input}
                    type="number"
                    value={p.price}
                    onChange={(e) =>
                      setPoint(i, { price: num(e.target.value, p.price) })
                    }
                  />
                </Row>
                <Row label="Time">
                  <input
                    className={`${input} w-52`}
                    type="datetime-local"
                    value={toLocal(p.time)}
                    onChange={(e) => {
                      const t = new Date(e.target.value).getTime() / 1000;
                      if (Number.isFinite(t)) setPoint(i, { time: t });
                    }}
                  />
                </Row>
              </div>
            ))}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <div className="relative">
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              onClick={() => setTemplateMenu(!templateMenu)}
            >
              Mặc định ▾
            </button>
            {templateMenu && (
              <>
                <div
                  className="fixed inset-0 z-30"
                  onClick={() => setTemplateMenu(false)}
                />
                <div className="absolute bottom-9 left-0 z-40 min-w-44 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-1 text-sm shadow-xl">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs hover:bg-[var(--hover)]"
                    onClick={() => {
                      useDrawingStore.getState().setToolDefault(d.type, {
                        color: d.color,
                        width: d.width,
                        dash: d.dash,
                        textColor: d.textColor,
                        opts: d.opts ? { ...d.opts } : undefined,
                      });
                      setTemplateMenu(false);
                    }}
                  >
                    Lưu làm mặc định
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-3 py-1.5 text-left text-xs text-red-400 hover:bg-[var(--hover)]"
                    onClick={() => {
                      useDrawingStore.getState().resetToolDefault(d.type);
                      const st = SPEC[d.type].style ?? {};
                      setD({
                        ...d,
                        color: st.color ?? "#2962ff",
                        width: st.width ?? 2,
                        dash: st.dash,
                        textColor: undefined,
                        opts: undefined,
                      });
                      setTemplateMenu(false);
                    }}
                  >
                    Khôi phục gốc
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
              className="rounded-lg bg-white px-5 py-2 text-sm font-medium text-black hover:bg-neutral-200"
              onClick={() => {
                api?.replaceSelected(d);
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
  const { settingsOpen, selectedId, drawings } = useDrawingStore();
  const d = drawings.find((x) => x.id === selectedId);
  if (!settingsOpen || !d || !SPEC[d.type]) return null;
  return (
    <Dialog
      key={d.id}
      init={d}
      onClose={() => useDrawingStore.setState({ settingsOpen: false })}
    />
  );
}
