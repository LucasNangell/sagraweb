import { describe, expect, it } from "vitest";

import {
  buildSpreadRows,
  findRowIndexForPage,
  fitZoom,
  anchorScrollAfterZoom,
  nextZoomFromWheel,
  resolveActivePageFromScroll,
  zoomStep,
} from "./analiseLabFit";

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
});
