"use client";

import { useSettingsStore } from "@/store/settings";
import { DEFAULT_VOLUME, useVolumeStore, volColor, type VolumeSettings } from "@/store/volume";
import { useRef } from "react";
import ColorPicker from "./ColorPicker";
import { Check, Section, SettingsFrame, VisibilityTab, field, num } from "./settingsParts";

function Dialog() {
  const s = useVolumeStore((st) => st.s);
  const set = useVolumeStore((st) => st.set);
  const cs = useSettingsStore((st) => st.s);
  // Chỉnh là áp ngay lên chart (xem trước); Cancel/X/Esc trả về setting lúc mở dialog, Ok giữ lại
  const snapshot = useRef<VolumeSettings>(useVolumeStore.getState().s);

  const close = () => useVolumeStore.setState({ open: false });
  const cancel = () => {
    useVolumeStore.getState().replace(snapshot.current);
    close();
  };

  return (
    <SettingsFrame
      title="Vol"
      label="Vol settings"
      onCancel={cancel}
      onOk={close}
      // trả về mặc định nhưng giữ trạng thái gỡ/ẩn
      onReset={() => set({ ...DEFAULT_VOLUME, removed: s.removed, hidden: s.hidden })}
    >
      {(tab) => (
        <>
          {tab === "inputs" && (
            <>
              <label className="flex items-center justify-between py-1.5">
                MA Length
                <input
                  className={`${field} w-20`}
                  type="number"
                  min={1}
                  value={s.maLength}
                  onChange={(e) => {
                    const n = Math.round(num(e.target.value, s.maLength));
                    if (n >= 1) set({ maLength: n });
                  }}
                />
              </label>
              <Check label="Color based on previous close" checked={s.colorByPrevClose} onChange={(v) => set({ colorByPrevClose: v })} />
            </>
          )}

          {tab === "style" && (
            <>
              <Check label="Volume" checked={s.show} onChange={(v) => set({ show: v })} />
              <div className="flex items-center justify-between py-1.5 pl-6">
                Growing
                <ColorPicker value={volColor(s, cs, true)} onChange={(c) => set({ growing: c })} className="h-7 w-12 p-1" />
              </div>
              <div className="flex items-center justify-between py-1.5 pl-6">
                Falling
                <ColorPicker value={volColor(s, cs, false)} onChange={(c) => set({ falling: c })} className="h-7 w-12 p-1" />
              </div>
              <div className="flex items-center justify-between">
                <Check label="Volume MA" checked={s.maOn} onChange={(v) => set({ maOn: v })} />
                <ColorPicker value={s.maColor} onChange={(c) => set({ maColor: c })} className="h-7 w-12 p-1" />
              </div>

              <Section>Output values</Section>
              <label className="flex items-center justify-between py-1.5">
                Precision
                <select
                  className={`${field} w-28`}
                  value={s.precision ?? "default"}
                  onChange={(e) => set({ precision: e.target.value === "default" ? null : Number(e.target.value) })}
                >
                  <option value="default">Default</option>
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <Check label="Labels on price scale" checked={s.priceLabel} onChange={(v) => set({ priceLabel: v })} />
              <Check label="Values in status line" checked={s.statusValues} onChange={(v) => set({ statusValues: v })} />

              <Section>Input values</Section>
              <Check label="Inputs in status line" checked={s.statusInputs} onChange={(v) => set({ statusInputs: v })} />
            </>
          )}

          {tab === "visibility" && <VisibilityTab value={s.visibility} onChange={(visibility) => set({ visibility })} />}
        </>
      )}
    </SettingsFrame>
  );
}

/** Settings của indicator Volume (Inputs / Style / Visibility) như TV. Mỗi lần mở là một Dialog mới (về tab Inputs, chụp lại setting để Cancel). */
export default function VolumeSettingsDialog() {
  const open = useVolumeStore((st) => st.open);
  return open ? <Dialog /> : null;
}
