import { describe, expect, it } from "vitest";

import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import {
  buildPageBalloons,
  computeFitBalloonHeight,
  markAnchorMm,
  occurrenceIndexForActivePage,
  packBalloons,
  type BalloonAnchor,
} from "./analiseLabBalloons";
import { pageSizeMm } from "./analiseLabGeometry";
import { parsePageSpec } from "./analiseLabPageSpec";

const pages = [
  { page: 1, role: "cover-front", widthPt: 595, heightPt: 842 },
  { page: 2, role: "page", widthPt: 595, heightPt: 842 },
  { page: 3, role: "page", widthPt: 595, heightPt: 842 },
] as ProvaWebPageMeta[];

function item(partial: Partial<AnaliseLabItem> & Pick<AnaliseLabItem, "id">): AnaliseLabItem {
  return {
    sessaoId: 1,
    titulo: `Item ${partial.id}`,
    htmlSnapshot: "<p>x</p>",
    componente: "Miolo",
    escopo: "pagina",
    pagina: 2,
    versaoLabel: "v1",
    ordem: partial.id,
    ...partial,
  };
}

describe("analiseLabBalloons", () => {
  it("anchors marks by type", () => {
    const ponto: AnaliseLabMark = {
      id: 1,
      sessaoId: 1,
      pagina: 1,
      tipo: "ponto",
      geometria: { xMm: 10, yMm: 20 },
      cor: "red",
    };
    expect(markAnchorMm(ponto, 1, 210, 297)).toEqual({ xMm: 10, yMm: 20 });

    const seta: AnaliseLabMark = {
      ...ponto,
      tipo: "seta",
      geometria: { x1Mm: 0, y1Mm: 0, x2Mm: 40, y2Mm: 50 },
    };
    expect(markAnchorMm(seta, 1, 210, 297)).toEqual({ xMm: 40, yMm: 50 });
  });

  it("builds one balloon per item on visible pages including arquivo", () => {
    const items: AnaliseLabItem[] = [
      item({
        id: 10,
        titulo: "A",
        componente: "Miolo",
        escopo: "arquivo",
        pagina: 0,
      }),
      item({
        id: 11,
        titulo: "B",
        escopo: "pagina",
        pagina: 2,
      }),
    ];
    const marks: AnaliseLabMark[] = [
      {
        id: 1,
        sessaoId: 1,
        pagina: 2,
        tipo: "ponto",
        geometria: { xMm: 5, yMm: 5 },
        cor: "red",
        itemId: 11,
      },
    ];
    const balloons = buildPageBalloons({
      items,
      marks,
      pages,
      visiblePages: [pages[1]!],
      parsePageSpec,
      pageSizeMm,
    });
    expect(balloons.map((b) => b.itemId).sort()).toEqual([10, 11]);
    expect(balloons.find((b) => b.itemId === 11)?.hasMark).toBe(true);
    expect(balloons.find((b) => b.itemId === 10)?.markAnchors).toEqual([]);
  });

  it("agrupa múltiplas marcas do mesmo item num único balão", () => {
    const items = [item({ id: 20, pagina: 2 })];
    const marks: AnaliseLabMark[] = [
      {
        id: 101,
        sessaoId: 1,
        pagina: 2,
        tipo: "ponto",
        geometria: { xMm: 10, yMm: 10 },
        cor: "red",
        itemId: 20,
      },
      {
        id: 102,
        sessaoId: 1,
        pagina: 2,
        tipo: "ponto",
        geometria: { xMm: 50, yMm: 80 },
        cor: "blue",
        itemId: 20,
      },
    ];
    const balloons = buildPageBalloons({
      items,
      marks,
      pages,
      visiblePages: [pages[1]!],
      parsePageSpec,
      pageSizeMm,
    });
    expect(balloons).toHaveLength(1);
    expect(balloons[0]!.markAnchors).toHaveLength(2);
    expect(balloons[0]!.markAnchors.map((a) => a.markId).sort()).toEqual([
      101, 102,
    ]);
  });

  it("um balão no spread com marcas em páginas distintas e N leaders", () => {
    const items = [
      item({
        id: 30,
        escopo: "paginas",
        pagina: 1,
        paginas: "2-3",
      }),
    ];
    const marks: AnaliseLabMark[] = [
      {
        id: 201,
        sessaoId: 1,
        pagina: 2,
        tipo: "ponto",
        geometria: { xMm: 20, yMm: 30 },
        cor: "red",
        itemId: 30,
      },
      {
        id: 202,
        sessaoId: 1,
        pagina: 3,
        tipo: "ponto",
        geometria: { xMm: 40, yMm: 60 },
        cor: "red",
        itemId: 30,
      },
    ];
    const balloons = buildPageBalloons({
      items,
      marks,
      pages,
      visiblePages: [pages[1]!, pages[2]!],
      parsePageSpec,
      pageSizeMm,
    });
    expect(balloons).toHaveLength(1);
    expect(balloons[0]!.markAnchors.map((a) => a.page).sort()).toEqual([2, 3]);

    const packed = packBalloons(balloons, {
      stageHeight: 800,
      balloonHeight: 200,
      gap: 10,
      slotWidth: 600,
      gutterRight: 300,
      pageRects: {
        2: {
          left: 0,
          top: 0,
          width: 300,
          height: 800,
          widthMm: 210,
          heightMm: 297,
        },
        3: {
          left: 300,
          top: 0,
          width: 300,
          height: 800,
          widthMm: 210,
          heightMm: 297,
        },
      },
    });
    expect(packed).toHaveLength(1);
    expect(packed[0]!.leaders).toHaveLength(2);
    expect(packed[0]!.leaders.map((l) => l.page).sort()).toEqual([2, 3]);
    expect(new Set(packed[0]!.leaders.map((l) => l.anchorX)).size).toBe(2);
  });

  it("item sem marcas gera balão sem leaders", () => {
    const balloons = buildPageBalloons({
      items: [item({ id: 40, pagina: 2 })],
      marks: [],
      pages,
      visiblePages: [pages[1]!],
      parsePageSpec,
      pageSizeMm,
    });
    expect(balloons).toHaveLength(1);
    expect(balloons[0]!.hasMark).toBe(false);
    expect(balloons[0]!.markAnchors).toEqual([]);

    const packed = packBalloons(balloons, {
      stageHeight: 800,
      balloonHeight: 200,
      gap: 10,
      slotWidth: 600,
      gutterRight: 300,
      pageRects: {
        2: {
          left: 300,
          top: 0,
          width: 300,
          height: 800,
          widthMm: 210,
          heightMm: 297,
        },
      },
    });
    expect(packed).toHaveLength(1);
    expect(packed[0]!.leaders).toEqual([]);
  });

  it("mostra balão na página da marca mesmo fora do escopo do item", () => {
    const items = [item({ id: 50, pagina: 1, escopo: "pagina" })];
    const marks: AnaliseLabMark[] = [
      {
        id: 501,
        sessaoId: 1,
        pagina: 3,
        tipo: "ponto",
        geometria: { xMm: 10, yMm: 10 },
        cor: "red",
        itemId: 50,
      },
    ];
    const balloons = buildPageBalloons({
      items,
      marks,
      pages,
      visiblePages: [pages[2]!],
      parsePageSpec,
      pageSizeMm,
    });
    expect(balloons).toHaveLength(1);
    expect(balloons[0]!.itemId).toBe(50);
    expect(balloons[0]!.page).toBe(3);
    expect(balloons[0]!.hasMark).toBe(true);
  });

  it("um balão no spread quando marcas do item estão nas páginas visíveis", () => {
    const items = [item({ id: 51, pagina: 1, escopo: "pagina" })];
    const marks: AnaliseLabMark[] = [
      {
        id: 601,
        sessaoId: 1,
        pagina: 2,
        tipo: "ponto",
        geometria: { xMm: 10, yMm: 10 },
        cor: "red",
        itemId: 51,
      },
      {
        id: 602,
        sessaoId: 1,
        pagina: 3,
        tipo: "ponto",
        geometria: { xMm: 20, yMm: 20 },
        cor: "red",
        itemId: 51,
      },
    ];
    const balloons = buildPageBalloons({
      items,
      marks,
      pages,
      visiblePages: [pages[1]!, pages[2]!],
      parsePageSpec,
      pageSizeMm,
    });
    expect(balloons).toHaveLength(1);
    expect(balloons[0]!.markAnchors.map((a) => a.page).sort()).toEqual([2, 3]);
  });

  it("packs balloons without overlap", () => {
    const anchors: BalloonAnchor[] = [
      {
        itemId: 1,
        page: 2,
        refNumber: 1,
        hasMark: false,
        markAnchors: [],
        item: item({ id: 1, pagina: 2 }),
      },
      {
        itemId: 2,
        page: 2,
        refNumber: 2,
        hasMark: false,
        markAnchors: [],
        item: item({ id: 2, pagina: 2 }),
      },
    ];
    const packed = packBalloons(anchors, {
      stageHeight: 800,
      balloonHeight: 200,
      gap: 10,
      slotWidth: 600,
      gutterRight: 300,
      pageRects: {
        2: {
          left: 300,
          top: 0,
          width: 300,
          height: 800,
          widthMm: 210,
          heightMm: 297,
        },
      },
    });
    expect(packed).toHaveLength(2);
    expect(packed.every((b) => b.side === "right")).toBe(true);
    expect(packed.every((b) => b.bubbleX === 612)).toBe(true);
    expect(packed[1]!.topPx).toBeGreaterThanOrEqual(
      packed[0]!.topPx + 200 + 10,
    );
  });

  it("packs using heightsByItemId without overlap", () => {
    const gap = 10;
    const heightsByItemId: Record<number, number> = {
      1: 120,
      2: 80,
      3: 200,
    };
    const anchors: BalloonAnchor[] = [1, 2, 3].map((id) => ({
      itemId: id,
      page: 2,
      refNumber: id,
      hasMark: false,
      markAnchors: [],
      item: item({ id, pagina: 2 }),
    }));
    const packed = packBalloons(anchors, {
      stageHeight: 800,
      balloonHeight: 200,
      gap,
      slotWidth: 600,
      gutterRight: 300,
      heightsByItemId,
      pageRects: {
        2: {
          left: 300,
          top: 0,
          width: 300,
          height: 800,
          widthMm: 210,
          heightMm: 297,
        },
      },
    });
    expect(packed).toHaveLength(3);
    for (let i = 0; i < packed.length - 1; i++) {
      const h = heightsByItemId[packed[i]!.itemId]!;
      expect(packed[i + 1]!.topPx).toBeGreaterThanOrEqual(
        packed[i]!.topPx + h + gap,
      );
    }
  });

  it("packs more than 3 balloons and shrinks height to fit the stage", () => {
    const preferred = 200;
    const gap = 8;
    const stageHeight = 400;
    const anchors: BalloonAnchor[] = [1, 2, 3, 4, 5].map((id) => ({
      itemId: id,
      page: 2,
      refNumber: id,
      hasMark: false,
      markAnchors: [],
      item: item({ id, pagina: 2 }),
    }));
    const fitH = computeFitBalloonHeight(
      stageHeight,
      anchors.length,
      gap,
      preferred,
    );
    expect(fitH).toBeLessThan(preferred);
    expect(fitH).toBeGreaterThanOrEqual(1);

    const packed = packBalloons(anchors, {
      stageHeight,
      balloonHeight: preferred,
      gap,
      slotWidth: 600,
      gutterRight: 300,
      pageRects: {
        2: {
          left: 300,
          top: 0,
          width: 300,
          height: stageHeight,
          widthMm: 210,
          heightMm: 297,
        },
      },
    });
    expect(packed).toHaveLength(5);
    const last = packed[packed.length - 1]!;
    expect(last.topPx + fitH).toBeLessThanOrEqual(stageHeight);
    for (let i = 0; i < packed.length - 1; i++) {
      expect(packed[i + 1]!.topPx).toBeGreaterThanOrEqual(
        packed[i]!.topPx + fitH + gap,
      );
    }
  });
});

describe("occurrenceIndexForActivePage", () => {
  it("uses activePage when it is in the occurrence list", () => {
    expect(occurrenceIndexForActivePage([1, 2, 3, 4], 3, [2, 3])).toBe(2);
  });

  it("falls back to last visible occurrence when activePage is absent", () => {
    expect(occurrenceIndexForActivePage([1, 2, 3, 4], 99, [1, 2])).toBe(1);
  });

  it("advances past a page already in the spread (next arrow)", () => {
    const occ = [1, 2, 3, 4];
    const idx = occurrenceIndexForActivePage(occ, 2, [1, 2]);
    expect(idx).toBe(1);
    expect(occ[idx + 1]).toBe(3);
  });
});
