"use client";

import { inputsText, instanceShown, type IndicatorInstance } from "@/indicators/instance";
import { fmtPlotValue, legendDigits, visiblePlotValues } from "@/indicators/legend";
import type { PlotValue } from "@/indicators/manager";
import { byId } from "@/indicators/catalog";
import { useSettingsStore } from "@/store/settings";
import { DotsIc, EyeIc, GearIc, IconBtn, TrashIc } from "./legendButtons";

/** Hàng legend của một indicator ("EMA 20 close 4,121.553"): rê chuột vào hiện nút ẩn / Settings / gỡ / menu, nhấp đúp mở Settings. Giống hàng Vol. */
export default function IndicatorLegend({
  inst,
  tf,
  symbolDigits,
  getValues,
  onHide,
  onSettings,
  onRemove,
  onMenu,
}: {
  inst: IndicatorInstance;
  tf: string;
  symbolDigits: number;
  getValues: (uid: string) => PlotValue[] | undefined; // giá trị theo nến dưới crosshair (không có thì nến cuối)
  onHide: () => void;
  onSettings: () => void;
  onRemove: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const cs = useSettingsStore((st) => st.s);
  const def = byId(inst.id);
  const dim = inst.hidden || !instanceShown(inst, tf); // ẩn bằng mắt hoặc ngoài khung thời gian cho phép
  const digits = legendDigits(inst, def, symbolDigits);
  const params = inst.statusInputs === false ? "" : inputsText(def, inst);
  const shown = inst.statusValues === false || inst.hidden ? [] : visiblePlotValues(inst, getValues(inst.uid));

  return (
    <div
      onDoubleClick={onSettings}
      className={`group/ind pointer-events-auto flex w-fit items-center gap-x-1.5 rounded border border-transparent pr-1 hover:border-[var(--border)] ${dim ? "opacity-50" : ""}`}
    >
      {cs.showIndicatorTitles && <span className="text-[var(--fg)]">{def.name}</span>}
      {cs.showIndicatorInputs && params && <span className="text-[var(--muted)]">{params}</span>}
      {shown.map((v) => (
        <span key={v.id} style={{ color: v.color }}>{fmtPlotValue(v.value, digits)}</span>
      ))}
      <span className="hidden items-center group-hover/ind:flex">
        <IconBtn title={inst.hidden ? "Show" : "Hide"} onClick={onHide}>
          <EyeIc off={!!inst.hidden} />
        </IconBtn>
        <IconBtn title="Settings" onClick={onSettings}>
          <GearIc />
        </IconBtn>
        <IconBtn title="Remove" onClick={onRemove}>
          <TrashIc />
        </IconBtn>
        <IconBtn
          title="More"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.left, r.bottom + 4);
          }}
        >
          <DotsIc />
        </IconBtn>
      </span>
    </div>
  );
}
