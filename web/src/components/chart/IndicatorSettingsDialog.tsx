"use client";

import { byId } from "@/indicators/catalog";
import { plotColor, plotShown, resolveInputs, showsPriceLabel, type IndicatorInstance } from "@/indicators/instance";
import type { InputDef } from "@/indicators/schema";
import { SOURCES } from "@/indicators/ta";
import { useIndicatorStore } from "@/indicators/store";
import { useRef } from "react";
import ColorPicker from "./ColorPicker";
import { Check, Section, SettingsFrame, VisibilityTab, field, num } from "./settingsParts";

function InputRow({ def, value, onChange }: { def: InputDef; value: number | string | boolean; onChange: (v: number | string | boolean) => void }) {
  if (def.type === "bool") return <Check label={def.label} checked={value as boolean} onChange={onChange} />;
  return (
    <label className="flex items-center justify-between py-1.5" title={def.tooltip}>
      {def.label}
      {def.type === "int" || def.type === "float" ? (
        <input
          className={`${field} w-20`}
          type="number"
          min={def.min}
          max={def.max}
          step={def.step ?? (def.type === "int" ? 1 : "any")}
          value={value as number}
          onChange={(e) => {
            // ô trống / ngoài khoảng cho phép thì giữ giá trị cũ: chart luôn tính được
            const n = num(e.target.value, NaN);
            if (Number.isFinite(n) && n >= (def.min ?? -Infinity) && n <= (def.max ?? Infinity)) onChange(n);
          }}
        />
      ) : (
        <select className={`${field} w-28`} value={value as string} onChange={(e) => onChange(e.target.value)}>
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
  const setPlot = (id: string, patch: { color?: string; visible?: boolean }) =>
    update(uid, {
      style: {
        ...inst.style,
        plots: {
          ...inst.style?.plots,
          // bật lại plot thì bỏ khoá `visible` (mặc định = hiện) cho gọn dữ liệu lưu
          [id]: Object.fromEntries(Object.entries({ ...inst.style?.plots?.[id], ...patch }).filter(([k, v]) => !(k === "visible" && v === true))),
        },
      },
    });

  return (
    <SettingsFrame
      title={def.name}
      label={`${def.name} settings`}
      onCancel={cancel}
      onOk={close}
      // trả về mặc định nhưng giữ trạng thái ẩn
      onReset={() => useIndicatorStore.getState().replace({ v: inst.v, uid, id: inst.id, inputs: {}, ...(inst.hidden ? { hidden: true } : {}) })}
    >
      {(tab) => (
        <>
          {tab === "inputs" &&
            (def.inputs.length === 0 ? (
              <div className="py-2 text-[var(--muted)]">This indicator has no inputs.</div>
            ) : (
              def.inputs.map((d) => (
                <InputRow key={d.key} def={d} value={inputs[d.key]} onChange={(v) => update(uid, { inputs: { ...inst.inputs, [d.key]: v } })} />
              ))
            ))}

          {tab === "style" && (
            <>
              {def.plots.map((p) => (
                <div key={p.id} className="flex items-center justify-between">
                  <Check label={p.title} checked={plotShown(inst, p.id)} onChange={(visible) => setPlot(p.id, { visible })} />
                  {!p.perBar && (
                    <ColorPicker value={plotColor(inst, def, p.id)} onChange={(color) => setPlot(p.id, { color })} className="h-7 w-12 p-1" />
                  )}
                </div>
              ))}

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
