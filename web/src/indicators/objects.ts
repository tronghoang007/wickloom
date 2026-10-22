import type { ObjBox, ObjLabel, ObjLine, ObjectSet, ProfileSet } from "./schema";

/** `max_lines_count` / `max_labels_count` / `max_boxes_count` lớn nhất của Pine. */
export const MAX_OBJECTS = 500;

export const emptyObjects = (): ObjectSet => ({ lines: [], labels: [], boxes: [] });

function push<T>(list: T[], o: T, max: number): T {
  list.push(o);
  if (list.length > max) list.shift(); // quá giới hạn thì Pine xoá object cũ nhất (tạo sớm nhất)
  return o;
}

/** Tạo object như `line.new` / `label.new` / `box.new`: trả lại chính object để compute sửa tiếp (`set_x2`...). */
export class ObjectBuilder {
  readonly set: ObjectSet = emptyObjects();
  constructor(private readonly max = MAX_OBJECTS) {}
  line(o: ObjLine): ObjLine {
    return push(this.set.lines, o, this.max);
  }
  label(o: ObjLabel): ObjLabel {
    return push(this.set.labels, o, this.max);
  }
  box(o: ObjBox): ObjBox {
    return push(this.set.boxes, o, this.max);
  }
}

const finite = (...v: number[]) => v.every(Number.isFinite);

/** Bỏ object có toạ độ na/vô cực (Pine bỏ qua object chưa đặt vị trí) và giữ tối đa `MAX_OBJECTS` object mới nhất mỗi loại. */
export function sanitizeObjects(s: ObjectSet): ObjectSet {
  return {
    lines: s.lines.filter((o) => finite(o.x1, o.y1, o.x2, o.y2)).slice(-MAX_OBJECTS),
    labels: s.labels.filter((o) => finite(o.x, o.y) && typeof o.text === "string").slice(-MAX_OBJECTS),
    boxes: s.boxes.filter((o) => finite(o.x1, o.y1, o.x2, o.y2)).slice(-MAX_OBJECTS),
  };
}

/** Bỏ `cut` nến đầu (lịch sử nạp ngầm): x dịch sang trái `cut`, nên x âm = trước nến đầu của chart. */
export function trimObjects(s: ObjectSet, cut: number): ObjectSet {
  if (cut === 0) return s;
  return {
    lines: s.lines.map((o) => ({ ...o, x1: o.x1 - cut, x2: o.x2 - cut })),
    labels: s.labels.map((o) => ({ ...o, x: o.x - cut })),
    boxes: s.boxes.map((o) => ({ ...o, x1: o.x1 - cut, x2: o.x2 - cut })),
  };
}

/** Như `trimObjects` cho volume profile: dịch chỉ số nến đầu/cuối của từng phiên sang trái `cut` (profile ghim không dùng x nên giữ nguyên). */
export function trimProfiles(s: ProfileSet, cut: number): ProfileSet {
  return cut === 0 || s.style.pinned ? s : { ...s, profiles: s.profiles.map((p) => ({ ...p, x1: p.x1 - cut, x2: p.x2 - cut })) };
}

/** Chỉ số (lẻ) của mốc thời gian `t` trong `times` tăng dần: nến có `t` thì đúng chỉ số đó, giữa hai nến thì nến đứng trước,
 *  ngoài hai đầu thì ngoại suy theo `step` giây một nến (như `xloc.bar_time` của Pine vẽ được cả vùng tương lai). */
export function indexAtTime(times: number[], t: number, step: number): number {
  const n = times.length;
  if (n === 0) return NaN;
  if (t >= times[n - 1]) return n - 1 + (t - times[n - 1]) / step;
  if (t < times[0]) return (t - times[0]) / step;
  let lo = 0;
  let hi = n - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
