"use client";

import { useChartStore } from "@/store/chart";
import { useEffect, useRef, useState } from "react";

// Quá ngưỡng này mà iframe của widget chưa load xong thì coi như lỗi mạng (hiện nút Retry).
const LOAD_TIMEOUT_MS = 15000;

// Embed widget công khai, free, không cần API key của chính TradingView - xem
// https://www.tradingview.com/economic-calendar-widget/. Script tự vẽ UI bên trong
// div con; phải tự tạo lại <script> mỗi lần đổi theme vì widget không đổi theme runtime.
export default function EconomicCalendarPanel() {
  const theme = useChartStore((s) => s.theme);
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";
    setState("loading");

    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    el.appendChild(widget);

    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-events.js";
    script.async = true;
    script.text = JSON.stringify({
      colorTheme: theme,
      isTransparent: false,
      width: "100%",
      height: "100%",
      locale: "en",
    });
    script.onerror = () => setState("error");
    el.appendChild(script);

    // Script chèn <iframe> vào div con một lúc sau khi chạy: xong khi iframe đó load.
    const mo = new MutationObserver(() => {
      const frame = el.querySelector("iframe");
      if (!frame) return;
      mo.disconnect();
      frame.addEventListener("load", () => setState("ready"), { once: true });
    });
    mo.observe(el, { childList: true, subtree: true });
    const timeout = setTimeout(() => setState((s) => (s === "loading" ? "error" : s)), LOAD_TIMEOUT_MS);

    return () => {
      mo.disconnect();
      clearTimeout(timeout);
      el.innerHTML = "";
    };
  }, [theme, attempt]);

  return (
    <div className="relative h-full w-full">
      <div ref={ref} className="tradingview-widget-container h-full w-full" />
      {state !== "ready" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[var(--bg)] text-sm text-[var(--muted)]">
          {state === "loading" ? (
            <>
              <div
                className="h-7 w-7 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--accent)]"
                role="status"
                aria-label="Loading"
              />
              <span>Loading economic calendar…</span>
            </>
          ) : (
            <>
              <span>Không tải được lịch kinh tế.</span>
              <button
                className="rounded border border-[var(--border)] px-3 py-1.5 text-[var(--fg)] hover:bg-[var(--hover)]"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
