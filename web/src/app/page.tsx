"use client";

import Chart from "@/components/chart/Chart";
import DrawingToolbar from "@/components/chart/DrawingToolbar";
import RightRail from "@/components/chart/RightRail";
import Toolbar from "@/components/chart/Toolbar";
import { useDrawingStore } from "@/drawings/store";
import { useChartStore } from "@/store/chart";
import { useEffect, useState } from "react";

export default function Page() {
  const theme = useChartStore((s) => s.theme);
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([
      useChartStore.persist.rehydrate(),
      useDrawingStore.persist.rehydrate(),
    ]).then(() => {
      if (active) setPrefsReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!prefsReady) {
    return <div data-theme={theme} className="h-screen bg-[var(--bg)]" />;
  }

  return (
    <div
      data-theme={theme}
      className="flex h-screen flex-col bg-[var(--bg)] text-[var(--fg)]"
    >
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <DrawingToolbar />
        <main className="min-w-0 flex-1">
          <Chart />
        </main>
        <RightRail />
      </div>
    </div>
  );
}
