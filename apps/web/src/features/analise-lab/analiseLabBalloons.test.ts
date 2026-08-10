import { describe, expect, it } from "vitest";

import type { AnaliseLabItem, AnaliseLabMark } from "@/api/analiseLab";
import type { ProvaWebPageMeta } from "@/api/provaWeb";

import {
  buildPageBalloons,
  markAnchorMm,
  packBalloons,
} from "./analiseLabBalloons";
import { pageSizeMm } from "./analiseLabGeometry";
import { parsePageSpec } from "./analiseLabPageSpec";

const pages = [
  { page: 1, role: "cover-front", widthPt: 595, heightPt: 842 },
  { page: 2, role: "page", widthPt: 595, heightPt: 842 },
  { page: 3, role: "page", widthPt: 595, heightPt: 842 },
] as ProvaWebPageMeta[];

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

  it("builds balloons for items on visible pages including arquivo", () => {
    const items: AnaliseLabItem[] = [
      {
        id: 10,
        sessaoId: 1,
        titulo: "A",
        htmlSnapshot: "<p>a</p>",
        componente: "Miolo",
        escopo: "arquivo",
        pagina: 0,
        versaoLabel: "v1",
        ordem: 1,
      },
      {
        id: 11,
        sessaoId: 1,
        titulo: "B",
        htmlSnapshot: "<p>b</p>",
        componente: "Miolo",
        escopo: "pagina",
        pagina: 2,
        versaoLabel: "v1",
        ordem: 2,
      },
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
      visiblePages: [pages[1]],
      parsePageSpec,
      pageSizeMm,
    });
    expect(balloons.map((b) => b.itemId).sort()).toEqual([10, 11]);
    expect(balloons.find((b) => b.itemId === 11)?.hasMark).toBe(true);
  });

  it("packs balloons without overlap", () => {
    const anchors = [
      {
        itemId: 1,
        page: 2,
        refNumber: 1,
        xMm: 100,
        yMm: 50,
        hasMark: false,
        item: {
          id: 1,
          sessaoId: 1,
          titulo: "A",
          htmlSnapshot: "",
          componente: "Miolo",
          escopo: "pagina",
          pagina: 2,
          versaoLabel: "v1",
          ordem: 1,
        },
      },
      {
        itemId: 2,
        page: 2,
        refNumber: 2,
        xMm: 100,
        yMm: 60,
        hasMark: false,
        item: {
          id: 2,
          sessaoId: 1,
          titulo: "B",
          htmlSnapshot: "",
          componente: "Miolo",
          escopo: "pagina",
          pagina: 2,
          versaoLabel: "v1",
          ordem: 2,
        },
      },
    ];
    const packed = packBalloons(anchors, {
      stageHeight: 800,
      balloonHeight: 200,
      gap: 10,
      slotWidth: 600,
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
    expect(packed[1].topPx).toBeGreaterThanOrEqual(
      packed[0].topPx + 200 + 10,
    );
  });
});
