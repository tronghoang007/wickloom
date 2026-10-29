"use client";

import AuthDialog from "@/components/auth/AuthDialog";
import AlertDialog from "@/components/chart/AlertDialog";
import AlertHost from "@/components/chart/AlertHost";
import Toasts from "@/components/Toasts";
import ConfirmHost from "@/components/ConfirmHost";
import ChartGrid from "@/components/chart/ChartGrid";
import DrawingSettings from "@/components/chart/DrawingSettings";
import OpenLayoutDialog from "@/components/chart/OpenLayoutDialog";
import SettingsDialog from "@/components/chart/SettingsDialog";
import IndicatorSettingsDialog from "@/components/chart/IndicatorSettingsDialog";
import VolumeSettingsDialog from "@/components/chart/VolumeSettingsDialog";
import DrawingToolbar from "@/components/chart/DrawingToolbar";
import RightRail from "@/components/chart/RightRail";
import TradingPanel from "@/components/chart/TradingPanel";
import Toolbar from "@/components/chart/Toolbar";
import { drawingGlobal } from "@/drawings/store";
import { useAuthStore } from "@/store/auth";
import { chartGlobal, useChartStore } from "@/store/chart";
import { appSession } from "@/store/appSession";
import { PrefsSync } from "@/store/prefsSync";
import { loadPaneInit } from "@/store/paneStorage";
import { useEffect, useState } from "react";

export default function Page() {
  const theme = useChartStore((s) => s.theme);
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    void useAuthStore.getState().refresh(); // ai đang đăng nhập? (khách / user)
  }, []);

  useEffect(() => {
    let active = true;
    let started = false;
    const prefs = new PrefsSync(); // mặc định công cụ vẽ theo tài khoản
    // Đọc state chart đã lưu (kể cả key cũ cần migrate) TRƯỚC khi các store chung rehydrate: chúng ghi lại các key cũ
    const init = loadPaneInit(localStorage);
    Promise.all([chartGlobal.persist.rehydrate(), drawingGlobal.persist.rehydrate()]).then(() => {
      if (!active) return;
      // chọn layout ban đầu (cache của user lần trước / khách), nghe đăng nhập–đăng xuất, tự lưu
      appSession().start({ guestInit: init });
      prefs.start();
      started = true;
      setPrefsReady(true);
    });
    return () => {
      active = false;
      if (started) appSession().stop();
      prefs.stop();
    };
  }, []);

  if (!prefsReady) {
    return <div data-theme={theme} className="h-dvh bg-[var(--bg)]" />;
  }

  return (
    <div
      data-theme={theme}
      // h-dvh: trên điện thoại 100vh tính cả phần thanh địa chỉ che mất, dvh theo đúng phần đang thấy.
      // Padding safe-area chỉ khác 0 trên máy có tai thỏ / thanh home (viewportFit "cover" ở layout.tsx).
      className="flex h-dvh flex-col bg-[var(--bg)] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-[var(--fg)]"
    >
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        <DrawingToolbar />
        <main className="min-w-0 flex-1">
          <ChartGrid />
        </main>
        <RightRail />
      </div>
      <TradingPanel />
      {/* hộp thoại dùng chung: một bản cho cả trang, nhắm vào chart đang active */}
      <SettingsDialog />
      <VolumeSettingsDialog />
      <IndicatorSettingsDialog />
      <DrawingSettings />
      <OpenLayoutDialog />
      <AuthDialog />
      <AlertDialog />
      <AlertHost />
      <Toasts />
      <ConfirmHost />
    </div>
  );
}
