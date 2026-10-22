import { apiFetch } from "./api";

export class HttpError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
  }
}

const enc = encodeURIComponent;

async function json<T>(res: Response): Promise<T> {
  if (!res.ok) throw new HttpError(res.status);
  return res.json();
}

export type Row = { id: string; data: unknown };

/** Mọi layout của user đăng nhập (document đầy đủ). */
export const fetchLayoutRows = () => apiFetch("/me/layouts").then((r) => json<Row[]>(r));
export const fetchLayoutRow = (id: string) => apiFetch(`/me/layouts/${enc(id)}`).then((r) => json<Row>(r));
export const putLayoutDoc = async (id: string, doc: unknown) => {
  const r = await apiFetch(`/me/layouts/${enc(id)}`, { method: "PUT", body: JSON.stringify(doc) });
  if (!r.ok) throw new HttpError(r.status);
};
export const deleteLayoutDoc = async (id: string) => {
  const r = await apiFetch(`/me/layouts/${enc(id)}`, { method: "DELETE" });
  if (!r.ok) throw new HttpError(r.status);
};

/** Hình vẽ của user: id dạng `<symbol>__<layoutId>`. */
export const fetchDrawingRows = () => apiFetch("/me/drawings").then((r) => json<Row[]>(r));
export const putDrawingDoc = async (id: string, doc: unknown) => {
  const r = await apiFetch(`/me/drawings/${enc(id)}`, { method: "PUT", body: JSON.stringify(doc) });
  if (!r.ok) throw new HttpError(r.status);
};
export const deleteDrawingDoc = async (id: string) => {
  const r = await apiFetch(`/me/drawings/${enc(id)}`, { method: "DELETE" });
  if (!r.ok) throw new HttpError(r.status);
};
