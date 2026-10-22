"use client";

import AuthDialog from "@/components/auth/AuthDialog";
import Toasts from "@/components/Toasts";
import ChartGrid from "@/components/chart/ChartGrid";
import DrawingSettings from "@/components/chart/DrawingSettings";
import SettingsDialog from "@/components/chart/SettingsDialog";
import VolumeSettingsDialog from "@/components/chart/VolumeSettingsDialog";
import DrawingToolbar from "@/components/chart/DrawingToolbar";
import RightRail from "@/components/chart/RightRail";
import Toolbar from "@/components/chart/Toolbar";
import { drawingGlobal } from "@/drawings/store";
import { useAuthStore } from "@/store/auth";
import { chartGlobal, useChartStore } from "@/store/chart";
import { PRIMARY_PANE_ID, getPane } from "@/store/layout";
import { bindPanePersistence, loadPaneInit } from "@/store/paneStorage";
import { useEffect, useState } from "react";

export default function Page() {
  const theme = useChartStore((s) => s.theme);
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    void useAuthStore.getState().refresh(); // ai đang đăng nhập? (khách / user)
  }, []);

  useEffect(() => {
    let active = true;
    let unbind: (() => void) | null = null;
    // Đọc state chart đã lưu (kể cả key cũ cần migrate) TRƯỚC khi các store chung rehydrate: chúng ghi lại các key cũ
    const init = loadPaneInit(localStorage);
    Promise.all([chartGlobal.persist.rehydrate(), drawingGlobal.persist.rehydrate()]).then(() => {
      if (!active) return;
      // chart chính (symbol, tf, indicator, volume...) nạp từ localStorage rồi tự lưu khi đổi
      unbind = bindPanePersistence(getPane(PRIMARY_PANE_ID), localStorage, {
        init,
        onUnload: (flush) => {
          window.addEventListener("pagehide", flush);
          return () => window.removeEventListener("pagehide", flush);
        },
      });
      setPrefsReady(true);
    });
    return () => {
      active = false;
      unbind?.();
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
          <ChartGrid />
        </main>
        <RightRail />
      </div>
      {/* hộp thoại dùng chung: một bản cho cả trang, nhắm vào chart đang active */}
      <SettingsDialog />
      <VolumeSettingsDialog />
      <DrawingSettings />
      <AuthDialog />
      <Toasts />
    </div>
  );
}
