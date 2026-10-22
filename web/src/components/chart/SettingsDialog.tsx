import { useEffect, useState, type ReactNode } from "react";
import ColorPicker from "./ColorPicker";
import {
  AlertI,
  CalendarI,
  Candles,
  CanvasI,
  Chevron,
  Close,
  ScalesI,
  StatusLineI,
  TradingI,
} from "@/components/icons";
import { TIMEZONES, sampleDate, tzOffsetLabel } from "@/lib/timefmt";
import { useChartStore } from "@/store/chart";
import {
  CHART_THEMES,
  DATE_FORMATS,
  DEFAULT_SETTINGS,
  useSettingsStore,
  type ChartSettings,
} from "@/store/settings";

type Tab = "symbol" | "status" | "scales" | "canvas" | "trading" | "alerts" | "events";
const TABS: { id: Tab; label: string; icon: ReactNode; soon?: boolean }[] = [
  { id: "symbol", label: "Symbol", icon: <Candles /> },
  { id: "status", label: "Status line", icon: <StatusLineI /> },
  { id: "scales", label: "Scales and lines", icon: <ScalesI /> },
  { id: "canvas", label: "Canvas", icon: <CanvasI /> },
  { id: "trading", label: "Trading", icon: <TradingI /> },
  { id: "alerts", label: "Alerts", icon: <AlertI />, soon: true },
  { id: "events", label: "Events", icon: <CalendarI />, soon: true },
];

const SOON = "Sắp có";

// --- controls -------------------------------------------------------------
function Section({ children }: { children: ReactNode }) {
  return <div className="mb-3 mt-5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] first:mt-0">{children}</div>;
}

function Row({ label, children, soon }: { label?: ReactNode; children?: ReactNode; soon?: boolean }) {
  return (
    <div className={`flex min-h-10 items-center gap-3 ${soon ? "opacity-40" : ""}`} title={soon ? SOON : undefined}>
      {label !== undefined && <div className="w-40 shrink-0">{label}</div>}
      <div className={`flex items-center gap-2 ${soon ? "pointer-events-none" : ""}`}>{children}</div>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
  soon,
  indent,
  wide,
}: {
  label: string;
  checked: boolean;
  onChange?: (v: boolean) => void;
  soon?: boolean;
  indent?: boolean;
  wide?: boolean; // không có control bên cạnh -> nhãn dài hết dòng, không cắt
}) {
  return (
    <label
      className={`flex shrink-0 cursor-pointer select-none items-center gap-2 ${wide ? "" : "w-40"} ${indent ? "pl-6" : ""} ${soon ? "pointer-events-none" : ""}`}
    >
      <input
        type="checkbox"
        className="h-4 w-4 accent-[var(--accent)]"
        checked={checked}
        disabled={soon}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span className="truncate">{label}</span>
    </label>
  );
}

function CheckRow(props: Parameters<typeof Check>[0] & { children?: ReactNode }) {
  return (
    <div className={`flex min-h-10 items-center gap-3 ${props.soon ? "opacity-40" : ""}`} title={props.soon ? SOON : undefined}>
      <Check {...props} wide={!props.children} />
      {props.children && <div className="flex items-center gap-2">{props.children}</div>}
    </div>
  );
}

/** Ô màu: click mở bảng màu kiểu TV; `value` null = màu theo theme (`fallback`). */
function Swatch({ value, fallback, onChange, disabled }: {
  value: string | null;
  fallback?: string;
  onChange?: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <ColorPicker
      value={value ?? fallback ?? "#000000"}
      onChange={(v) => onChange?.(v)}
      disabled={disabled}
    />
  );
}

function Select<T extends string>({ value, options, onChange, width = 150, disabled }: {
  value: T;
  options: { value: T; label: string }[];
  onChange?: (v: T) => void;
  width?: number;
  disabled?: boolean;
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange?.(e.target.value as T)}
      style={{ width }}
      className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px] text-[var(--fg)] outline-none hover:border-[var(--muted)] focus:border-[var(--accent)] disabled:opacity-40"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Num({ value, onChange, min, max, suffix }: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  suffix?: string;
}) {
  return (
    <>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
        }}
        className="h-8 w-20 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px] text-[var(--fg)] outline-none hover:border-[var(--muted)] focus:border-[var(--accent)]"
      />
      {suffix && <span className="text-[var(--muted)]">{suffix}</span>}
    </>
  );
}

// --- tabs -------------------------------------------------------------------
type P = { s: ChartSettings; set: (p: Partial<ChartSettings>) => void };

function SymbolTab({ s, set }: P) {
  const digits = useChartStore((st) => st.symbols.find((x) => x.name === st.symbol)?.digits ?? 5);
  const pair = (on: keyof ChartSettings, up: keyof ChartSettings, down: keyof ChartSettings, label: string) => (
    <CheckRow label={label} checked={s[on] as boolean} onChange={(v) => set({ [on]: v })}>
      <Swatch value={s[up] as string} onChange={(v) => set({ [up]: v })} disabled={!s[on]} />
      <Swatch value={s[down] as string} onChange={(v) => set({ [down]: v })} disabled={!s[on]} />
    </CheckRow>
  );
  return (
    <>
      <Section>Candles</Section>
      <CheckRow label="Color bars based on previous close" checked={s.colorByPrevClose} onChange={(v) => set({ colorByPrevClose: v })} />
      {pair("body", "bodyUp", "bodyDown", "Body")}
      {pair("borders", "borderUp", "borderDown", "Borders")}
      {pair("wick", "wickUp", "wickDown", "Wick")}
      <Section>Data modification</Section>
      <Row label="Precision">
        <Select
          value={s.precision === null ? "default" : String(s.precision)}
          onChange={(v) => set({ precision: v === "default" ? null : Number(v) })}
          options={[
            { value: "default", label: `Default (${digits})` },
            ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: n === 0 ? "1" : `1/${10 ** n}` })),
          ]}
        />
      </Row>
      <Row label="Timezone">
        <Select
          value={s.timezone}
          width={220}
          onChange={(v) => set({ timezone: v })}
          options={TIMEZONES.map((z) => ({ value: z.id, label: `(${tzOffsetLabel(z.id)}) ${z.label}` }))}
        />
      </Row>
    </>
  );
}

function StatusTab({ s, set }: P) {
  return (
    <>
      <Section>Instrument</Section>
      <CheckRow label="Logo" checked={false} soon />
      <CheckRow label="Title" checked={s.showTitle} onChange={(v) => set({ showTitle: v })}>
        <Select
          value={s.titleMode}
          disabled={!s.showTitle}
          onChange={(v) => set({ titleMode: v })}
          options={[
            { value: "name", label: "Name" },
            { value: "description", label: "Description" },
          ]}
        />
      </CheckRow>
      <CheckRow label="Open market status" checked={false} soon />
      <CheckRow label="Chart values" checked={s.showChartValues} onChange={(v) => set({ showChartValues: v })} />
      <CheckRow label="Bar change values" checked={s.showBarChange} onChange={(v) => set({ showBarChange: v })} />
      <CheckRow label="Volume" checked={s.showVolume} onChange={(v) => set({ showVolume: v })} />
      <CheckRow label="Last day change values" checked={false} soon />
      <CheckRow label="Buy/sell buttons" checked={false} soon />
      <Section>Indicators</Section>
      <CheckRow label="Titles" checked={s.showIndicatorTitles} onChange={(v) => set({ showIndicatorTitles: v })} />
      <CheckRow
        label="Inputs"
        indent
        checked={s.showIndicatorInputs}
        soon={!s.showIndicatorTitles}
        onChange={(v) => set({ showIndicatorInputs: v })}
      />
      <CheckRow label="Values" checked={false} soon />
      <CheckRow label="Background" checked={false} soon />
    </>
  );
}

const LINE_MODES = [
  { value: "hidden", label: "Hidden" },
  { value: "value_line", label: "Value, line" },
] as const;

function ScalesTab({ s, set }: P) {
  return (
    <>
      <Section>Price scale</Section>
      <Row label="Currency and Unit" soon>
        <Select value="always" options={[{ value: "always", label: "Always visible" }]} />
      </Row>
      <Row label="Scale modes (A and L)" soon>
        <Select value="hover" options={[{ value: "hover", label: "Visible on mouse over" }]} />
      </Row>
      <CheckRow label="Lock price to bar ratio" checked={false} soon />
      <Row label="Scales placement" soon>
        <Select value="auto" options={[{ value: "auto", label: "Auto" }]} />
      </Row>
      <Section>Price labels &amp; lines</Section>
      <CheckRow label="No overlapping labels" checked soon />
      <CheckRow label="Plus button" checked={false} soon />
      <CheckRow label="Countdown to bar close" checked={s.countdown} onChange={(v) => set({ countdown: v })} />
      <Row label="Symbol">
        <Select
          value={s.symbolLabel}
          onChange={(v) => set({ symbolLabel: v })}
          options={[
            { value: "value_line", label: "Value, line" },
            { value: "value", label: "Value" },
            { value: "line", label: "Line" },
            { value: "hidden", label: "Hidden" },
          ]}
        />
      </Row>
      <Row label="Previous day close">
        <Select value={s.prevDayClose} onChange={(v) => set({ prevDayClose: v })} options={[...LINE_MODES]} />
        <Swatch value={s.prevDayCloseColor} disabled={s.prevDayClose === "hidden"} onChange={(v) => set({ prevDayCloseColor: v })} />
      </Row>
      <Row label="Indicators and financials" soon>
        <Select value="value" options={[{ value: "value", label: "Value" }]} />
      </Row>
      <Row label="High and low">
        <Select value={s.highLow} onChange={(v) => set({ highLow: v })} options={[...LINE_MODES]} />
        <Swatch value={s.highLowColor} disabled={s.highLow === "hidden"} onChange={(v) => set({ highLowColor: v })} />
      </Row>
      <Row label="Bid and ask">
        <Select value={s.bidAsk} onChange={(v) => set({ bidAsk: v })} options={[...LINE_MODES]} />
        <Swatch value={s.bidColor} disabled={s.bidAsk === "hidden"} onChange={(v) => set({ bidColor: v })} />
        <Swatch value={s.askColor} disabled={s.bidAsk === "hidden"} onChange={(v) => set({ askColor: v })} />
      </Row>
      <Section>Time scale</Section>
      <CheckRow label="Day of week on labels" checked={s.dayOfWeek} onChange={(v) => set({ dayOfWeek: v })} />
      <Row label="Date format">
        <Select
          value={s.dateFormat}
          onChange={(v) => set({ dateFormat: v })}
          options={DATE_FORMATS.map((f) => ({ value: f, label: `${s.dayOfWeek ? "Mon " : ""}${sampleDate(f)}` }))}
        />
      </Row>
      <Row label="Time hours format">
        <Select
          value={s.hours}
          width={110}
          onChange={(v) => set({ hours: v })}
          options={[
            { value: "24", label: "24-hours" },
            { value: "12", label: "12-hours" },
          ]}
        />
      </Row>
      <CheckRow label="Save chart left edge position when changing interval" checked={false} soon />
    </>
  );
}

function CanvasTab({ s, set }: P) {
  const theme = useChartStore((st) => st.theme);
  const t = CHART_THEMES[theme];
  return (
    <>
      <Section>Chart basic styles</Section>
      <Row label="Background">
        <Select
          value={s.bgType}
          width={130}
          onChange={(v) => set({ bgType: v })}
          options={[
            { value: "solid", label: "Solid" },
            { value: "gradient", label: "Gradient" },
          ]}
        />
        <Swatch value={s.bg} fallback={t.bg} onChange={(v) => set({ bg: v })} />
        {s.bgType === "gradient" && <Swatch value={s.bg2} fallback={t.bg} onChange={(v) => set({ bg2: v })} />}
      </Row>
      <CheckRow label="Vertical grid lines" checked={s.vertGrid} onChange={(v) => set({ vertGrid: v })}>
        <Swatch value={s.gridColor} fallback={t.grid} disabled={!s.vertGrid && !s.horzGrid} onChange={(v) => set({ gridColor: v })} />
      </CheckRow>
      <CheckRow label="Horizontal grid lines" checked={s.horzGrid} onChange={(v) => set({ horzGrid: v })} />
      <Row label="Crosshair">
        <Swatch value={s.crosshairColor} fallback={t.crosshair} onChange={(v) => set({ crosshairColor: v })} />
      </Row>
      <Row label="Watermark" soon>
        <Select value="replay" options={[{ value: "replay", label: "Replay mode" }]} />
      </Row>
      <Section>Scales</Section>
      <Row label="Text">
        <Swatch value={s.scaleTextColor} fallback={t.text} onChange={(v) => set({ scaleTextColor: v })} />
        <Select
          value={String(s.fontSize)}
          width={80}
          onChange={(v) => set({ fontSize: Number(v) })}
          options={[10, 11, 12, 13, 14, 16, 18, 20].map((n) => ({ value: String(n), label: String(n) }))}
        />
      </Row>
      <Row label="Lines">
        <Swatch value={s.scaleLineColor} fallback={t.grid} onChange={(v) => set({ scaleLineColor: v })} />
      </Row>
      <Section>Buttons</Section>
      <Row label="Navigation" soon>
        <Select value="hover" options={[{ value: "hover", label: "Visible on mouse over" }]} />
      </Row>
      <Row label="Pane" soon>
        <Select value="hover" options={[{ value: "hover", label: "Visible on mouse over" }]} />
      </Row>
      <Section>Margins</Section>
      <Row label="Top">
        <Num value={s.marginTop} min={0} max={50} suffix="%" onChange={(v) => set({ marginTop: v })} />
      </Row>
      <Row label="Bottom">
        <Num value={s.marginBottom} min={0} max={60} suffix="%" onChange={(v) => set({ marginBottom: v })} />
      </Row>
      <Row label="Right">
        <Num value={s.rightOffset} min={0} max={100} suffix="bars" onChange={(v) => set({ rightOffset: v })} />
      </Row>
    </>
  );
}

// --- dialog -----------------------------------------------------------------
// Setting lúc mở dialog (chỉ có 1 dialog) - Cancel/X/Esc trả về đúng bản này.
let snapshot: ChartSettings | null = null;
const closeSettings = () => useSettingsStore.setState({ open: false });
function cancelSettings() {
  if (snapshot) useSettingsStore.getState().replace(snapshot);
  closeSettings();
}

function TradingTab({ s, set }: P) {
  return (
    <>
      <Section>General</Section>
      <CheckRow label="One-click trading" checked={s.oneClick} onChange={(v) => set({ oneClick: v })} />
      <p className="-mt-1 mb-2 pl-7 text-[12px] text-[var(--muted)]">
        Instantly edit orders and close positions without confirmation. Off: closing a position asks in a dialog, and dragging an order, SL or TP that is already placed waits at the new price until you click Confirm on its tag (or Discard / Esc to undo).
      </p>
    </>
  );
}

/** Settings kiểu TradingView. Chỉnh là áp ngay lên chart (xem trước); Cancel/X/Esc trả về
 *  setting lúc mở dialog, Ok giữ lại. */
export default function SettingsDialog() {
  const open = useSettingsStore((st) => st.open);
  const s = useSettingsStore((st) => st.s);
  const set = useSettingsStore((st) => st.set);
  const [tab, setTab] = useState<Tab>("symbol");
  const [tplOpen, setTplOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    snapshot = useSettingsStore.getState().s;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancelSettings();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;
  const cancel = cancelSettings;
  const close = closeSettings;

  const body = { s, set };
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40" onMouseDown={(e) => e.target === e.currentTarget && cancel()}>
      <div
        role="dialog"
        aria-label="Settings"
        className="flex h-[min(640px,92vh)] w-[min(640px,96vw)] flex-col rounded-lg border border-[var(--border)] bg-[var(--bg)] text-[13px] text-[var(--fg)] shadow-2xl"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button type="button" aria-label="Close" onClick={cancel} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]">
            <Close />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-44 shrink-0 px-3 py-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={t.soon}
                title={t.soon ? SOON : undefined}
                onClick={() => setTab(t.id)}
                className={`mb-0.5 flex h-9 w-full items-center gap-2.5 rounded-md px-2.5 text-left disabled:opacity-40 ${
                  tab === t.id ? "bg-[var(--hover)] font-medium" : "enabled:hover:bg-[var(--hover)]"
                }`}
              >
                <span className="text-[var(--fg)]">{t.icon}</span>
                {t.label}
              </button>
            ))}
          </nav>
          <div className="min-w-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
            {tab === "symbol" && <SymbolTab {...body} />}
            {tab === "status" && <StatusTab {...body} />}
            {tab === "scales" && <ScalesTab {...body} />}
            {tab === "canvas" && <CanvasTab {...body} />}
            {tab === "trading" && <TradingTab {...body} />}
          </div>
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-5 py-3">
          <div className="relative">
            <button
              type="button"
              onClick={() => setTplOpen((v) => !v)}
              className="flex h-8 items-center gap-1 rounded-md border border-[var(--border)] px-3 hover:bg-[var(--hover)]"
            >
              Template <Chevron />
            </button>
            {tplOpen && (
              <div className="absolute bottom-10 left-0 z-10 w-44 rounded-md border border-[var(--border)] bg-[var(--bg)] py-1 shadow-2xl">
                <button
                  type="button"
                  onClick={() => {
                    useSettingsStore.getState().replace(DEFAULT_SETTINGS);
                    setTplOpen(false);
                  }}
                  className="flex h-8 w-full items-center px-3 text-left hover:bg-[var(--hover)]"
                >
                  Apply defaults
                </button>
              </div>
            )}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={cancel} className="h-8 rounded-md border border-[var(--fg)] px-3 hover:bg-[var(--hover)]">
              Cancel
            </button>
            <button type="button" onClick={close} className="h-8 rounded-md bg-[var(--fg)] px-4 font-medium text-[var(--bg)] hover:opacity-90">
              Ok
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
