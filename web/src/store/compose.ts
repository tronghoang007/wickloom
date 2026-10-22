import { useSyncExternalStore } from "react";
import type { StoreApi } from "zustand/vanilla";
import { activePane, useLayoutStore } from "./layout";
import type { Pane } from "./paneStores";

type AnyState = Record<string, unknown>;

export type FacadeHook<T> = {
  (): T;
  <U>(selector: (s: T) => U): U;
  getState: () => T;
  setState: (partial: Partial<T> | ((s: T) => Partial<T>)) => void;
  subscribe: (listener: () => void) => () => void;
};

/**
 * Store "ghép" cho UI ngoài chart: trạng thái = phần dùng chung (global) + phần của pane ĐANG ACTIVE, dùng như một
 * store zustand bình thường (hook / getState / setState / subscribe) nên các component cũ không phải đổi.
 *  - setState chia patch theo `paneKeys`: khoá của pane ghi vào store của pane active, còn lại vào global;
 *  - đổi pane active thì các hook/subscriber được báo và đọc lại từ pane mới;
 *  - state ghép được cache theo (global, pane) để selector trả về cùng tham chiếu khi không có gì đổi.
 * Chart / DrawingManager KHÔNG dùng cái này mà gắn thẳng vào store của pane mình (pane.chart, pane.draw...).
 */
export function composeStore<G extends object, P extends object, X extends object = Record<never, never>>(o: {
  global?: StoreApi<G>;
  pane: (p: Pane) => StoreApi<P>;
  paneKeys: readonly (keyof P)[];
  /** Action cần định tuyến theo khoá (vd `set`): nhận setState đã ghép. */
  extra?: (setState: (patch: Partial<G & P>) => void) => X;
}): FacadeHook<G & P & X> {
  type M = G & P & X;
  // cùng một object mỗi lần: nếu mỗi lần một `{}` mới thì cache không bao giờ trúng và useSyncExternalStore lặp vô hạn
  const none = {} as G;
  const noGlobal = { getState: () => none, setState: () => {}, subscribe: () => () => {} } as unknown as StoreApi<G>;
  const g = o.global ?? noGlobal;
  const cur = () => o.pane(activePane());
  const paneKeys = new Set<string>(o.paneKeys as unknown as string[]);

  let cache: { g: G; p: P; m: M } | null = null;
  let extra: X | null = null;

  const getState = (): M => {
    const gs = g.getState();
    const ps = cur().getState();
    if (!cache || cache.g !== gs || cache.p !== ps) cache = { g: gs, p: ps, m: { ...gs, ...ps, ...(extra ?? {}) } as M };
    return cache.m;
  };

  const setState = (partial: Partial<M> | ((s: M) => Partial<M>)) => {
    const patch = (typeof partial === "function" ? partial(getState()) : partial) as AnyState;
    const toPane: AnyState = {};
    const toGlobal: AnyState = {};
    for (const k of Object.keys(patch)) (paneKeys.has(k) ? toPane : toGlobal)[k] = patch[k];
    if (Object.keys(toPane).length) cur().setState(toPane as Partial<P>);
    if (Object.keys(toGlobal).length) g.setState(toGlobal as Partial<G>);
  };
  if (o.extra) extra = o.extra(setState as (patch: Partial<G & P>) => void);

  const subscribe = (listener: () => void) => {
    let offPane = cur().subscribe(listener);
    const offGlobal = g.subscribe(listener);
    const offActive = useLayoutStore.subscribe((s, prev) => {
      if (s.activeId === prev.activeId) return;
      offPane();
      offPane = cur().subscribe(listener);
      listener();
    });
    return () => {
      offPane();
      offGlobal();
      offActive();
    };
  };

  function useFacade<U>(selector?: (s: M) => U): U | M {
    const read = () => (selector ? selector(getState()) : getState());
    return useSyncExternalStore(subscribe, read, read);
  }
  return Object.assign(useFacade, { getState, setState, subscribe }) as unknown as FacadeHook<M>;
}

/** Hook cho 1 store của MỘT pane cụ thể (Chart dùng cho pane của mình). */
export function usePaneState<T, U = T>(api: StoreApi<T>, selector?: (s: T) => U): U {
  const read = () => (selector ? selector(api.getState()) : (api.getState() as unknown as U));
  return useSyncExternalStore(api.subscribe, read, read);
}
