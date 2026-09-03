import { describe, expect, it } from "vitest";

import type { ProvaWebBookStructureItem, ProvaWebPageMeta } from "@/api/provaWeb";

import { buildPhysicalSpreads } from "./ProvaWebPhysicalBookViewer";

function page(pageNumber: number, role: ProvaWebPageMeta["role"]): ProvaWebPageMeta {
  return {
    page: pageNumber,
    file: `page-${pageNumber}.png`,
    width: 800,
    height: 1200,
    widthPt: 595,
    heightPt: 842,
    role,
    url: `/page-${pageNumber}.png`,
  };
}

describe("buildPhysicalSpreads", () => {
  it("mantém capa inicial e contracapa final isoladas no lado físico correto", () => {
    const pages = [
      page(1, "cover-front"),
      page(2, "page"),
      page(3, "page"),
      page(4, "cover-back"),
    ];
    const spreads = buildPhysicalSpreads(
      pages.map<ProvaWebBookStructureItem>((item) => ({ type: "page", page: item.page })),
      new Map(pages.map((item) => [item.page, item])),
    );

    expect(spreads).toMatchObject([
      { type: "pages", placement: "right-cover", pages: [{ page: 1 }] },
      { type: "pages", placement: "spread", pages: [{ page: 2 }, { page: 3 }] },
      { type: "pages", placement: "left-cover", pages: [{ page: 4 }] },
    ]);
  });

  it("separa encartes configurados dentro do fluxo do miolo", () => {
    const pages = [page(1, "page"), page(2, "page"), page(3, "page")];
    const spreads = buildPhysicalSpreads(
      [
        { type: "page", page: 1 },
        {
          type: "insert",
          pages: [2],
          insert: {
            id: "encarte-1",
            label: "Encarte dobrado",
            sourceComponent: "miolo",
            sourcePageStart: 2,
            sourcePageEnd: 2,
            kind: "foldout",
            widthMm: 420,
            heightMm: 297,
          },
        },
        { type: "page", page: 3 },
      ],
      new Map(pages.map((item) => [item.page, item])),
    );

    expect(spreads).toMatchObject([
      { type: "pages", pages: [{ page: 1 }] },
      { type: "insert", item: { pages: [2] } },
      { type: "pages", pages: [{ page: 3 }] },
    ]);
  });
});
