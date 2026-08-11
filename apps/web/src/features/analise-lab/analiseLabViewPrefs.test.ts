import { afterEach, describe, expect, it } from "vitest";

import {
  addGuideMm,
  DEFAULT_VIEW_PREFS,
  gridLinesMm,
  loadViewPrefs,
  moveGuideById,
  moveGuideMm,
  normalizeViewPrefs,
  parallelGuideDistanceMm,
  removeGuideById,
  removeGuideMm,
  removeGuidesByIds,
  saveViewPrefs,
  setGuideColorById,
} from "./analiseLabViewPrefs";

describe("analiseLabViewPrefs", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults when storage is empty", () => {
    expect(loadViewPrefs(2026, 1)).toEqual({
      ...DEFAULT_VIEW_PREFS,
      guidesX: [],
      guidesY: [],
    });
  });

  it("clamps grid step and merges partial", () => {
    expect(normalizeViewPrefs({ gridStepMm: 0 }).gridStepMm).toBe(1);
    expect(normalizeViewPrefs({ gridStepMm: 999 }).gridStepMm).toBe(100);
    expect(normalizeViewPrefs({ rulers: false, grid: true }).rulers).toBe(
      false,
    );
    expect(normalizeViewPrefs({ rulers: false, grid: true }).grid).toBe(true);
  });

  it("falls back on invalid JSON", () => {
    localStorage.setItem("analise-lab:view:2026:42", "{not-json");
    expect(loadViewPrefs(2026, 42)).toEqual({
      ...DEFAULT_VIEW_PREFS,
      guidesX: [],
      guidesY: [],
    });
  });

  it("migrates legacy guidesXMm arrays with paint color", () => {
    const prefs = normalizeViewPrefs({
      guideColor: "#112233",
      guidesXMm: [10, 20.55],
      guidesYMm: [5],
      grid: true,
      gridStepMm: 5,
    } as Parameters<typeof normalizeViewPrefs>[0]);
    expect(prefs.guidesX.map((g) => g.posMm)).toEqual([10, 20.6]);
    expect(prefs.guidesY.map((g) => g.posMm)).toEqual([5]);
    expect(prefs.guidesX.every((g) => g.color === "#112233")).toBe(true);
    expect(prefs.guidesX.every((g) => g.id.length > 0)).toBe(true);
  });

  it("round-trips GuideLine objects", () => {
    const prefs = normalizeViewPrefs({
      guidesX: [{ id: "gx1", posMm: 10, color: "#aa0000" }],
      guidesY: [{ id: "gy1", posMm: 5, color: "#00aa00" }],
      grid: true,
      gridStepMm: 5,
    });
    saveViewPrefs(2026, 99, prefs);
    const loaded = loadViewPrefs(2026, 99);
    expect(loaded.guidesX).toEqual([
      { id: "gx1", posMm: 10, color: "#aa0000" },
    ]);
    expect(loaded.guidesY).toEqual([
      { id: "gy1", posMm: 5, color: "#00aa00" },
    ]);
  });

  it("normaliza cores de grade e guia", () => {
    expect(normalizeViewPrefs({ gridColor: "#FF00AA" }).gridColor).toBe(
      "#ff00aa",
    );
    expect(normalizeViewPrefs({ guideColor: "vermelho" }).guideColor).toBe(
      DEFAULT_VIEW_PREFS.guideColor,
    );
    expect(normalizeViewPrefs({ gridColor: "#abc" }).gridColor).toBe(
      DEFAULT_VIEW_PREFS.gridColor,
    );
  });

  it("normaliza offset auxiliar", () => {
    expect(normalizeViewPrefs({ offset: true, offsetMm: 12.34 })).toEqual(
      expect.objectContaining({
        offset: true,
        offsetMm: 12.3,
        offsetColor: DEFAULT_VIEW_PREFS.offsetColor,
      }),
    );
    expect(normalizeViewPrefs({ offsetMm: 0 }).offsetMm).toBe(0.5);
    expect(normalizeViewPrefs({ offsetColor: "#ABCDEF" }).offsetColor).toBe(
      "#abcdef",
    );
  });

  it("builds grid lines excluding edges", () => {
    expect(gridLinesMm(30, 10)).toEqual([10, 20]);
    expect(gridLinesMm(25, 10)).toEqual([10, 20]);
    expect(gridLinesMm(10, 10)).toEqual([]);
  });

  it("adds and removes guides without duplicates; new guide uses paint color", () => {
    let prefs = normalizeViewPrefs({ guideColor: "#abcdef" });
    prefs = addGuideMm(prefs, "x", 12.34);
    prefs = addGuideMm(prefs, "x", 12.4);
    expect(prefs.guidesX.map((g) => g.posMm)).toEqual([12.3]);
    expect(prefs.guidesX[0]?.color).toBe("#abcdef");
    prefs = removeGuideMm(prefs, "x", 12.3);
    expect(prefs.guidesX).toEqual([]);
  });

  it("move preserva cor e id da guia", () => {
    let prefs = normalizeViewPrefs({
      guidesX: [
        { id: "a", posMm: 10, color: "#111111" },
        { id: "b", posMm: 50, color: "#222222" },
      ],
      guidesY: [{ id: "c", posMm: 30, color: "#333333" }],
    });
    prefs = moveGuideMm(prefs, "x", 10, 42.5);
    expect(prefs.guidesX.find((g) => g.id === "a")).toEqual({
      id: "a",
      posMm: 42.5,
      color: "#111111",
    });
    expect(prefs.guidesY).toEqual([
      { id: "c", posMm: 30, color: "#333333" },
    ]);
    prefs = moveGuideMm(prefs, "y", 30, Number.NaN);
    expect(prefs.guidesY[0]?.posMm).toBe(30);
    prefs = moveGuideById(prefs, "b", 60);
    expect(prefs.guidesX.find((g) => g.id === "b")?.posMm).toBe(60);
  });

  it("setGuideColorById and removeGuidesByIds", () => {
    let prefs = normalizeViewPrefs({
      guidesX: [{ id: "a", posMm: 10, color: "#111111" }],
      guidesY: [{ id: "b", posMm: 20, color: "#222222" }],
    });
    prefs = setGuideColorById(prefs, "a", "#ABCDEF");
    expect(prefs.guidesX[0]?.color).toBe("#abcdef");
    prefs = removeGuideById(prefs, "b");
    expect(prefs.guidesY).toEqual([]);
    prefs = removeGuidesByIds(prefs, ["a"]);
    expect(prefs.guidesX).toEqual([]);
  });

  it("parallelGuideDistanceMm só para eixos iguais", () => {
    const prefs = normalizeViewPrefs({
      guidesX: [
        { id: "x1", posMm: 10, color: "#111111" },
        { id: "x2", posMm: 40.5, color: "#111111" },
      ],
      guidesY: [{ id: "y1", posMm: 5, color: "#111111" }],
    });
    expect(parallelGuideDistanceMm(prefs, "x1", "x2")).toBe(30.5);
    expect(parallelGuideDistanceMm(prefs, "x1", "y1")).toBeNull();
  });

  it("changing guideColor does not recolor existing guides", () => {
    let prefs = normalizeViewPrefs({
      guideColor: "#111111",
      guidesX: [{ id: "a", posMm: 10, color: "#111111" }],
    });
    prefs = { ...prefs, guideColor: "#ff0000" };
    prefs = addGuideMm(prefs, "x", 50);
    expect(prefs.guidesX.find((g) => g.id === "a")?.color).toBe("#111111");
    expect(prefs.guidesX.find((g) => g.posMm === 50)?.color).toBe("#ff0000");
  });
});
