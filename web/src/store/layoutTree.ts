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

// Danh sách mẫu theo trí nhớ về TradingView (layout-plan §2): chưa đối chiếu, xem Phase 0.
export const TEMPLATES: Template[] = [
  { id: "1", count: 1, build: ([a]) => leaf(a) },
  { id: "2-cols", count: 2, build: (i) => row(...leaves(i)) },
  { id: "2-rows", count: 2, build: (i) => col(...leaves(i)) },
  { id: "3-cols", count: 3, build: (i) => row(...leaves(i)) },
  { id: "3-rows", count: 3, build: (i) => col(...leaves(i)) },
  { id: "3-l1r2", count: 3, build: ([a, b, c]) => row(leaf(a), col(leaf(b), leaf(c))) },
  { id: "3-l2r1", count: 3, build: ([a, b, c]) => row(col(leaf(a), leaf(b)), leaf(c)) },
  { id: "3-t1b2", count: 3, build: ([a, b, c]) => col(leaf(a), row(leaf(b), leaf(c))) },
  { id: "3-t2b1", count: 3, build: ([a, b, c]) => col(row(leaf(a), leaf(b)), leaf(c)) },
  { id: "4-grid", count: 4, build: ([a, b, c, d]) => col(row(leaf(a), leaf(b)), row(leaf(c), leaf(d))) },
  { id: "4-cols", count: 4, build: (i) => row(...leaves(i)) },
  { id: "4-rows", count: 4, build: (i) => col(...leaves(i)) },
  { id: "4-l1r3", count: 4, build: ([a, ...r]) => row(leaf(a), col(...leaves(r))) },
  { id: "4-l3r1", count: 4, build: ([a, b, c, d]) => row(col(leaf(a), leaf(b), leaf(c)), leaf(d)) },
  { id: "4-t1b3", count: 4, build: ([a, ...r]) => col(leaf(a), row(...leaves(r))) },
  { id: "4-t3b1", count: 4, build: ([a, b, c, d]) => col(row(leaf(a), leaf(b), leaf(c)), leaf(d)) },
  { id: "5-t2b3", count: 5, build: ([a, b, c, d, e]) => col(row(leaf(a), leaf(b)), row(leaf(c), leaf(d), leaf(e))) },
  { id: "5-cols", count: 5, build: (i) => row(...leaves(i)) },
  { id: "6-2x3", count: 6, build: (i) => col(row(...leaves(i.slice(0, 3))), row(...leaves(i.slice(3)))) },
  { id: "6-3x2", count: 6, build: (i) => row(col(...leaves(i.slice(0, 3))), col(...leaves(i.slice(3)))) },
  { id: "7-t3b4", count: 7, build: (i) => col(row(...leaves(i.slice(0, 3))), row(...leaves(i.slice(3)))) },
  { id: "8-2x4", count: 8, build: (i) => col(row(...leaves(i.slice(0, 4))), row(...leaves(i.slice(4)))) },
  { id: "8-4x2", count: 8, build: (i) => row(...[0, 2, 4, 6].map((k) => col(leaf(i[k]), leaf(i[k + 1])))) },
];

export const MAX_PANES = 8;
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
export const buildTemplate = (id: string, ids: string[]): Node => {
  const t = templateById(id);
  if (!t) throw new Error(`unknown layout template ${id}`);
  if (ids.length !== t.count) throw new Error(`template ${id} needs ${t.count} panes, got ${ids.length}`);
  return t.build(ids);
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
  const t = templateById(templateId);
  if (!t) throw new Error(`unknown layout template ${templateId}`);
  const kept = current.slice(0, t.count);
  const added: string[] = [];
  while (kept.length + added.length < t.count) added.push(nextPaneId([...current, ...added]));
  const ids = [...kept, ...added];
  return { ids, added, removed: current.slice(t.count), tree: t.build(ids) };
}
