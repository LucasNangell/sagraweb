import { describe, expect, it } from "vitest";

import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import {
  buildPageBalloons,
  markAnchorMm,
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
});
