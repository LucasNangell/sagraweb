import { describe, expect, it } from "vitest";

import { DEFAULT_IMPOSICAO_CONFIG } from "./types";
import {
  buildImposicaoGridLayout,
  paintCellOcupada,
  toggleCellOcupada,
} from "./imposicaoGridLayout";

describe("imposicaoGridLayout", () => {
  it("A5 2x1 centralizado alinha células", () => {
    const { folhaW, cells } = buildImposicaoGridLayout(DEFAULT_IMPOSICAO_CONFIG);
    expect(folhaW).toBe(297);
    expect(cells).toHaveLength(2);
    // Sem ocupadas explícitas: step & repeat da página 1.
    expect(cells[0].pagina).toBe(1);
    expect(cells[1].pagina).toBe(1);
    expect(cells[0].xMm).toBeCloseTo(0.5, 2);
    expect(cells[1].xMm).toBeCloseTo(148.5, 2);
  });

  it("permite repetir a mesma página e grade do verso", () => {
    const layout = buildImposicaoGridLayout(
      {
        ...DEFAULT_IMPOSICAO_CONFIG,
        work_style: "Duplex",
        grid: {
          colunas: 2,
          linhas: 1,
          ocupadas: [
            { col: 0, row: 0, pagina: 1 },
            { col: 1, row: 0, pagina: 1 },
          ],
          ocupadas_verso: [
            { col: 0, row: 0, pagina: 2 },
            { col: 1, row: 0, pagina: 2 },
          ],
        },
      },
      "verso",
    );
    expect(layout.cells.map((c) => c.pagina)).toEqual([2, 2]);
  });

  it("ocupadas parciais deixam células em branco", () => {
    const layout = buildImposicaoGridLayout({
      ...DEFAULT_IMPOSICAO_CONFIG,
      grid: {
        colunas: 2,
        linhas: 2,
        ocupadas: [{ col: 1, row: 0, pagina: 1 }],
      },
    });
    expect(layout.cells).toHaveLength(4);
    const occupied = layout.cells.filter((c) => c.pagina != null);
    expect(occupied).toHaveLength(1);
    expect(occupied[0]).toMatchObject({ col: 1, row: 0, pagina: 1 });
  });

  it("toggle adiciona e remove numeração", () => {
    const first = toggleCellOcupada(undefined, 2, 1, 0, 0);
    // partiu da grade cheia (todas pág. 1) e removeu (0,0)
    expect(first).toEqual([{ col: 1, row: 0, pagina: 1 }]);

    const second = toggleCellOcupada(first, 2, 1, 0, 0);
    expect(second).toEqual([
      { col: 1, row: 0, pagina: 1 },
      { col: 0, row: 0, pagina: 2 },
    ]);
  });

  it("paint permite repetir a mesma página", () => {
    const painted = paintCellOcupada(undefined, 2, 1, 1, 0, 1);
    // partiu de todas pág.1; clicar pág.1 em (1,0) limpa
    expect(painted).toEqual([{ col: 0, row: 0, pagina: 1 }]);

    const bothPage2 = paintCellOcupada(
      [
        { col: 0, row: 0, pagina: 1 },
        { col: 1, row: 0, pagina: 1 },
      ],
      2,
      1,
      0,
      0,
      2,
    );
    expect(bothPage2).toEqual([
      { col: 1, row: 0, pagina: 1 },
      { col: 0, row: 0, pagina: 2 },
    ]);
  });
});
