"use client";

import { useChartStore } from "@/store/chart";
import { useEffect, useRef } from "react";

// Embed widget công khai, free, không cần API key của chính TradingView - xem
// https://www.tradingview.com/economic-calendar-widget/. Script tự vẽ UI bên trong
// div con; phải tự tạo lại <script> mỗi lần đổi theme vì widget không đổi theme runtime.
export default function EconomicCalendarPanel() {
  const theme = useChartStore((s) => s.theme);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = "";

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
    el.appendChild(script);

    return () => {
      el.innerHTML = "";
    };
  }, [theme]);

  return <div ref={ref} className="tradingview-widget-container h-full w-full" />;
}
