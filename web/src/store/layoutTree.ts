// Cây chia ô của layout (thuần logic, không React). Dùng cây thay vì CSS grid cố định để mỗi nhóm kéo độc lập:
// "1 trái + 2 phải" = row[pane, col[pane, pane]] — kéo ngang ở giữa không dính chuyện chia dọc bên phải.
// Mọi toạ độ là TỈ LỆ (0..1) của khung chứa; px tính ở lúc render.

export type Node = { pane: string } | { dir: "row" | "col"; sizes: number[]; children: Node[] };
export type Split = Extract<Node, { dir: "row" | "col" }>;
export type Rect = { x: number; y: number; w: number; h: number };

export const isLeaf = (n: Node): n is { pane: string } => "pane" in n;

const leaf = (id: string): Node => ({ pane: id });
const equal = (n: number) => Array.from({ length: n }, () => 1 / n);
const split = (dir: "row" | "col", children: Node[]): Node => ({ dir, children, sizes: equal(children.length) });
// row = các ô cạnh nhau (chia cột); col = các ô chồng lên nhau (chia hàng)
const row = (...c: Node[]) => split("row", c);
const col = (...c: Node[]) => split("col", c);
const leaves = (ids: string[]) => ids.map(leaf);

export type Template = { id: string; count: number; build: (ids: string[]) => Node };

// Các hình dạng cơ bản; tên mẫu theo TradingView (docs/tv-layout-reference.md §2): `<n>h` n cột, `<n>v` n hàng,
// `<a>-<b>` a chart hàng trên + b chart hàng dưới, `<n>s` 1 chart cao hết bên trái + 1 cột n-1 chart ("-l": đảo bên), số trần = lưới.
const cols = (i: string[]) => row(...leaves(i));
const rows = (i: string[]) => col(...leaves(i));
const line = (i: string[]) => (i.length === 1 ? leaf(i[0]) : row(...leaves(i)));
const tb = (top: number, bottom: number) => (i: string[]) => col(line(i.slice(0, top)), line(i.slice(top, top + bottom)));
const grid = (c: number, r: number) => (i: string[]) => col(...Array.from({ length: r }, (_, k) => line(i.slice(k * c, (k + 1) * c))));
const bigLeft = (i: string[]) => row(leaf(i[0]), col(...leaves(i.slice(1))));
const bigRight = (i: string[]) => row(col(...leaves(i.slice(0, -1))), leaf(i[i.length - 1]));
const t = (id: string, count: number, build: Template["build"]): Template => ({ id, count, build });

// Mẫu 1–8 ô của popup TV (thứ tự như TV). TV còn 9–16 ô: chưa làm vì MAX_PANES = 8.
export const TEMPLATES: Template[] = [
  t("s", 1, ([a]) => leaf(a)),
  t("2h", 2, cols),
  t("2v", 2, rows),
  t("3h", 3, cols),
  t("3v", 3, rows),
  t("3s", 3, bigLeft),
  t("3r", 3, bigRight),
  t("2-1", 3, tb(2, 1)),
  t("1-2", 3, tb(1, 2)),
  t("4", 4, grid(2, 2)),
  t("4v", 4, rows),
  t("4h", 4, cols),
  t("4s", 4, bigLeft),
  t("4s-l", 4, bigRight),
  t("1-3", 4, tb(1, 3)),
  t("3-1", 4, tb(3, 1)),
  t("2-2-l", 4, ([a, b, c, d]) => row(leaf(a), leaf(b), col(leaf(c), leaf(d)))),
  t("2-2-r", 4, ([a, b, c, d]) => row(col(leaf(a), leaf(b)), leaf(c), leaf(d))),
  t("2-2", 4, ([a, b, c, d]) => col(row(leaf(a), leaf(b)), leaf(c), leaf(d))),
  t("1-4", 5, tb(1, 4)),
  t("5h", 5, cols),
  t("5v", 5, rows),
  t("5s", 5, bigLeft),
  t("5s-l", 5, bigRight),
  t("2-3", 5, tb(2, 3)),
  t("3-2", 5, tb(3, 2)),
  t("4-1", 5, tb(4, 1)),
  t("2-3-l", 5, ([a, b, c, d, e]) => row(leaf(a), leaf(b), col(leaf(c), leaf(d), leaf(e)))),
  t("2-3-r", 5, ([a, b, c, d, e]) => row(col(leaf(a), leaf(b), leaf(c)), leaf(d), leaf(e))),
  t("6", 6, grid(3, 2)),
  t("6h", 6, cols),
  t("6v", 6, rows),
  t("6c", 6, grid(2, 3)),
  t("2-4", 6, tb(2, 4)),
  t("4-2", 6, tb(4, 2)),
  t("4-3", 7, tb(4, 3)),
  t("7h", 7, cols),
  t("7s", 7, bigLeft),
  t("8", 8, grid(4, 2)),
  t("8c", 8, grid(2, 4)),
  t("8h", 8, cols),
  t("8v", 8, rows),
];

// Id mẫu của bản app trước (đoán theo trí nhớ) → mẫu TV tương ứng, để layout đã lưu vẫn tô đúng mẫu trong popup.
const LEGACY_TEMPLATE_IDS: Record<string, string> = {
  "1": "s", "2-cols": "2h", "2-rows": "2v", "3-cols": "3h", "3-rows": "3v", "3-l1r2": "3s", "3-l2r1": "3r", "3-t1b2": "1-2", "3-t2b1": "2-1",
  "4-grid": "4", "4-cols": "4h", "4-rows": "4v", "4-l1r3": "4s", "4-l3r1": "4s-l", "4-t1b3": "1-3", "4-t3b1": "3-1",
  "5-t2b3": "2-3", "5-cols": "5h", "6-2x3": "6", "6-3x2": "6c", "7-t3b4": "4-3", "8-2x4": "8", "8-4x2": "8",
};
export const canonicalTemplateId = (id: string) => LEGACY_TEMPLATE_IDS[id] ?? id;

export const MAX_PANES = 8;
export const templateById = (id: string) => TEMPLATES.find((x) => x.id === canonicalTemplateId(id));
export const buildTemplate = (id: string, ids: string[]): Node => {
  const tpl = templateById(id);
  if (!tpl) throw new Error(`unknown layout template ${id}`);
  if (ids.length !== tpl.count) throw new Error(`template ${id} needs ${tpl.count} panes, got ${ids.length}`);
  return tpl.build(ids);
};

/** Id các pane theo thứ tự trong cây (trái→phải, trên→dưới). */
export function paneIds(n: Node): string[] {
  return isLeaf(n) ? [n.pane] : n.children.flatMap(paneIds);
}

export const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

/** Hình chữ nhật (tỉ lệ) của từng pane. */
export function paneRects(n: Node, r: Rect = FULL, out: Record<string, Rect> = {}): Record<string, Rect> {
  if (isLeaf(n)) {
    out[n.pane] = r;
    return out;
  }
  let at = 0;
  n.children.forEach((c, i) => {
    const f = n.sizes[i];
    paneRects(c, n.dir === "row" ? { x: r.x + r.w * at, y: r.y, w: r.w * f, h: r.h } : { x: r.x, y: r.y + r.h * at, w: r.w, h: r.h * f }, out);
    at += f;
  });
  return out;
}

export type Gutter = {
  path: number[]; // đường đi từ gốc tới nhóm chứa gutter (chỉ số con)
  index: number; // gutter nằm giữa con `index` và `index + 1`
  dir: "row" | "col";
  parent: Rect; // khung của nhóm (tỉ lệ)
  line: Rect; // vị trí đường chia: bề rộng/cao 0 theo trục chia
};

/** Mọi đường chia kéo được. */
export function gutters(n: Node, r: Rect = FULL, path: number[] = []): Gutter[] {
  if (isLeaf(n)) return [];
  const out: Gutter[] = [];
  let at = 0;
  n.children.forEach((c, i) => {
    const f = n.sizes[i];
    const cr = n.dir === "row" ? { x: r.x + r.w * at, y: r.y, w: r.w * f, h: r.h } : { x: r.x, y: r.y + r.h * at, w: r.w, h: r.h * f };
    out.push(...gutters(c, cr, [...path, i]));
    at += f;
    if (i < n.children.length - 1) {
      const line: Rect = n.dir === "row" ? { x: r.x + r.w * at, y: r.y, w: 0, h: r.h } : { x: r.x, y: r.y + r.h * at, w: r.w, h: 0 };
      out.push({ path, index: i, dir: n.dir, parent: r, line });
    }
  });
  return out;
}

/** Dời đường chia giữa ô `index` và `index+1` đi `delta` (tỉ lệ của nhóm); mỗi ô giữ ≥ `min`, tổng không đổi. */
export function dragSizes(sizes: number[], index: number, delta: number, min: number): number[] {
  const a = sizes[index];
  const b = sizes[index + 1];
  const total = a + b;
  const lo = Math.min(min, total / 2);
  const na = Math.min(total - lo, Math.max(lo, a + delta));
  const out = [...sizes];
  out[index] = na;
  out[index + 1] = total - na;
  return out;
}

/** Nhóm chia tại `path` (null nếu path vào lá / ngoài cây). */
export function splitAt(n: Node, path: number[]): Split | null {
  if (isLeaf(n)) return null;
  if (path.length === 0) return n;
  const child = n.children[path[0]];
  return child ? splitAt(child, path.slice(1)) : null;
}

/** Cây mới với `sizes` của nhóm tại `path` đổi thành `sizes` (bất biến). */
export function withSizes(n: Node, path: number[], sizes: number[]): Node {
  if (isLeaf(n)) return n;
  if (path.length === 0) return { ...n, sizes };
  const [i, ...rest] = path;
  return { ...n, children: n.children.map((c, k) => (k === i ? withSizes(c, rest, sizes) : c)) };
}

/** Id pane mới chưa dùng: p2, p3... (không tái dùng id đang có). */
export function nextPaneId(existing: string[]): string {
  let n = 2;
  while (existing.includes(`p${n}`)) n++;
  return `p${n}`;
}

/** Đổi sang mẫu `templateId` với các pane hiện có: giữ pane theo thứ tự, thiếu thì thêm id mới, thừa thì bỏ các ô cuối. */
export function retarget(current: string[], templateId: string) {
  const tpl = templateById(templateId);
  if (!tpl) throw new Error(`unknown layout template ${templateId}`);
  const kept = current.slice(0, tpl.count);
  const added: string[] = [];
  while (kept.length + added.length < tpl.count) added.push(nextPaneId([...current, ...added]));
  const ids = [...kept, ...added];
  return { ids, added, removed: current.slice(tpl.count), tree: tpl.build(ids) };
}
