import { useEffect, useState, type ReactNode } from "react";
import { useAlertPrefs, useAlertStore, useSettingsTab, type AlertSound } from "@/alerts/store";
import { playAlertSound, unlockAudio } from "@/alerts/sound";
import { useRulesStore } from "@/alerts/rules";
import { IMPORTANCE_CHOICES, LEAD_CHOICES, MAX_LEADS, currencyChoices, leadLabel, ruleProblem, toggleCurrency, toggleLead } from "@/alerts/rulesModel";
import { MT5_OWNER_ONLY } from "@/alerts/model";
import { linkTelegram, testChannel, unlinkTelegram, type AlertChannels, type ChannelKind, type NewsRule, type Rules, type TradeRule } from "@/lib/alertsApi";
import { useAuthStore } from "@/store/auth";
import { toast } from "@/store/toast";
import { enableDesktopNotifications } from "./AlertHost";
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
import { sampleDate, sortedTimezones, tzMenuLabel } from "@/lib/timefmt";
import { useChartStore } from "@/store/chart";
import {
  CHART_THEMES,
  DATE_FORMATS,
  DEFAULT_SETTINGS,
  useSettingsStore,
  type ChartSettings,
} from "@/store/settings";

type Tab = "symbol" | "status" | "scales" | "canvas" | "trading" | "events" | "alerts";
const TABS: { id: Tab; label: string; icon: ReactNode; soon?: boolean }[] = [
  { id: "symbol", label: "Symbol", icon: <Candles /> },
  { id: "status", label: "Status line", icon: <StatusLineI /> },
  { id: "scales", label: "Scales and lines", icon: <ScalesI /> },
  { id: "canvas", label: "Canvas", icon: <CanvasI /> },
  { id: "trading", label: "Trading", icon: <TradingI /> },
  { id: "events", label: "Events", icon: <CalendarI /> },
  { id: "alerts", label: "Alerts", icon: <AlertI /> },
];

const SOON = "Sắp có";

// --- controls -------------------------------------------------------------
function Section({ children }: { children: ReactNode }) {
  return <div className="mb-3 mt-5 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] first:mt-0">{children}</div>;
}

function Row({ label, children, soon }: { label?: ReactNode; children?: ReactNode; soon?: boolean }) {
  return (
    <div className={`flex min-h-10 items-center gap-3 ${soon ? "opacity-55" : ""}`} title={soon ? SOON : undefined}>
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
    <div className={`flex min-h-10 items-center gap-3 ${props.soon ? "opacity-55" : ""}`} title={props.soon ? SOON : undefined}>
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
      className="h-8 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 text-[13px] text-[var(--fg)] outline-none hover:border-[var(--muted)] focus:border-[var(--accent)] disabled:opacity-55"
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
          options={sortedTimezones().map((z) => ({ value: z.id, label: tzMenuLabel(z) }))}
        />
      </Row>
    </>
  );
}

function EventsTab({ s, set }: P) {
  return (
    <>
      <Section>Economic events</Section>
      <CheckRow label="Show economic events on chart" checked={s.showEvents} onChange={(v) => set({ showEvents: v })} />
      <Row label="Importance">
        <Select
          value={String(s.eventsMinImportance)}
          disabled={!s.showEvents}
          onChange={(v) => set({ eventsMinImportance: Number(v) as 1 | 2 | 3 })}
          options={[
            { value: "1", label: "Low and above" },
            { value: "2", label: "Medium and above" },
            { value: "3", label: "High only" },
          ]}
        />
      </Row>
      <div className="mt-3 max-w-[360px] text-xs leading-relaxed text-[var(--muted)]">
        Biểu tượng cờ nằm sát trục thời gian, tại giờ công bố; chỉ hiện sự kiện SẮP TỚI của các đồng tiền của symbol đang xem. Bấm vào để xem tên, dự báo, kỳ trước. Lịch lấy từ MT5 qua EA TVBridge ≥ 2.15.
      </div>
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
        <Swatch value={s.gridColor} fallback={t.gridDot} disabled={!s.vertGrid && !s.horzGrid} onChange={(v) => set({ gridColor: v })} />
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

const SOUNDS: { value: AlertSound; label: string }[] = [
  { value: "chime", label: "Chime" },
  { value: "beep", label: "Beep" },
  { value: "alarm", label: "Alarm" },
  { value: "off", label: "Off" },
];
const POLL_LINK_MS = 3000;
const LINK_WAIT_MS = 10 * 60 * 1000;

/** Nút gửi thử một kênh: kết quả hiện ngay cạnh nút (và trong toast) để biết kênh nào hỏng và vì sao. */
function TestButton({ kind, disabled }: { kind: ChannelKind; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<{ ok: boolean; detail: string } | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true);
          const r = await testChannel(kind);
          setBusy(false);
          setRes(r.ok ? r.data : { ok: false, detail: r.error });
          if (r.ok && r.data.ok && kind !== "web") toast("Đã gửi tin thử", { kind: "success" });
        }}
        className="h-8 shrink-0 rounded-md border border-[var(--border)] px-3 hover:bg-[var(--hover)] disabled:opacity-55"
      >
        {busy ? "Sending…" : "Send test"}
      </button>
      {res && <span className={`min-w-0 max-w-[260px] text-[12px] ${res.ok ? "text-[#089981]" : "text-[#f23645]"}`}>{res.ok ? "OK" : res.detail}</span>}
    </>
  );
}

/** Nút bật / tắt nhỏ cho danh sách lựa chọn nhiều mục (mốc báo trước, đồng tiền). */
function Chip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`h-7 shrink-0 whitespace-nowrap rounded-md border px-2.5 text-[12px] ${on ? "border-[var(--accent)] bg-[var(--selected)] text-[var(--fg)]" : "border-[var(--border)] text-[var(--muted)] hover:bg-[var(--hover)]"}`}
    >
      {children}
    </button>
  );
}

/** Một dòng nhãn + dãy chip tự xuống dòng khi hết chỗ. */
function ChipRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-10 items-start gap-3 py-1.5">
      <div className="w-40 shrink-0 pt-1">{label}</div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** Lưu một phần quy tắc; chặn trước các trường hợp backend chắc chắn từ chối (bật mà không có kênh...) và báo lý do bằng toast. */
async function saveRule<K extends keyof Rules>(kind: K, rule: Rules[K], patch: Partial<Rules[K]>, tgLinked: boolean | null) {
  const problem = ruleProblem(kind, { ...rule, ...patch }, tgLinked);
  if (problem) return void toast(problem, { kind: "error" });
  const r = await useRulesStore.getState().save(kind, patch);
  if (!r.ok) toast(r.error, { kind: "error" });
}

function RuleChannels({ value, tgLinked, onChange }: { value: AlertChannels; tgLinked: boolean; onChange: (c: AlertChannels) => void }) {
  const set = (k: ChannelKind, v: boolean) => onChange({ ...value, [k]: v });
  return (
    <div className="flex min-h-10 items-center gap-3">
      <div className="w-40 shrink-0">Send via</div>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 py-1">
        <Check wide label="Web" checked={value.web} onChange={(v) => set("web", v)} />
        <Check wide label="Telegram" checked={value.telegram && tgLinked} soon={!tgLinked} onChange={(v) => set("telegram", v)} />
        <Check wide label="MT5 mobile" checked={value.mt5} onChange={(v) => set("mt5", v)} />
      </div>
    </div>
  );
}

function NewsRuleSection({ rule, tgLinked }: { rule: NewsRule; tgLinked: boolean }) {
  const save = (patch: Partial<NewsRule>) => saveRule("news", rule, patch, tgLinked);
  const dim = rule.enabled ? "" : "opacity-55";
  return (
    <>
      <Section>Economic news reminders</Section>
      <CheckRow label="Remind me before events" checked={rule.enabled} wide onChange={(v) => void save({ enabled: v })} />
      <div className={dim}>
        <ChipRow label="Remind before">
          {LEAD_CHOICES.map((m) => (
            <Chip
              key={m}
              on={rule.leads.includes(m)}
              title={`Chọn tối đa ${MAX_LEADS} mốc`}
              onClick={() => {
                const next = toggleLead(rule.leads, m);
                if (next) void save({ leads: next });
                else toast(rule.leads.includes(m) ? "Phải còn ít nhất một mốc báo trước" : `Tối đa ${MAX_LEADS} mốc báo trước`, { kind: "info" });
              }}
            >
              {leadLabel(m)}
            </Chip>
          ))}
        </ChipRow>
        <Row label="Importance">
          <Select value={String(rule.min_importance) as "1" | "2" | "3"} options={IMPORTANCE_CHOICES.map((o) => ({ value: String(o.value) as "1" | "2" | "3", label: o.label }))} onChange={(v) => void save({ min_importance: Number(v) as NewsRule["min_importance"] })} />
        </Row>
        <ChipRow label="Currencies">
          {currencyChoices(rule.currencies).map((c) => (
            <Chip key={c} on={rule.currencies.includes(c)} onClick={() => void save({ currencies: toggleCurrency(rule.currencies, c) })}>
              {c}
            </Chip>
          ))}
          {rule.currencies.length === 0 && <span className="text-[12px] text-[var(--muted)]">none selected = all currencies</span>}
        </ChipRow>
        <RuleChannels value={rule.channels} tgLinked={tgLinked} onChange={(channels) => void save({ channels })} />
      </div>
      <p className="max-w-[460px] text-[12px] leading-relaxed text-[var(--muted)]">
        Lịch lấy từ MT5 (EA gửi lên). Các sự kiện cùng giờ gộp thành một tin; sự kiện không có giờ cụ thể (cả ngày, dự kiến) không được nhắc. Backend nhắc cả khi tắt tab, miễn là backend đang chạy.
      </p>
    </>
  );
}

function TradeRuleSection({ rule, tgLinked }: { rule: TradeRule; tgLinked: boolean }) {
  const save = (patch: Partial<TradeRule>) => saveRule("trade", rule, patch, tgLinked);
  const dim = rule.enabled ? "" : "opacity-55";
  return (
    <>
      <Section>Trading events</Section>
      <CheckRow label="Notify on SL / TP and pending fills" checked={rule.enabled} wide onChange={(v) => void save({ enabled: v })} />
      <div className={dim}>
        <CheckRow label="Stop loss hit" checked={rule.sl} indent wide onChange={(v) => void save({ sl: v })} />
        <CheckRow label="Take profit hit" checked={rule.tp} indent wide onChange={(v) => void save({ tp: v })} />
        <CheckRow label="Pending order filled" checked={rule.fill} indent wide onChange={(v) => void save({ fill: v })} />
        <RuleChannels value={rule.channels} tgLinked={tgLinked} onChange={(channels) => void save({ channels })} />
      </div>
      <p className="max-w-[460px] text-[12px] leading-relaxed text-[var(--muted)]">
        Theo dõi account MT5 đang kết nối (EA phải online); vị thế bị stop out luôn được báo. Deal xảy ra lúc backend tắt được báo bù khi nối lại, gắn &quot;(trễ)&quot;. Lệnh thị trường và đóng tay không báo.
      </p>
    </>
  );
}

function AlertsTab() {
  const status = useAuthStore((st) => st.status);
  const prefs = useAlertPrefs();
  const info = useAlertStore((st) => st.channels);
  const [linking, setLinking] = useState(false);
  const user = status === "user";

  const rules = useRulesStore((st) => st.rules);
  useEffect(() => {
    if (user) {
      void useAlertStore.getState().refreshChannels();
      void useRulesStore.getState().load();
    }
  }, [user]);

  // Đang chờ người dùng bấm Start ở Telegram: hỏi lại trạng thái cho tới khi liên kết xong (hoặc hết hạn mã)
  const waiting = linking && !info?.telegram.linked; // liên kết xong thì thôi chờ
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void useAlertStore.getState().refreshChannels(), POLL_LINK_MS);
    const stop = setTimeout(() => setLinking(false), LINK_WAIT_MS);
    return () => {
      clearInterval(t);
      clearTimeout(stop);
    };
  }, [waiting]);

  const setDefault = (k: keyof AlertChannels, v: boolean) => prefs.set({ channels: { ...prefs.channels, [k]: v } });
  const tg = info?.telegram;
  const m = info?.mt5;
  return (
    <>
      <Section>This device</Section>
      <Row label="Sound">
        <Select value={prefs.sound} options={SOUNDS} onChange={(v) => { unlockAudio(); prefs.set({ sound: v }); playAlertSound(v); }} />
      </Row>
      <CheckRow
        label="Desktop notifications"
        checked={prefs.desktop}
        onChange={async (v) => {
          if (v && !(await enableDesktopNotifications())) {
            toast("Trình duyệt đang chặn thông báo của trang này. Cho phép trong cài đặt trang (biểu tượng ổ khoá cạnh địa chỉ) rồi bật lại.", { kind: "error", ms: 9000 });
            return;
          }
          prefs.set({ desktop: v });
        }}
      />
      <p className="-mt-1 mb-2 pl-7 text-[12px] text-[var(--muted)]">Hiện khi alert nổ mà bạn đang ở tab / cửa sổ khác. Chỉ hoạt động khi còn một tab Wickloom mở; tắt hết tab thì dùng Telegram hoặc MT5.</p>
      <Section>Default channels for new alerts</Section>
      <CheckRow label="Web (toast, sound)" checked={prefs.channels.web} onChange={(v) => setDefault("web", v)} />
      <CheckRow label="Telegram" checked={prefs.channels.telegram && !!tg?.linked} soon={!tg?.linked} onChange={(v) => setDefault("telegram", v)} />
      <CheckRow label="MT5 mobile push" checked={prefs.channels.mt5} onChange={(v) => setDefault("mt5", v)} />
      {!user ? (
        <p className="mt-4 text-[12px] text-[var(--muted)]">Đăng nhập để kết nối Telegram, MT5 và tạo alert.</p>
      ) : (
        <>
          <Section>Browser (this tab)</Section>
          <Row label="Delivery path">
            <TestButton kind="web" />
          </Row>
          <Section>Telegram</Section>
          {!tg ? (
            <p className="text-[var(--muted)]">Đang tải…</p>
          ) : !tg.configured ? (
            <p className="max-w-[420px] text-[12px] leading-relaxed text-[var(--muted)]">
              Backend chưa có bot. Tạo bot qua @BotFather, đặt biến môi trường <code>WICKLOOM_TG_BOT_TOKEN</code> cho backend rồi khởi động lại. Token chỉ nằm ở backend, không bao giờ gửi xuống trình duyệt.
            </p>
          ) : tg.linked ? (
            <Row label={<span>Connected{tg.name ? ` (${tg.name})` : ""}</span>}>
              <TestButton kind="telegram" />
              <button
                type="button"
                className="h-8 rounded-md border border-[var(--border)] px-3 hover:bg-[var(--hover)]"
                onClick={async () => {
                  const r = await unlinkTelegram();
                  if (r.ok) {
                    setLinking(false);
                    prefs.set({ channels: { ...prefs.channels, telegram: false } });
                    void useAlertStore.getState().refreshChannels();
                  } else toast(r.error, { kind: "error" });
                }}
              >
                Disconnect
              </button>
            </Row>
          ) : (
            <>
              <Row>
                <button
                  type="button"
                  className="h-8 rounded-md bg-[var(--fg)] px-4 font-medium text-[var(--bg)] hover:opacity-90"
                  onClick={async () => {
                    const r = await linkTelegram();
                    if (!r.ok) return toast(r.error, { kind: "error" });
                    window.open(r.data.url, "_blank", "noopener,noreferrer");
                    setLinking(true);
                  }}
                >
                  Connect Telegram
                </button>
                {waiting && <span className="text-[12px] text-[var(--muted)]">Mở Telegram, bấm Start… (mã hết hạn sau 10 phút)</span>}
              </Row>
            </>
          )}
          <Section>MT5 mobile push</Section>
          {!m ? (
            <p className="text-[var(--muted)]">Đang tải…</p>
          ) : (
            <>
              {m.allowed === false && <p className="mb-1 text-[#ff9800]">{MT5_OWNER_ONLY}</p>}
              <Row label="EA">
                <span className={m.online ? "" : "text-[#ff9800]"}>{m.online ? `Online${m.version ? ` (v${m.version})` : ""}` : "Offline"}</span>
              </Row>
              <Row label="Push notifications">
                <span className={m.push_enabled === false ? "text-[#ff9800]" : ""}>{m.push_enabled === null ? "Chưa biết (EA chưa báo)" : m.push_enabled ? "Enabled in MT5" : "Disabled in MT5"}</span>
              </Row>
              <Row label="Test">
                <TestButton kind="mt5" disabled={!m.online || m.allowed === false} />
              </Row>
              <p className="mt-1 max-w-[420px] text-[12px] leading-relaxed text-[var(--muted)]">
                Cài MetaTrader 5 trên điện thoại, lấy MetaQuotes ID (Settings → Messages) và nhập vào MT5 trên máy này: Tools → Options → Notifications, tick Enable Push Notifications. Điện thoại nhận theo
                terminal MT5, không theo tài khoản Wickloom. EA cần bản 2.19+ (biên dịch lại bằng F7). Tối đa 8 tin/phút; tin dồn dập được gộp.
              </p>
            </>
          )}
          {rules ? (
            <>
              <NewsRuleSection rule={rules.news} tgLinked={!!tg?.linked} />
              <TradeRuleSection rule={rules.trade} tgLinked={!!tg?.linked} />
            </>
          ) : (
            <>
              <Section>Economic news reminders</Section>
              <p className="text-[var(--muted)]">Đang tải…</p>
            </>
          )}
        </>
      )}
    </>
  );
}

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
        Sửa lệnh và đóng vị thế ngay, không cần xác nhận. Tắt: đóng vị thế sẽ hỏi bằng hộp thoại, còn kéo lệnh, SL hoặc TP đã đặt sẽ dừng ở giá mới và chờ bạn bấm Confirm trên thẻ của nó (hoặc Discard / Esc để hoàn tác). Trên điện thoại luôn hỏi xác nhận, kể cả khi bật.
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
  // "Mở Settings → Alerts" từ hộp thoại alert / panel: mỗi lần yêu cầu tăng `tick`, đổi tab ngay trong lần render đó (không qua effect)
  const alertsTick = useSettingsTab((st) => st.tick);
  const [seenTick, setSeenTick] = useState(alertsTick);
  if (alertsTick !== seenTick) {
    setSeenTick(alertsTick);
    setTab("alerts");
  }

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
        className="flex h-[min(640px,92vh)] w-[min(640px,96vw)] flex-col rounded-lg popup text-sm"
      >
        <div className="flex items-center justify-between px-5 pb-2 pt-4">
          <h2 className="text-lg font-semibold">Settings</h2>
          <button type="button" aria-label="Close" onClick={cancel} className="rounded p-1 text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)]">
            <Close />
          </button>
        </div>
        <div className="flex min-h-0 flex-1">
          <nav className="w-48 shrink-0 px-3 py-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                disabled={t.soon}
                title={t.soon ? SOON : undefined}
                onClick={() => setTab(t.id)}
                className={`mb-0.5 flex h-9 w-full items-center gap-2.5 whitespace-nowrap rounded-md px-2.5 text-left disabled:opacity-55 ${
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
            {tab === "events" && <EventsTab {...body} />}
            {tab === "alerts" && <AlertsTab />}
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
              <div className="absolute bottom-10 left-0 z-10 w-44 rounded-md popup py-1">
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
          {/* Ghi công theo giấy phép lightweight-charts (đã gỡ khỏi thanh dưới chart) */}
          <a href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer" className="text-[11px] text-[var(--muted)] hover:underline">
            Charts by TradingView
          </a>
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
