"use client";

import { fireNotice, failedChannels, CHANNEL_NAME } from "@/alerts/model";
import { startDrawingLinks } from "@/alerts/drawingLinks";
import { handleFeedMessage, type FeedEffects } from "@/alerts/feed";
import { playAlertSound, unlockAudio } from "@/alerts/sound";
import { useRulesStore } from "@/alerts/rules";
import { digitsOf, openCreateAlert, useAlertPrefs, useAlertStore } from "@/alerts/store";
import { WS_URL } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { useChartStore } from "@/store/chart";
import { toast } from "@/store/toast";
import { useEffect } from "react";

const RETRY_MIN = 1000;
const RETRY_MAX = 15000;

/** Cho phép thông báo của trình duyệt (gọi từ cú bấm của người dùng trong Settings, không xin lúc mở app). true nếu đã được cấp quyền. */
export async function enableDesktopNotifications(): Promise<boolean> {
  if (typeof Notification === "undefined") return false;
  try {
    return Notification.permission === "granted" || (await Notification.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

function desktopNotify(title: string, body: string, tag: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted" || !useAlertPrefs.getState().desktop) return;
  if (!document.hidden && document.hasFocus()) return; // đang nhìn thẳng vào Wickloom: toast là đủ
  try {
    const n = new Notification(title, { body, tag });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch {
    /* một số trình duyệt di động chỉ cho Notification qua service worker */
  }
}

function announce(title: string, text: string, tag: string, opts: { symbol?: string } = {}) {
  toast(text, {
    title,
    ms: 12000,
    action: opts.symbol ? { label: "Mở chart", run: () => useChartStore.getState().set({ symbol: opts.symbol }) } : undefined,
  });
  playAlertSound(useAlertPrefs.getState().sound);
  desktopNotify(title, text, tag);
}

const effects: FeedEffects = {
  ready: () => {
    // vừa nối (hoặc nối lại sau khi mất): lấy lại danh sách vì có thể có alert đã nổ trong lúc đứt
    const s = useAlertStore.getState();
    void s.refresh();
    if (s.logLoaded) void s.refreshLog();
  },
  denied: () => {},
  fired: (a, price, time, logId, late) => {
    useAlertStore.getState().applyFired(a, logId, price, time, late);
    const n = fireNotice(a, price, digitsOf(a.symbol), late);
    announce(n.title, n.text, a.id, { symbol: a.symbol });
  },
  notice: (n) => {
    useAlertStore.getState().applyNotice(n);
    announce(n.title, n.message ? `${n.text}\n${n.message}` : n.text, `notice-${n.kind}`);
  },
  delivery: (logId, results) => {
    useAlertStore.getState().applyDelivery(logId, results);
    const bad = failedChannels(results);
    if (bad.length > 0) toast(bad.map((b) => `${CHANNEL_NAME[b.kind as keyof typeof CHANNEL_NAME]}: ${b.reason}`).join(" · "), { title: "Alert không giao hết các kênh", kind: "error", ms: 12000 });
  },
  test: (text) => announce("Wickloom", text, "alert-test"),
};

/** Nhận alert backend đẩy xuống (WebSocket riêng, chỉ khi đã đăng nhập): toast + âm thanh + thông báo trình duyệt, giữ danh sách alert cập nhật. Phím ⌥A mở hộp thoại tạo alert.
 *  Alert được so điều kiện ở backend nên vẫn nổ khi tắt tab; tab này chỉ là một trong các nơi nhận (docs/alerts-plan.md). */
export default function AlertHost() {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);

  useEffect(() => {
    if (status !== "user") {
      if (status === "guest") {
        useAlertStore.getState().reset();
        useRulesStore.getState().reset();
      }
      return;
    }
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let wait = RETRY_MIN;
    let dead = false;
    void useAlertStore.getState().refresh();
    const stopLinks = startDrawingLinks(); // alert theo hình vẽ bám theo hình khi hình bị kéo / xoá
    const connect = () => {
      if (dead) return;
      ws = new WebSocket(WS_URL);
      ws.onopen = () => ws?.send(JSON.stringify({ action: "alerts" }));
      ws.onmessage = (e) => {
        let m: unknown;
        try {
          m = JSON.parse(String(e.data));
        } catch {
          return;
        }
        handleFeedMessage(m, { ...effects, ready: () => ((wait = RETRY_MIN), effects.ready()) });
      };
      ws.onclose = () => {
        if (dead) return;
        timer = setTimeout(connect, wait);
        wait = Math.min(wait * 2, RETRY_MAX);
      };
      ws.onerror = () => ws?.close();
    };
    connect();
    return () => {
      dead = true;
      clearTimeout(timer);
      ws?.close();
      stopLinks();
    };
  }, [status, userId]);

  useEffect(() => {
    const unlock = () => unlockAudio();
    const onKey = (e: KeyboardEvent) => {
      unlock();
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyA" && !(e.target instanceof HTMLElement && e.target.closest("input, textarea, select"))) {
        e.preventDefault();
        void openCreateAlert();
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return null;
}
