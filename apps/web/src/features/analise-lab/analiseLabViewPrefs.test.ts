import { afterEach, describe, expect, it } from "vitest";

import {
  addGuideMm,
  DEFAULT_VIEW_PREFS,
  gridLinesMm,
  loadViewPrefs,
  moveGuideMm,
  normalizeViewPrefs,
  removeGuideMm,
  saveViewPrefs,
} from "./analiseLabViewPrefs";

describe("analiseLabViewPrefs", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("defaults when storage is empty", () => {
    expect(loadViewPrefs(2026, 1)).toEqual({
      ...DEFAULT_VIEW_PREFS,
      guidesXMm: [],
      guidesYMm: [],
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
      guidesXMm: [],
      guidesYMm: [],
    });
  });

  it("round-trips guides", () => {
    const prefs = normalizeViewPrefs({
      guidesXMm: [10, 20.55],
      guidesYMm: [5],
      grid: true,
      gridStepMm: 5,
    });
    saveViewPrefs(2026, 99, prefs);
    expect(loadViewPrefs(2026, 99)).toEqual({
      rulers: true,
      grid: true,
      gridStepMm: 5,
      gridColor: DEFAULT_VIEW_PREFS.gridColor,
      guides: true,
      guideColor: DEFAULT_VIEW_PREFS.guideColor,
      guidesXMm: [10, 20.6],
      guidesYMm: [5],
    });
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

  it("builds grid lines excluding edges", () => {
    expect(gridLinesMm(30, 10)).toEqual([10, 20]);
    expect(gridLinesMm(25, 10)).toEqual([10, 20]);
    expect(gridLinesMm(10, 10)).toEqual([]);
  });

  it("adds and removes guides without duplicates", () => {
    let prefs = normalizeViewPrefs();
    prefs = addGuideMm(prefs, "x", 12.34);
    prefs = addGuideMm(prefs, "x", 12.4);
    expect(prefs.guidesXMm).toEqual([12.3]);
    prefs = removeGuideMm(prefs, "x", 12.3);
    expect(prefs.guidesXMm).toEqual([]);
  });

  it("move uma guia da origem para o destino", () => {
    let prefs = normalizeViewPrefs({ guidesXMm: [10, 50], guidesYMm: [30] });
    prefs = moveGuideMm(prefs, "x", 10, 42.5);
    expect(prefs.guidesXMm).toEqual([42.5, 50]);
    expect(prefs.guidesYMm).toEqual([30]);
    prefs = moveGuideMm(prefs, "y", 30, Number.NaN);
    expect(prefs.guidesYMm).toEqual([30]);
  });
});
