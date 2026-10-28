"use client";

import { byId } from "@/indicators/catalog";
import { resetInstance, resolveInputs, showsPriceLabel, type IndicatorInstance } from "@/indicators/instance";
import type { InputDef, LineStyleName, PlotType } from "@/indicators/schema";
import { LINE_STYLES, PLOT_TYPES, WIDTHS, fillStyle, itemStyle, levelStyle, plotStyle } from "@/indicators/style";
import { SOURCES } from "@/indicators/ta";
import { useIndicatorStore } from "@/indicators/store";
import { Fragment, useRef } from "react";
import ColorPicker from "./ColorPicker";
import { Check, NumberField, Section, SettingsFrame, VisibilityTab, field } from "./settingsParts";

function InputRow({ def, value, onChange, enabled = true }: { def: InputDef; value: number | string | boolean; onChange: (v: number | string | boolean) => void; enabled?: boolean }) {
  if (def.type === "bool") return <Check label={def.label} checked={value as boolean} onChange={onChange} />;
  return (
    <label className={`flex items-center justify-between py-1.5 ${enabled ? "" : "opacity-55"}`} title={def.tooltip}>
      {def.label}
      {def.type === "int" || def.type === "float" ? (
        <NumberField
          className={`${field} w-20`}
          disabled={!enabled}
          min={def.min}
          max={def.max}
          step={def.step ?? 1}
          value={value as number}
          onChange={(n) => {
            // ô trống / ngoài khoảng cho phép thì giữ giá trị cũ: chart luôn tính được
            if (n >= (def.min ?? -Infinity) && n <= (def.max ?? Infinity)) onChange(n);
          }}
        />
      ) : (
        <select className={`${field} min-w-28 max-w-56`} disabled={!enabled} value={value as string} onChange={(e) => onChange(e.target.value)}>
          {(def.type === "source" ? [...SOURCES] : def.options).map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

// Ô chọn gọn cho hàng style (kiểu nét / độ dày / kiểu plot)
function Pick({ value, options, onChange, disabled, width = "w-[80px]" }: { value: string; options: { id: string; label: string }[]; onChange: (v: string) => void; disabled?: boolean; width?: string }) {
  return (
    <select className={`${field} h-7 ${width} shrink-0 !pl-1.5 !pr-5 text-[12px]`} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Dialog({ uid }: { uid: string }) {
  const inst = useIndicatorStore((st) => st.list.find((i) => i.uid === uid));
  const update = useIndicatorStore((st) => st.update);
  // Chỉnh là áp ngay lên chart (xem trước); Cancel/X/Esc trả về setting lúc mở dialog, Ok giữ lại
  const snapshot = useRef<IndicatorInstance | undefined>(useIndicatorStore.getState().list.find((i) => i.uid === uid));
  const close = () => useIndicatorStore.getState().closeSettings();
  const cancel = () => {
    if (snapshot.current) useIndicatorStore.getState().replace(snapshot.current);
    close();
  };
  if (!inst) return null; // đã bị gỡ (vd đổi layout) trong lúc mở
  const def = byId(inst.id);
  const inputs = resolveInputs(def, inst.inputs);
  // Đổi style của 1 plot / level / fill; bỏ field rỗng và `visible: true` (mặc định) cho gọn dữ liệu lưu
  const setStyle = (group: "plots" | "levels" | "fills" | "items", id: string, patch: Record<string, unknown>) => {
    const cur = (inst.style?.[group] ?? {}) as Record<string, Record<string, unknown>>;
    const next = Object.fromEntries(Object.entries({ ...cur[id], ...patch }).filter(([k, v]) => v !== undefined && !(k === "visible" && v === true)));
    update(uid, { style: { ...inst.style, [group]: { ...cur, [id]: next } } });
  };

  return (
    <SettingsFrame
      title={def.name}
      label={`${def.name} settings`}
      width={480}
      onCancel={cancel}
      onOk={close}
      onReset={() => useIndicatorStore.getState().replace(resetInstance(inst))}
    >
      {(tab) => (
        <>
          {tab === "inputs" &&
            (def.inputs.length === 0 ? (
              <div className="py-2 text-[var(--muted)]">This indicator has no inputs.</div>
            ) : (
              def.inputs.map((d, k) => (
                <Fragment key={d.key}>
                  {d.group && d.group !== def.inputs[k - 1]?.group && <Section>{d.group}</Section>}
                  <InputRow def={d} value={inputs[d.key]} enabled={d.enabledIf ? d.enabledIf(inputs) : true} onChange={(v) => update(uid, { inputs: { ...inst.inputs, [d.key]: v } })} />
                </Fragment>
              ))
            ))}

          {tab === "style" && (
            <>
              {def.plots.filter((p) => !p.hidden).map((p) => {
                const st = plotStyle(inst, p);
                const isLine = st.type !== "histogram";
                return (
                  <div key={p.id} className="flex items-center gap-1.5">
                    <Check className="min-w-0 flex-1 whitespace-nowrap" label={p.title} checked={st.visible} onChange={(visible) => setStyle("plots", p.id, { visible })} />
                    {p.type === "candles" && (
                      <>
                        <ColorPicker value={st.color} onChange={(color) => setStyle("plots", p.id, { color })} className="h-7 w-7 p-1" />
                        <ColorPicker value={st.colorDown} onChange={(colorDown) => setStyle("plots", p.id, { colorDown })} className="h-7 w-7 p-1" />
                      </>
                    )}
                    {!p.perBar && p.type !== "candles" && (
                      <>
                        <ColorPicker value={st.color} onChange={(color) => setStyle("plots", p.id, { color })} className="h-7 w-7 p-1" />
                        <Pick value={st.lineStyle} disabled={!isLine} options={LINE_STYLES} onChange={(v) => setStyle("plots", p.id, { lineStyle: v as LineStyleName })} />
                        <Pick value={String(st.width)} width="w-[56px]" disabled={!isLine} options={WIDTHS.map((w) => ({ id: String(w), label: `${w}px` }))} onChange={(v) => setStyle("plots", p.id, { width: Number(v) })} />
                        <Pick value={st.type} width="w-[124px]" options={PLOT_TYPES} onChange={(v) => setStyle("plots", p.id, { type: v as PlotType })} />
                      </>
                    )}
                  </div>
                );
              })}

              {def.levels && (
                <>
                  <Section>Levels</Section>
                  {def.levels.map((l) => {
                    const st = levelStyle(inst, l);
                    return (
                      <div key={l.id} className="flex items-center gap-1.5">
                        <Check className="min-w-0 flex-1 whitespace-nowrap" label={l.title} checked={st.visible} onChange={(visible) => setStyle("levels", l.id, { visible })} />
                        <NumberField className={`${field} h-7 w-16`} value={st.value} onChange={(n) => setStyle("levels", l.id, { value: n })} />
                        <ColorPicker value={st.color} onChange={(color) => setStyle("levels", l.id, { color })} className="h-7 w-7 p-1" />
                        <Pick value={st.lineStyle} options={LINE_STYLES} onChange={(v) => setStyle("levels", l.id, { lineStyle: v as LineStyleName })} />
                        <Pick value={String(st.width)} options={WIDTHS.map((w) => ({ id: String(w), label: `${w}px` }))} onChange={(v) => setStyle("levels", l.id, { width: Number(v) })} />
                      </div>
                    );
                  })}
                </>
              )}

              {def.fills && (
                <>
                  <Section>Background</Section>
                  {def.fills.map((f) => {
                    const st = fillStyle(inst, f);
                    return (
                      <div key={f.id} className="flex items-center justify-between">
                        <Check label={f.title} checked={st.visible} onChange={(visible) => setStyle("fills", f.id, { visible })} />
                        <div className="flex items-center gap-1.5">
                          <ColorPicker value={st.color} onChange={(color) => setStyle("fills", f.id, { color })} className="h-7 w-7 p-1" />
                          {f.colorDown && <ColorPicker value={st.colorDown} onChange={(colorDown) => setStyle("fills", f.id, { colorDown })} className="h-7 w-7 p-1" />}
                        </div>
                      </div>
                    );
                  })}
                </>
              )}

              {def.items?.map((it, k) => {
                const st = itemStyle(inst, it);
                return (
                  <Fragment key={it.id}>
                    {it.group && it.group !== def.items![k - 1]?.group && <Section>{it.group}</Section>}
                    <div className="flex items-center gap-1.5">
                      {it.plain ? (
                        <span className="min-w-0 flex-1 whitespace-nowrap">{it.title}</span>
                      ) : (
                        <Check className="min-w-0 flex-1 whitespace-nowrap" label={it.title} checked={st.visible} onChange={(visible) => setStyle("items", it.id, { visible })} />
                      )}
                      <ColorPicker value={st.color} onChange={(color) => setStyle("items", it.id, { color })} className="h-7 w-7 p-1" />
                      {it.line && (
                        <>
                          <Pick value={st.style} options={LINE_STYLES} onChange={(v) => setStyle("items", it.id, { lineStyle: v as LineStyleName })} />
                          <Pick value={String(st.width)} width="w-[56px]" options={WIDTHS.map((w) => ({ id: String(w), label: `${w}px` }))} onChange={(v) => setStyle("items", it.id, { width: Number(v) })} />
                        </>
                      )}
                    </div>
                  </Fragment>
                );
              })}

              <Section>Output values</Section>
              <label className="flex items-center justify-between py-1.5">
                Precision
                <select
                  className={`${field} w-28`}
                  value={inst.precision ?? "default"}
                  onChange={(e) => update(uid, { precision: e.target.value === "default" ? undefined : Number(e.target.value) })}
                >
                  <option value="default">Default</option>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Check label="Labels on price scale" checked={showsPriceLabel(inst, def)} onChange={(priceLabel) => update(uid, { priceLabel })} />
              <Check label="Values in status line" checked={inst.statusValues !== false} onChange={(v) => update(uid, { statusValues: v ? undefined : false })} />

              <Section>Input values</Section>
              <Check label="Inputs in status line" checked={inst.statusInputs !== false} onChange={(v) => update(uid, { statusInputs: v ? undefined : false })} />
            </>
          )}

          {tab === "visibility" && <VisibilityTab value={inst.visibility} onChange={(visibility) => update(uid, { visibility })} />}
        </>
      )}
    </SettingsFrame>
  );
}

/** Settings của một indicator (Inputs / Style / Visibility) như TV, dựng từ định nghĩa indicator. Mỗi lần mở là một Dialog mới (về tab Inputs, chụp lại setting để Cancel). */
export default function IndicatorSettingsDialog() {
  const uid = useIndicatorStore((st) => st.settingsUid);
  return uid ? <Dialog key={uid} uid={uid} /> : null;
}
