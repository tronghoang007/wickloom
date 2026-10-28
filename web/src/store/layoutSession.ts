import {
  HttpError, deleteDrawingDoc, deleteLayoutDoc, fetchDrawingRows, fetchLayoutRow, fetchLayoutRows, putDrawingDoc, putLayoutDoc, type Row,
} from "@/lib/layoutApi";
import { type User } from "@/lib/authApi";
import { create } from "zustand";
import { authHooks, readAuthHint, useAuthStore } from "./auth";
import {
  DEFAULT_LAYOUT_ID, PRIMARY_PANE_ID, activePane, allPanes, flushAllDrawings, getPane, snapshotLayout, useLayoutStore,
} from "./layout";
import { buildDoc, cleanName, docKey, parseLayoutDoc, summarizeDoc, type LayoutDoc } from "./layoutDoc";
import { LayoutSync, type SaveState } from "./layoutSync";
import { buildTemplate } from "./layoutTree";
import { bindPanePersistence, loadPaneInit } from "./paneStorage";
import { createPane, type PaneInit } from "./paneStores";
import { useSettingsStore } from "./settings";
import { bindSettingsPersistence, loadSettings } from "./settingsStorage";
import { toast } from "./toast";

// Điều phối layout theo phiên đăng nhập:
//  - khách: layout nằm trong bộ nhớ (pane chính vẫn nhớ symbol/khung... qua `wickloom-pane1`, setting chart qua `tv-chart-settings`), không gì lên server;
//  - user: layout lưu ở `/me/layouts/<id>`, autosave (LayoutSync), nhớ layout đang mở theo user (+ cache để mở nhanh khi backend chưa lên).
// Khách bấm Save → đăng nhập → lưu chart hiện tại vào tài khoản (không ghi đè layout có sẵn). Layout cuối được cache trong localStorage để
// reload khi backend tắt vẫn thấy đúng bố cục; không bao giờ PUT bản mặc định đè lên layout đã có khi load lỗi.

export type Entry = {
  id: string;
  name: string;
  summary: string;
  updatedAt: number;
  doc: LayoutDoc | null; // null = không đọc được (version lạ / hỏng): chỉ hiện, không mở, không ghi đè
  bad?: "version" | "invalid";
};

export type SessionStatus = SaveState | "loading" | "guest";

type SessionState = {
  saveState: SessionStatus;
  dialog: "open" | null;
  entries: Entry[] | null;
  entriesLoading: boolean;
};

export const useSessionStore = create<SessionState>()(() => ({ saveState: "guest", dialog: null, entries: null, entriesLoading: false }));

const CACHE_PREFIX = "wickloom-layout-current:";
const RETRY_MS = 5000;

type KV = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Plan = { kind: "open"; id: string } | { kind: "create"; id: string; name: string; announce?: boolean };
type Pending = { uid: string; entries?: Entry[]; plan: Plan };

export function toEntry(row: Row): Entry {
  const p = parseLayoutDoc(row.data);
  if (!p.ok) {
    const raw = (row.data ?? {}) as { name?: unknown; updatedAt?: unknown };
    return {
      id: row.id,
      name: cleanName(raw.name, "(không đọc được)"),
      summary: p.reason === "version" ? "Tạo bởi bản app mới hơn" : "Dữ liệu hỏng",
      updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : 0,
      doc: null,
      bad: p.reason,
    };
  }
  return { id: row.id, name: p.doc.name, summary: summarizeDoc(p.doc), updatedAt: p.doc.updatedAt, doc: p.doc };
}
const sortEntries = (e: Entry[]) => [...e].sort((a, b) => b.updatedAt - a.updatedAt);

export function guestDoc(init: PaneInit): LayoutDoc {
  const pane = createPane(PRIMARY_PANE_ID, init);
  return buildDoc({ name: "Default", templateId: "s", tree: buildTemplate("s", [PRIMARY_PANE_ID]), order: [PRIMARY_PANE_ID], panes: { [PRIMARY_PANE_ID]: pane }, activeId: PRIMARY_PANE_ID });
}

export type Session = ReturnType<typeof createLayoutSession>;

export function createLayoutSession(
  kv: KV,
  opts: { onUnload?: (flush: () => void) => () => void; now?: () => number; retryMs?: number } = {},
) {
  const now = opts.now ?? Date.now;
  const retryMs = opts.retryMs ?? RETRY_MS;
  const set = useSessionStore.setState;

  let mode: "init" | "guest" | "optimistic" | "user" = "init";
  let uid: string | null = null;
  let sync: LayoutSync | null = null;
  let unwatch: (() => void) | null = null;
  let unbindGuest: (() => void) | null = null;
  let unbindSettings: (() => void) | null = null;
  let entering: Promise<void> | null = null;
  let pending: Pending | null = null;
  let saveIntent = false;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let optimisticKey: string | null = null; // bản cache lúc mở nhanh: để biết người dùng có sửa gì khi backend chưa trả lời
  let cacheTimer: ReturnType<typeof setTimeout> | null = null;
  let offAuth: (() => void) | null = null;
  let offUnload: (() => void) | null = null;

  // --- cache theo user: layout đang mở + bản cuối --------------------------------------------------------------
  const cacheKey = (id: string) => CACHE_PREFIX + id;
  const readCache = (id: string): { id: string; doc: LayoutDoc } | null => {
    try {
      const raw = JSON.parse(kv.getItem(cacheKey(id)) ?? "null");
      const p = raw && typeof raw.id === "string" ? parseLayoutDoc(raw.doc) : null;
      return p?.ok ? { id: raw.id, doc: p.doc } : null;
    } catch {
      return null;
    }
  };
  const writeCache = (doc: LayoutDoc, layoutId = useLayoutStore.getState().layoutId) => {
    if (!uid) return;
    try {
      kv.setItem(cacheKey(uid), JSON.stringify({ id: layoutId, doc }));
    } catch {
      /* localStorage đầy/bị chặn: mất khả năng mở nhanh, không ảnh hưởng dữ liệu */
    }
  };

  // --- theo dõi thay đổi của bố cục + state mọi chart -------------------------------------------------------------
  function watch(): () => void {
    let offs: (() => void)[] = [];
    const onChange = () => {
      if (mode === "user") sync?.schedule();
      else if (mode === "optimistic") {
        if (cacheTimer) clearTimeout(cacheTimer);
        cacheTimer = setTimeout(() => writeCache(snapshotLayout()), 300); // sửa lúc backend chưa trả lời: giữ lại cho lần reload sau
      }
    };
    const bind = () => {
      offs.forEach((f) => f());
      offs = allPanes().flatMap((p) => [
        p.chart.subscribe(onChange),
        p.indicators.subscribe((s, prev) => { if (s.list !== prev.list || s.collapsed !== prev.collapsed) onChange(); }),
        p.volume.subscribe((s, prev) => { if (s.s !== prev.s) onChange(); }),
      ]);
    };
    bind();
    const offSettings = useSettingsStore.subscribe((s, prev) => { if (s.s !== prev.s) onChange(); });
    const offLayout = useLayoutStore.subscribe((s, prev) => {
      if (s.panes !== prev.panes) bind();
      if (s.panes !== prev.panes || s.tree !== prev.tree || s.templateId !== prev.templateId || s.name !== prev.name || s.sync !== prev.sync) onChange();
    });
    return () => {
      offs.forEach((f) => f());
      offLayout();
      offSettings();
    };
  }

  async function startSync(doc: LayoutDoc, id: string, readonly = false) {
    sync?.abandon();
    sync = new LayoutSync({
      id,
      snapshot: snapshotLayout,
      baseline: doc,
      readonly,
      onState: (s) => set({ saveState: s }),
      onSaved: (d) => writeCache(d, id),
    });
    set({ saveState: readonly ? "readonly" : "saved" });
    writeCache(doc, id);
    if (!unwatch) unwatch = watch();
  }

  // --- khách ----------------------------------------------------------------------------------------------------
  function enterGuest(first: boolean, early?: PaneInit) {
    unbindGuest?.();
    const init = early ?? loadPaneInit(kv);
    if (!first) useLayoutStore.getState().applyLayout(guestDoc(init), DEFAULT_LAYOUT_ID); // từ user về khách: dựng lại 1 chart từ prefs
    unbindGuest = bindPanePersistence(getPane(PRIMARY_PANE_ID), kv, { init, onUnload: opts.onUnload });
    unbindSettings?.();
    unbindSettings = bindSettingsPersistence(kv); // nạp lại setting của khách (user về khách: bỏ setting của layout vừa rời)
    mode = "guest";
    uid = null;
    set({ saveState: "guest", entries: null });
  }

  function leaveUser() {
    clearRetry();
    if (cacheTimer) clearTimeout(cacheTimer); // bản cache chờ ghi của user cũ: ghi lúc này sẽ vào key của người khác
    cacheTimer = null;
    sync?.abandon();
    sync = null;
    unwatch?.();
    unwatch = null;
    pending = null;
    enterGuest(false);
  }

  // --- user -----------------------------------------------------------------------------------------------------
  const clearRetry = () => {
    if (retryTimer) clearTimeout(retryTimer);
    retryTimer = null;
  };
  const stillUser = (user: User) => useAuthStore.getState().status === "user" && useAuthStore.getState().user?.id === user.id;

  const fetchEntries = async (): Promise<Entry[]> => sortEntries((await fetchLayoutRows()).map(toEntry));

  const readCurrentId = (id: string) => readCache(id)?.id ?? null;

  function decide(entries: Entry[], userId: string): Plan {
    const usable = entries.filter((e) => e.doc);
    if (usable.length === 0) return { kind: "create", id: DEFAULT_LAYOUT_ID, name: "Default" };
    const remembered = readCurrentId(userId);
    return { kind: "open", id: usable.find((e) => e.id === remembered)?.id ?? usable[0].id };
  }

  async function createFromScreen(plan: Extract<Plan, { kind: "create" }>, entries: Entry[], user: User) {
    // id đã có (kể cả bản không đọc được): KHÔNG dùng lại để khỏi ghi đè
    const id = entries.some((e) => e.id === plan.id) ? crypto.randomUUID() : plan.id;
    const doc: LayoutDoc = { ...snapshotLayout(), name: cleanName(plan.name), updatedAt: now() };
    await putLayoutDoc(id, doc);
    if (!stillUser(user)) return;
    useLayoutStore.getState().setIdentity(id, doc.name);
    await startSync(doc, id);
    set({ entries: sortEntries([...entries, toEntry({ id, data: doc })]) });
    if (plan.announce)
      toast(`Đã lưu thành "${doc.name}"`, { action: { label: "Mở layout của tôi", run: () => void session.openDialog() }, ms: 8000 });
  }

  async function openEntry(e: Entry, wasOptimistic: boolean) {
    const doc = e.doc!;
    const L = useLayoutStore.getState();
    if (wasOptimistic && L.layoutId === e.id) {
      const screen = snapshotLayout();
      const screenKey = docKey(screen);
      if (optimisticKey !== null && screenKey !== optimisticKey) {
        await startSync(doc, e.id); // đã sửa lúc backend chưa trả lời: bản trên máy thắng, lưu lên
        sync!.schedule();
        return;
      }
      // doc cũ chưa có setting thì màn hình đang dùng setting của khách: coi là cùng bản
      if (screenKey === docKey(doc.settings ? doc : { ...doc, settings: screen.settings })) {
        await startSync(doc, e.id); // đang hiện đúng bản này (từ cache): khỏi dựng lại chart
        return;
      }
    }
    L.applyLayout(doc, e.id);
    await startSync(doc, e.id);
  }

  async function enterUser(user: User) {
    clearRetry();
    const mine = pending?.uid === user.id ? pending : null;
    pending = null;
    const wasOptimistic = mode === "optimistic";
    // chế độ user: prefs khách (wickloom-pane1) dừng ghi, giữ nguyên bản lúc đăng nhập cho lần quay về khách
    unbindGuest?.();
    unbindGuest = null;
    unbindSettings?.(); // chế độ user: setting nằm trong layout, key của khách dừng ghi (giữ bản lúc đăng nhập)
    unbindSettings = null;
    uid = user.id;
    set({ saveState: "loading" });
    try {
      const entries = mine?.entries ?? (await fetchEntries());
      if (!stillUser(user)) return;
      set({ entries });
      const plan = mine?.plan ?? decide(entries, user.id);
      if (plan.kind === "create") await createFromScreen(plan, entries, user);
      else await openEntry(entries.find((e) => e.id === plan.id)!, wasOptimistic);
      if (stillUser(user)) mode = "user";
    } catch {
      if (!stillUser(user)) return;
      // backend lỗi: giữ nguyên màn hình hiện có (cache), tuyệt đối không ghi gì, thử lại. Giữ lại kế hoạch đã chọn lúc đăng nhập
      // (vd khách bấm Save → lưu chart này thành layout mới), danh sách layout thì đọc lại vì có thể đã đổi.
      if (mine) pending = { uid: mine.uid, plan: mine.plan };
      set({ saveState: "error" });
      retryTimer = setTimeout(() => {
        if (stillUser(user)) entering = enterUser(user);
      }, retryMs);
    }
  }

  // Đăng ký mỗi lần start() (stop() gỡ chúng; Fast Refresh chạy lại effect: stop rồi start trên cùng phiên).
  function bindHooks() {
    // Auth báo "vừa xác thực, chưa chuyển hình khách": quyết định layout nào sẽ mở để hình khách đi vào đúng layout đó.
    authHooks.beforeLogin = async (user) => {
      let entries: Entry[];
      try {
        entries = await fetchEntries();
      } catch {
        return; // để enterUser tự xử lý lỗi
      }
      const intent = saveIntent;
      saveIntent = false;
      let plan: Plan;
      if (entries.filter((e) => e.doc).length === 0) plan = { kind: "create", id: DEFAULT_LAYOUT_ID, name: "Default" };
      else if (intent)
        plan = {
          kind: "create",
          id: crypto.randomUUID(),
          name: `Chart ${new Date(now()).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}`,
          announce: true, // không ghi đè layout có sẵn: lưu thành layout mới rồi báo
        };
      else plan = decide(entries, user.id);
      pending = { uid: user.id, entries, plan };
      return { layoutId: plan.kind === "open" ? plan.id : entries.some((e) => e.id === plan.id) ? undefined : plan.id };
    };

    authHooks.beforeLogout = async () => {
      if (!sync) return;
      await sync.flush();
      if (sync.state === "error") throw new Error("layout chưa lưu được");
    };
  }

  function onAuth(s: ReturnType<typeof useAuthStore.getState>, prev?: ReturnType<typeof useAuthStore.getState>) {
    const sameUser = s.status === "user" && s.user?.id === uid;
    // đăng nhập lại sau khi hết phiên: ghi tiếp phần đang giữ - CHỈ khi vẫn là user cũ (cookie giờ là của người vừa đăng nhập)
    if (prev?.expired && !s.expired && sameUser) void sync?.resume();
    if (s.status === "user" && s.user) {
      if (mode === "user" && uid === s.user.id) return;
      if ((mode === "user" || mode === "optimistic") && uid !== s.user.id) {
        // đổi thẳng sang tài khoản khác (đăng nhập lại lúc hết phiên bằng email khác...): màn hình đang là layout của user cũ,
        // không được lưu sang tài khoản mới. Bỏ sync cũ (không PUT), dựng lại màn hình khách rồi mới vào user mới.
        if (sync && (sync.state === "expired" || sync.state === "error")) toast("Thay đổi chưa lưu của tài khoản trước đã bị bỏ");
        const keep = pending?.uid === s.user.id ? pending : null; // kế hoạch beforeLogin của chính user mới (đăng ký lúc hết phiên)
        leaveUser();
        pending = keep;
      }
      entering = enterUser(s.user);
    } else if (s.status === "guest" && mode !== "guest") leaveUser();
  }

  // --- thao tác của người dùng (đều qua requireLogin) ----------------------------------------------------------
  async function ensureUser(reason: string): Promise<boolean> {
    const ok = await useAuthStore.getState().requireLogin(reason);
    if (!ok) return false;
    await entering; // vừa đăng nhập xong: đợi mở/tạo layout
    return mode === "user" && !!sync;
  }

  async function settleCurrent(): Promise<boolean> {
    if (!sync) return true;
    await sync.flush();
    const drawn = await flushAllDrawings();
    if (sync.state === "error" || sync.state === "expired" || !drawn) {
      toast(drawn ? "Chưa lưu được layout hiện tại — thử lại sau" : "Chưa lưu được hình vẽ của layout hiện tại — thử lại sau");
      return false;
    }
    return true;
  }

  async function openById(id: string) {
    const row = await fetchLayoutRow(id);
    const e = toEntry(row);
    if (!e.doc) {
      toast(`Không mở được "${e.name}": ${e.summary.toLowerCase()}`);
      return;
    }
    if (!(await settleCurrent())) return;
    useLayoutStore.getState().applyLayout(e.doc, id);
    await startSync(e.doc, id);
  }

  const session = {
    /** Gắn vào app: chọn layout ban đầu (cache của user lần trước / khách) và nghe đăng nhập–đăng xuất.
     *  `guestInit`: prefs của khách đã đọc SỚM (trước khi store chung rehydrate và ghi lại key cũ cần migrate). */
    start(startOpts: { guestInit?: PaneInit } = {}) {
      const hint = readAuthHint();
      const cached = hint?.id ? readCache(hint.id) : null;
      if (hint?.id && cached) {
        // Mở nhanh bằng layout cache trong lúc chờ /auth/me + server: reload không chớp về 1 chart, backend tắt vẫn thấy bố cục
        uid = hint.id;
        mode = "optimistic";
        useSettingsStore.getState().replace(loadSettings(kv)); // layout cache cũ chưa có setting thì dùng bản đã lưu của khách
        useLayoutStore.getState().applyLayout(cached.doc, cached.id);
        optimisticKey = docKey(snapshotLayout()); // chụp SAU khi áp: doc cũ thiếu setting vẫn khớp màn hình, khỏi bị coi là "đã sửa"
        unwatch = watch();
        set({ saveState: "loading" });
      } else enterGuest(true, startOpts.guestInit);
      bindHooks();
      offAuth = useAuthStore.subscribe(onAuth);
      offUnload = opts.onUnload?.(() => sync?.flushOnUnload()) ?? null;
      onAuth(useAuthStore.getState());
    },

    stop() {
      offAuth?.();
      offUnload?.();
      unwatch?.();
      unbindGuest?.();
      unbindSettings?.();
      sync?.abandon();
      clearRetry();
      if (cacheTimer) clearTimeout(cacheTimer);
      if (retryTimer) clearTimeout(retryTimer);
      offAuth = offUnload = unwatch = unbindGuest = unbindSettings = sync = null;
      mode = "init";
      uid = null;
      entering = null;
      pending = null;
      optimisticKey = null;
      delete authHooks.beforeLogin;
      delete authHooks.beforeLogout;
    },

    /** Chặn bằng đăng nhập (UI dùng trước khi hỏi tên...): true khi đã là user và layout đã sẵn sàng. */
    requireUser: (reason: string) => ensureUser(reason),

    /** Save / Ctrl+S. Khách: đăng nhập rồi lưu chart hiện tại vào tài khoản. */
    async save() {
      const a = useAuthStore.getState();
      if (a.status !== "user" || a.expired) {
        saveIntent = a.status !== "user";
        try {
          await ensureUser("Đăng nhập để lưu layout");
        } finally {
          saveIntent = false;
        }
        return;
      }
      if (!sync) return;
      if (sync.state === "error") await sync.retry();
      else await sync.flush();
    },

    async rename(name: string) {
      if (!(await ensureUser("Đăng nhập để đổi tên layout"))) return;
      useLayoutStore.getState().setName(name);
      await sync?.flush();
    },

    /** Create new layout…: layout mới 1 chart (symbol/khung của chart active), mở luôn. */
    async create(name: string) {
      if (!(await ensureUser("Đăng nhập để tạo layout"))) return;
      if (!(await settleCurrent())) return;
      const src = activePane().chart.getState();
      const pane = createPane(PRIMARY_PANE_ID, { chart: { symbol: src.symbol, tf: src.tf, chartType: src.chartType } });
      const doc = buildDoc(
        { name: cleanName(name, "Unnamed layout"), templateId: "s", tree: buildTemplate("s", [PRIMARY_PANE_ID]), order: [PRIMARY_PANE_ID], panes: { [PRIMARY_PANE_ID]: pane }, activeId: PRIMARY_PANE_ID, settings: useSettingsStore.getState().s },
        now(),
      );
      const id = crypto.randomUUID();
      await putLayoutDoc(id, doc);
      await openById(id);
    },

    /** Make a copy…: bản sao của layout đang mở KÈM hình vẽ của nó, mở luôn bản sao. */
    async copy(name: string) {
      if (!(await ensureUser("Đăng nhập để sao chép layout"))) return;
      if (!(await settleCurrent())) return;
      const from = useLayoutStore.getState().layoutId;
      const id = crypto.randomUUID();
      await putLayoutDoc(id, { ...snapshotLayout(), name: cleanName(name, "Unnamed layout"), updatedAt: now() });
      const suffix = `__${from}`;
      for (const d of await fetchDrawingRows()) {
        if (d.id.endsWith(suffix)) await putDrawingDoc(`${d.id.slice(0, -suffix.length)}__${id}`, d.data);
      }
      await openById(id);
    },

    /** Open layout: mở layout `id` của user. */
    async open(id: string) {
      if (!(await ensureUser("Đăng nhập để mở layout"))) return;
      if (id === useLayoutStore.getState().layoutId) {
        set({ dialog: null });
        return;
      }
      await openById(id);
      set({ dialog: null });
    },

    /** Xoá layout + hình vẽ của nó. Không xoá layout cuối cùng. Xoá layout đang mở thì mở layout mới nhất còn lại. */
    async remove(id: string) {
      if (!(await ensureUser("Đăng nhập để xoá layout"))) return;
      const entries = await fetchEntries();
      const others = entries.filter((e) => e.id !== id);
      if (others.length === 0) {
        toast("Không xoá được layout cuối cùng");
        return;
      }
      const current = id === useLayoutStore.getState().layoutId;
      const doomed = current ? sync : null;
      try {
        if (doomed) {
          doomed.abandon(); // flush sẽ tạo lại chính layout đang xoá
          // hình vẽ còn đang thử lưu lại: xoá lúc này thì lần thử sau sẽ tạo lại hàng hình vẽ của layout đã xoá
          if (!(await flushAllDrawings())) throw new Error("hình vẽ chưa lưu được");
        }
        await deleteLayoutDoc(id);
      } catch {
        // chưa xoá được: layout vẫn là layout đang mở, autosave phải chạy lại (không thì "Saved" mà không lưu gì)
        if (doomed && sync === doomed) doomed.revive();
        toast("Không xoá được layout — thử lại sau");
        return;
      }
      const suffix = `__${id}`;
      try {
        for (const d of await fetchDrawingRows()) if (d.id.endsWith(suffix)) await deleteDrawingDoc(d.id);
      } catch {
        /* layout đã xoá: hình vẽ còn sót chỉ là rác trên server, vẫn chuyển sang layout khác */
      }
      set({ entries: others });
      if (current) {
        const next = others.find((e) => e.doc);
        if (next?.doc) {
          useLayoutStore.getState().applyLayout(next.doc, next.id);
          await startSync(next.doc, next.id);
        } else await createFromScreen({ kind: "create", id: DEFAULT_LAYOUT_ID, name: "Default" }, others, useAuthStore.getState().user!);
      }
    },

    async openDialog() {
      if (!(await ensureUser("Đăng nhập để mở layout"))) return;
      set({ dialog: "open" });
      await session.refreshEntries();
    },
    closeDialog: () => set({ dialog: null }),

    async refreshEntries() {
      set({ entriesLoading: true });
      try {
        set({ entries: await fetchEntries() });
      } catch (e) {
        if (!(e instanceof HttpError) || e.status !== 401) toast("Không tải được danh sách layout");
      } finally {
        set({ entriesLoading: false });
      }
    },

    /** Để test. */
    get mode() {
      return mode;
    },
    get sync() {
      return sync;
    },
    ready: () => entering ?? Promise.resolve(),
  };
  return session;
}
