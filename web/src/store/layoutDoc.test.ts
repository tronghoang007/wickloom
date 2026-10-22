import { describe, expect, it } from "vitest";
import { DEFAULT_SYNC, LAYOUT_VERSION, NO_SYNC, buildDoc, cleanName, docKey, parseLayoutDoc, summarizeDoc, tfShort, type LayoutDoc } from "./layoutDoc";
import { buildTemplate } from "./layoutTree";
import { createPane } from "./paneStores";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);

function twoPaneDoc(): LayoutDoc {
  const panes = {
    p1: createPane("p1", { chart: { symbol: "XAUUSDm", tf: "M15" } }),
    p2: createPane("p2", { chart: { symbol: "BTCUSDm", tf: "H1", chartType: "line" }, legendCollapsed: true }),
  };
  panes.p1.indicators.getState().add("sma");
  panes.p2.volume.getState().set({ maOn: true });
  return buildDoc({ name: "Scalp", templateId: "2h", tree: buildTemplate("2h", ids(2)), order: ["p1", "p2"], panes, activeId: "p2" }, 123);
}

describe("buildDoc", () => {
  it("chụp bố cục + state từng pane, không có replay/drawings", () => {
    const d = twoPaneDoc();
    expect(d).toMatchObject({ version: LAYOUT_VERSION, name: "Scalp", templateId: "2h", active: "p2", updatedAt: 123 });
    expect(Object.keys(d.panes)).toEqual(["p1", "p2"]);
    expect(d.panes.p1.indicators).toHaveLength(1);
    expect(d.panes.p2.chart).toMatchObject({ symbol: "BTCUSDm", tf: "H1", chartType: "line" });
    expect(d.panes.p2.legendCollapsed).toBe(true);
    expect(d.panes.p2.volume.maOn).toBe(true);
    expect(JSON.stringify(d)).not.toMatch(/replay|drawings|selectedId/);
  });
});

describe("docKey", () => {
  it("không tính updatedAt và active (đổi chart active hay lưu lại không làm 'có thay đổi')", () => {
    const a = twoPaneDoc();
    expect(docKey({ ...a, updatedAt: 999, active: "p1" })).toBe(docKey(a));
    expect(docKey({ ...a, name: "Khác" })).not.toBe(docKey(a));
    expect(docKey({ ...a, tree: buildTemplate("2v", ids(2)) })).not.toBe(docKey(a));
  });
});

describe("parseLayoutDoc", () => {
  it("round-trip qua JSON", () => {
    const d = twoPaneDoc();
    const r = parseLayoutDoc(JSON.parse(JSON.stringify(d)));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(docKey(r.doc)).toBe(docKey(d));
      expect(r.doc.active).toBe("p2");
    }
  });

  it("sync: doc cũ không có / hỏng → mặc định của TV (chỉ Crosshair); có object thì chỉ nhận đúng `true`; đổi công tắc là có thay đổi cần lưu", () => {
    const d = twoPaneDoc();
    expect(d.sync).toEqual(DEFAULT_SYNC);
    expect(DEFAULT_SYNC).toEqual({ ...NO_SYNC, crosshair: true });
    const parse = (sync: unknown) => {
      const r = parseLayoutDoc({ ...JSON.parse(JSON.stringify(d)), sync });
      if (!r.ok) throw new Error("parse failed");
      return r.doc;
    };
    expect(parse(undefined).sync).toEqual(DEFAULT_SYNC);
    expect(parse("symbol").sync).toEqual(DEFAULT_SYNC);
    expect(parse([true]).sync).toEqual(DEFAULT_SYNC);
    expect(parse({ symbol: 1, time: "true", dateRange: true, lạ: true }).sync).toEqual({ ...NO_SYNC, dateRange: true }); // object: thiếu = tắt
    const on = { ...d, sync: { ...NO_SYNC, symbol: true } };
    expect(docKey(on)).not.toBe(docKey(d));
    expect(parse(on.sync).sync).toEqual(on.sync);
    expect(docKey(parse(on.sync))).toBe(docKey(on)); // lưu rồi đọc lại: không bị coi là có thay đổi
  });

  it("templateId cũ của bản app trước được đổi sang id TV khi đọc; id lạ giữ nguyên", () => {
    const raw = JSON.parse(JSON.stringify(twoPaneDoc()));
    const id = (templateId: unknown) => {
      const r = parseLayoutDoc({ ...raw, templateId });
      if (!r.ok) throw new Error("parse failed");
      return r.doc.templateId;
    };
    expect(id("2h")).toBe("2h");
    expect(id("2-cols")).toBe("2h");
    expect(id("4-grid")).toBe("4");
    expect(id("từ-bản-khác")).toBe("từ-bản-khác");
    expect(id(5)).toBe("");
  });

  it("version lạ (app mới hơn) → reason version; thiếu/sai kiểu → invalid", () => {
    expect(parseLayoutDoc({ ...twoPaneDoc(), version: LAYOUT_VERSION + 1 })).toEqual({ ok: false, reason: "version" });
    expect(parseLayoutDoc(null)).toEqual({ ok: false, reason: "invalid" });
    expect(parseLayoutDoc({})).toEqual({ ok: false, reason: "invalid" });
    expect(parseLayoutDoc({ ...twoPaneDoc(), version: "1" })).toEqual({ ok: false, reason: "invalid" });
    expect(parseLayoutDoc({ ...twoPaneDoc(), panes: [] })).toEqual({ ok: false, reason: "invalid" });
  });

  it("cây hỏng: pane trùng, pane thiếu trong panes, pane thừa, nhóm 1 con, sizes sai độ dài", () => {
    const d = twoPaneDoc();
    const bad = (tree: unknown) => parseLayoutDoc({ ...d, tree });
    expect(bad({ dir: "row", sizes: [0.5, 0.5], children: [{ pane: "p1" }, { pane: "p1" }] }).ok).toBe(false);
    expect(bad({ dir: "row", sizes: [0.5, 0.5], children: [{ pane: "p1" }, { pane: "p9" }] }).ok).toBe(false);
    expect(bad({ pane: "p1" }).ok).toBe(false); // p2 thừa trong panes
    expect(bad({ dir: "row", sizes: [1], children: [{ pane: "p1" }] }).ok).toBe(false);
    expect(bad({ dir: "row", sizes: [0.5], children: [{ pane: "p1" }, { pane: "p2" }] }).ok).toBe(false);
    expect(bad({ dir: "row", sizes: [0.5, -1], children: [{ pane: "p1" }, { pane: "p2" }] }).ok).toBe(false);
    expect(bad({ dir: "diag", sizes: [0.5, 0.5], children: [{ pane: "p1" }, { pane: "p2" }] }).ok).toBe(false);
  });

  it("quá 8 ô thì từ chối", () => {
    const panes = Object.fromEntries(ids(9).map((id) => [id, createPane(id)]));
    const d = buildDoc({ name: "x", templateId: "", tree: { dir: "row", sizes: Array(9).fill(1 / 9), children: ids(9).map((p) => ({ pane: p })) }, order: ids(9), panes, activeId: "p1" });
    expect(parseLayoutDoc(d)).toEqual({ ok: false, reason: "invalid" });
  });

  it("chuẩn hoá: sizes về tổng 1, active lạ → pane đầu, tên rỗng → mặc định, field pane hỏng bị bỏ", () => {
    const d = twoPaneDoc();
    const r = parseLayoutDoc({
      ...d,
      name: "   ",
      active: "zzz",
      tree: { dir: "row", sizes: [2, 6], children: [{ pane: "p1" }, { pane: "p2" }] },
      panes: { ...d.panes, p1: { chart: { symbol: 42, tf: "H4" }, indicators: "x", volume: 7 } },
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.doc.tree as { sizes: number[] }).sizes).toEqual([0.25, 0.75]);
    expect(r.doc.active).toBe("p1");
    expect(r.doc.name).toBe("Unnamed");
    expect(r.doc.panes.p1.chart).toMatchObject({ symbol: "XAUUSDm", tf: "H4" }); // symbol sai kiểu → mặc định
    expect(r.doc.panes.p1.indicators).toEqual([]);
  });

  it("templateId lạ vẫn đọc được (bản app khác tạo)", () => {
    const r = parseLayoutDoc({ ...twoPaneDoc(), templateId: "tu-che" });
    expect(r.ok && r.doc.templateId).toBe("tu-che");
  });
});

describe("summarizeDoc / tfShort / cleanName", () => {
  it("tóm tắt như dialog Open của TV", () => {
    expect(summarizeDoc(twoPaneDoc())).toBe("XAUUSDm 15 · BTCUSDm 1h");
  });
  it("nhiều hơn 4 chart thì '+N'", () => {
    const panes = Object.fromEntries(ids(6).map((id) => [id, createPane(id)]));
    const d = buildDoc({ name: "x", templateId: "6", tree: buildTemplate("6", ids(6)), order: ids(6), panes, activeId: "p1" });
    expect(summarizeDoc(d)).toBe("XAUUSDm 5 · XAUUSDm 5 · XAUUSDm 5 · XAUUSDm 5 · +2");
  });
  it("nhãn khung", () => {
    expect(["M1", "M15", "H1", "H4", "D1", "W1", "MN1", "??"].map(tfShort)).toEqual(["1", "15", "1h", "4h", "1D", "1W", "1M", "??"]);
  });
  it("tên: cắt khoảng trắng, giới hạn độ dài, rỗng → mặc định", () => {
    expect(cleanName("  A  ")).toBe("A");
    expect(cleanName("x".repeat(500)).length).toBe(100);
    expect(cleanName("", "Fallback")).toBe("Fallback");
    expect(cleanName(42)).toBe("Unnamed");
  });
});
