import { describe, expect, it } from "vitest";

import {
  buildSpreadRows,
  findRowIndexForPage,
  fitZoom,
  anchorScrollAfterZoom,
  nextZoomFromWheel,
  pageDisplaySize,
  resolveActivePageFromScroll,
  stepRowPage,
  zoomStep,
} from "./analiseLabFit";
import { pageSizeMm } from "./analiseLabGeometry";

describe("analiseLabFit", () => {
  it("fits by width when taller aspect", () => {
    const z = fitZoom(
      { width: 800, height: 1200 },
      { width: 400, height: 900 },
    );
    expect(z).toBeLessThan(1);
    expect(z).toBeGreaterThan(0.2);
  });

  it("fits by height when wider aspect", () => {
    const z = fitZoom(
      { width: 1200, height: 400 },
      { width: 900, height: 300 },
    );
    expect(z).toBeLessThan(1);
  });

  it("builds simple rows one page each", () => {
    const rows = buildSpreadRows([1, 2, 3, 4], "simples");
    expect(rows).toEqual([[1], [2], [3], [4]]);
  });

  it("builds duplex rows with first page alone", () => {
    expect(buildSpreadRows([1, 2, 3, 4, 5], "dupla")).toEqual([
      [1],
      [2, 3],
      [4, 5],
    ]);
    expect(buildSpreadRows([1, 2, 3, 4], "dupla")).toEqual([
      [1],
      [2, 3],
      [4],
    ]);
  });

  it("finds row for page", () => {
    const rows = buildSpreadRows(
      [{ page: 1 }, { page: 2 }, { page: 3 }],
      "dupla",
    );
    expect(findRowIndexForPage(rows, 1)).toBe(0);
    expect(findRowIndexForPage(rows, 3)).toBe(1);
  });

  it("keeps clicked page in duplex row during scroll sync", () => {
    const rows = buildSpreadRows(
      [{ page: 1 }, { page: 2 }, { page: 3 }, { page: 4 }, { page: 5 }],
      "dupla",
    );
    const rowElements = new Map<number, HTMLElement>();
    const mk = (top: number, height: number) =>
      ({
        offsetTop: top,
        offsetHeight: height,
      }) as HTMLElement;
    rowElements.set(0, mk(0, 100));
    rowElements.set(1, mk(100, 100));
    rowElements.set(2, mk(200, 100));

    expect(
      resolveActivePageFromScroll({
        rows,
        rowElements,
        scrollTop: 100,
        viewportHeight: 100,
        currentPage: 3,
      }),
    ).toBe(3);

    expect(
      resolveActivePageFromScroll({
        rows,
        rowElements,
        scrollTop: 100,
        viewportHeight: 100,
        currentPage: 2,
      }),
    ).toBe(2);

    expect(
      resolveActivePageFromScroll({
        rows,
        rowElements,
        scrollTop: 200,
        viewportHeight: 100,
        currentPage: 3,
      }),
    ).toBe(4);
  });

  it("zooms with wheel and keyboard steps", () => {
    expect(nextZoomFromWheel(1, 100, false)).toBeNull();
    const zoomedOut = nextZoomFromWheel(1, 200, true);
    expect(zoomedOut).not.toBeNull();
    expect(zoomedOut!).toBeLessThan(1);
    expect(zoomStep(1, 1)).toBeGreaterThan(1);
    expect(zoomStep(1, -1)).toBeLessThan(1);
  });

  it("anchors scroll after zoom", () => {
    const next = anchorScrollAfterZoom({
      scrollLeft: 100,
      scrollTop: 200,
      pointer: { x: 50, y: 40 },
      oldZoom: 1,
      newZoom: 2,
    });
    expect(next.scrollLeft).toBe(250);
    expect(next.scrollTop).toBe(440);
  });

  it("stepRowPage avança / volta entre linhas e para nos extremos", () => {
    const pages = [1, 2, 3, 4, 5].map((page) => ({ page }));
    const simples = buildSpreadRows(pages, "simples");
    expect(stepRowPage(simples, 1, 1)).toBe(2);
    expect(stepRowPage(simples, 1, -1)).toBeNull();
    expect(stepRowPage(simples, 5, 1)).toBeNull();
    const dupla = buildSpreadRows(pages, "dupla");
    expect(stepRowPage(dupla, 1, 1)).toBe(2);
    expect(stepRowPage(dupla, 2, 1)).toBe(4);
    expect(stepRowPage(dupla, 3, -1)).toBe(1);
    expect(stepRowPage(dupla, 4, 1)).toBeNull();
  });

  it("pageDisplaySize preserva aspecto Pt mesmo com raster inconsistente", () => {
    const size = pageDisplaySize(
      { width: 1000, height: 500, widthPt: 595, heightPt: 842 },
      1,
    );
    // Altura = round(1000 * 842/595) — não 500 do raster
    expect(size.width).toBe(1000);
    expect(size.height).toBe(Math.round(1000 * (842 / 595)));
    expect(size.height / size.width).toBeCloseTo(842 / 595, 3);
  });

  it("pageDisplaySize aplica zoom uniforme (sx ≈ sy em mm)", () => {
    const page = { width: 800, height: 999, widthPt: 595.28, heightPt: 841.89 };
    const z = 1.5;
    const { width, height } = pageDisplaySize(page, z);
    const { widthMm, heightMm } = pageSizeMm(page.widthPt, page.heightPt);
    const sx = width / widthMm;
    const sy = height / heightMm;
    expect(sx).toBeCloseTo(sy, 2);
    const base = pageDisplaySize(page, 1);
    expect(width).toBe(Math.round(base.width * z));
    expect(height).toBe(Math.round(base.height * z));
  });

  it("pageDisplaySize sem Pt usa aspecto do raster", () => {
    const size = pageDisplaySize({ width: 600, height: 900 }, 2);
    expect(size).toEqual({ width: 1200, height: 1800 });
  });
});
