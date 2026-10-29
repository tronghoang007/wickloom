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
import { MobileOrderSheet, MobilePanel, MobileTabBar, MobileTopBar } from "@/components/chart/MobileChrome";
import RightRail from "@/components/chart/RightRail";
import TradingPanel from "@/components/chart/TradingPanel";
import Toolbar from "@/components/chart/Toolbar";
import { drawingGlobal, useDrawingStore } from "@/drawings/store";
import { useLandscape, useLayoutMode } from "@/lib/layoutMode";
import { useAuthStore } from "@/store/auth";
import { useRailStore } from "@/store/rail";
import { chartGlobal, useChartStore } from "@/store/chart";
import { appSession } from "@/store/appSession";
import { PrefsSync } from "@/store/prefsSync";
import { loadPaneInit } from "@/store/paneStorage";
import { useEffect, useState } from "react";

export default function Page() {
  const theme = useChartStore((s) => s.theme);
  const mode = useLayoutMode();
  const phone = mode === "phone"; // docs/mobile-responsive-plan.md: phone có khung riêng, tablet / desktop giữ khung desktop
  const landscape = useLandscape();
  const sideTabs = phone && landscape; // phone xoay ngang: tab bar thành cột dọc bên phải
  const showToolbar = useDrawingStore((s) => s.showToolbar); // thanh vẽ bên trái: bật tắt trong menu tài khoản
  const chartTab = useRailStore((s) => s.open === null || s.open === "order" || s.open === "objects"); // phone: tab Chart (kể cả bảng lệnh, Objects nổi trên chart)
  const [prefsReady, setPrefsReady] = useState(false);

  useEffect(() => {
    void useAuthStore.getState().refresh(); // ai đang đăng nhập? (khách / user)
  }, []);

  // biến thể CSS `phone:` (globals.css) theo đúng chế độ của hook; đặt trên <html> để cả hộp thoại / toast ngoài khung này cũng nhận
  useEffect(() => {
    document.documentElement.dataset.layout = mode;
  }, [mode]);

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
      // overflow-hidden: không phần tử nào (thanh trên đông nút, thanh vẽ nổi đặt chỗ từ màn lớn…) được làm trang rộng hơn màn — iPad mini từng bị đẩy
      // mất thanh bên phải (user 10-29)
      className="flex h-dvh flex-col overflow-hidden bg-[var(--bg)] pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-[var(--fg)]"
    >
      {/* phone dọc: thanh trên phẳng như MT5 (có SELL | BUY nhỏ); phone ngang: thanh gọn, tab bar là cột bên phải */}
      {/* thanh trên của phone (dọc lẫn ngang) chỉ ở tab Chart (user 10-29): các tab khác (Watchlist, Trading…) dùng hết màn */}
      {phone ? chartTab && <MobileTopBar /> : <Toolbar />}
      <div className="flex min-h-0 flex-1">
        {!phone && showToolbar && <DrawingToolbar />}
        <main className="relative min-w-0 flex-1">
          <ChartGrid />
          {/* tablet cũng dùng sheet ở đáy chart: bảng 384px đè lên chart che mất đường / thẻ của lệnh nháp (user 10-29, iPad) */}
          {mode !== "desktop" && <MobileOrderSheet />}
          {phone && <MobilePanel />}
        </main>
        {!phone && <RightRail />}
        {sideTabs && <MobileTabBar vertical />}
      </div>
      {phone ? !sideTabs && <MobileTabBar /> : <TradingPanel />}
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
