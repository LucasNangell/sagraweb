import { beforeEach, describe, expect, it } from "vitest";

import {
  OS_HOME_TABLE_COLUMN_IDS,
  OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS,
  OS_HOME_TABLE_DEFAULT_WIDTHS,
  OS_HOME_TABLE_LAYOUT_STORAGE_KEY,
  OS_HOME_TABLE_MAX_WIDTH,
  OS_HOME_TABLE_MIN_WIDTHS,
  addOsHomeTableColumn,
  defaultOsHomeTableLayout,
  isOsHomeTableColumnRequired,
  isOsHomeTableColumnSortable,
  mergeOsHomeTableLayout,
  moveOsHomeTableColumn,
  normalizeOsHomeTableVisibility,
  osHomeTableColumnPercents,
  readLocalOsHomeTableLayout,
  removeOsHomeTableColumn,
  resizeOsHomeTableColumnPair,
  shiftOsHomeTableColumn,
  visibleOsHomeTableColumns,
} from "./osHomeTableLayout";

const ORIGINAL_COLUMNS = [
  "nr_os",
  "ano",
  "data_entrada",
  "produto",
  "solicitante",
  "titulo",
  "situacao",
  "setor",
  "prioridade",
  "data_entrega",
];

describe("osHomeTableLayout defaults", () => {
  it("exibe as colunas originais, na ordem e larguras atuais", () => {
    const layout = defaultOsHomeTableLayout();
    expect(visibleOsHomeTableColumns(layout)).toEqual(ORIGINAL_COLUMNS);
    expect(layout.widths).toEqual(OS_HOME_TABLE_DEFAULT_WIDTHS);
    expect(layout.widths.titulo).toBe(350);
  });

  it("campos extras existem mas começam ocultos", () => {
    const layout = defaultOsHomeTableLayout();
    const extras = OS_HOME_TABLE_COLUMN_IDS.filter(
      (id) => !OS_HOME_TABLE_DEFAULT_VISIBLE_COLUMNS.has(id),
    );
    expect(extras).toEqual(
      expect.arrayContaining(["formato", "observacao", "last_update"]),
    );
    for (const id of extras) {
      expect(layout.visibility[id]).toBe(false);
    }
  });

  it("retorna cópias independentes", () => {
    const a = defaultOsHomeTableLayout();
    a.order.reverse();
    a.widths.titulo = 1;
    const b = defaultOsHomeTableLayout();
    expect(b.order[0]).toBe("nr_os");
    expect(b.widths.titulo).toBe(350);
  });

  it("nr_os é obrigatória; só colunas originais ordenam", () => {
    expect(isOsHomeTableColumnRequired("nr_os")).toBe(true);
    expect(isOsHomeTableColumnRequired("titulo")).toBe(false);
    expect(isOsHomeTableColumnSortable("titulo")).toBe(true);
    expect(isOsHomeTableColumnSortable("observacao")).toBe(false);
    expect(isOsHomeTableColumnSortable("xpto")).toBe(false);
  });
});

describe("mergeOsHomeTableLayout", () => {
  it("payload inválido cai nos defaults", () => {
    expect(mergeOsHomeTableLayout(null)).toEqual(defaultOsHomeTableLayout());
    expect(mergeOsHomeTableLayout("x")).toEqual(defaultOsHomeTableLayout());
    expect(mergeOsHomeTableLayout([1, 2])).toEqual(defaultOsHomeTableLayout());
  });

  it("ignora ids desconhecidos/duplicados e anexa ids novos no fim", () => {
    const layout = mergeOsHomeTableLayout({
      order: ["titulo", "coluna_removida", "nr_os", "titulo", 42],
    });
    expect(layout.order.slice(0, 2)).toEqual(["titulo", "nr_os"]);
    expect(layout.order).toHaveLength(OS_HOME_TABLE_COLUMN_IDS.length);
    expect(new Set(layout.order).size).toBe(OS_HOME_TABLE_COLUMN_IDS.length);
  });

  it("layout antigo (sem campos extras) mantém extras ocultos", () => {
    const layout = mergeOsHomeTableLayout({
      order: ORIGINAL_COLUMNS,
      visibility: Object.fromEntries(ORIGINAL_COLUMNS.map((id) => [id, true])),
    });
    expect(visibleOsHomeTableColumns(layout)).toEqual(ORIGINAL_COLUMNS);
  });

  it("força nr_os visível e preserva demais flags", () => {
    const layout = mergeOsHomeTableLayout({
      visibility: { nr_os: false, ano: false, produto: "nao", formato: true, xpto: false },
    });
    expect(layout.visibility.nr_os).toBe(true);
    expect(layout.visibility.ano).toBe(false);
    expect(layout.visibility.produto).toBe(true);
    expect(layout.visibility.formato).toBe(true);
    expect("xpto" in layout.visibility).toBe(false);
  });

  it("saneia larguras: inválidas voltam ao default, válidas são limitadas", () => {
    const layout = mergeOsHomeTableLayout({
      widths: {
        titulo: 10,
        produto: 99999,
        setor: Number.NaN,
        ano: -5,
        solicitante: "200",
        situacao: 180.6,
      },
    });
    expect(layout.widths.titulo).toBe(OS_HOME_TABLE_MIN_WIDTHS.titulo);
    expect(layout.widths.produto).toBe(OS_HOME_TABLE_MAX_WIDTH);
    expect(layout.widths.setor).toBe(OS_HOME_TABLE_DEFAULT_WIDTHS.setor);
    expect(layout.widths.ano).toBe(OS_HOME_TABLE_DEFAULT_WIDTHS.ano);
    expect(layout.widths.solicitante).toBe(OS_HOME_TABLE_DEFAULT_WIDTHS.solicitante);
    expect(layout.widths.situacao).toBe(181);
  });
});

describe("readLocalOsHomeTableLayout", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("sem cache retorna defaults", () => {
    expect(readLocalOsHomeTableLayout()).toEqual(defaultOsHomeTableLayout());
  });

  it("JSON corrompido retorna defaults", () => {
    localStorage.setItem(OS_HOME_TABLE_LAYOUT_STORAGE_KEY, "{oops");
    expect(readLocalOsHomeTableLayout()).toEqual(defaultOsHomeTableLayout());
  });

  it("lê e saneia o cache", () => {
    localStorage.setItem(
      OS_HOME_TABLE_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        order: ["ano", "nr_os"],
        visibility: { nr_os: false, setor: false },
        widths: { ano: 70 },
      }),
    );
    const layout = readLocalOsHomeTableLayout();
    expect(layout.order.slice(0, 2)).toEqual(["ano", "nr_os"]);
    expect(layout.visibility.nr_os).toBe(true);
    expect(layout.visibility.setor).toBe(false);
    expect(layout.widths.ano).toBe(70);
  });
});

describe("osHomeTableColumnPercents", () => {
  it("frações das colunas visíveis somam 100%", () => {
    const layout = defaultOsHomeTableLayout();
    const percents = osHomeTableColumnPercents(layout);
    const total = [...percents.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
    expect(percents.has("observacao")).toBe(false);
  });

  it("ocultar uma coluna redistribui proporcionalmente (lista segue 100%)", () => {
    const layout = removeOsHomeTableColumn(defaultOsHomeTableLayout(), "titulo");
    const percents = osHomeTableColumnPercents(layout);
    const total = [...percents.values()].reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(100, 6);
    // Razão entre duas colunas é preservada.
    expect(percents.get("solicitante")! / percents.get("produto")!).toBeCloseTo(200 / 150, 6);
  });
});

describe("resizeOsHomeTableColumnPair", () => {
  it("o que a coluna ganha a vizinha perde (soma constante)", () => {
    expect(resizeOsHomeTableColumnPair(350, 140, "titulo", "situacao", 60)).toEqual({
      left: 410,
      right: 80,
    });
    expect(resizeOsHomeTableColumnPair(350, 140, "titulo", "situacao", -100)).toEqual({
      left: 250,
      right: 240,
    });
  });

  it("respeita os mínimos de ambas", () => {
    expect(resizeOsHomeTableColumnPair(350, 140, "titulo", "situacao", 1000)).toEqual({
      left: 420,
      right: 70,
    });
    expect(resizeOsHomeTableColumnPair(350, 140, "titulo", "situacao", -1000)).toEqual({
      left: 80,
      right: 410,
    });
  });
});

describe("normalizeOsHomeTableVisibility", () => {
  it("ids ausentes mantêm o estado anterior; nr_os sempre true", () => {
    const prev = defaultOsHomeTableLayout().visibility;
    const next = normalizeOsHomeTableVisibility({ nr_os: false, titulo: false }, prev);
    expect(next.nr_os).toBe(true);
    expect(next.titulo).toBe(false);
    expect(next.ano).toBe(true);
    expect(next.observacao).toBe(false);
  });
});

describe("edição de campos", () => {
  it("adicionar coloca o campo no fim das colunas visíveis", () => {
    const layout = addOsHomeTableColumn(defaultOsHomeTableLayout(), "observacao");
    const visible = visibleOsHomeTableColumns(layout);
    expect(visible.at(-1)).toBe("observacao");
    expect(visible).toHaveLength(ORIGINAL_COLUMNS.length + 1);
  });

  it("remover oculta, exceto nr_os", () => {
    const base = defaultOsHomeTableLayout();
    expect(removeOsHomeTableColumn(base, "titulo").visibility.titulo).toBe(false);
    expect(removeOsHomeTableColumn(base, "nr_os")).toBe(base);
  });

  it("shift move entre as visíveis, pulando ocultas", () => {
    const base = removeOsHomeTableColumn(defaultOsHomeTableLayout(), "situacao");
    const moved = shiftOsHomeTableColumn(base, "setor", -1);
    const visible = visibleOsHomeTableColumns(moved);
    expect(visible.indexOf("setor")).toBe(visible.indexOf("titulo") - 1);
    expect(shiftOsHomeTableColumn(base, "nr_os", -1)).toBe(base);
  });

  it("moveOsHomeTableColumn: ids inválidos ou iguais mantêm a ordem", () => {
    const order = [...OS_HOME_TABLE_COLUMN_IDS];
    expect(moveOsHomeTableColumn(order, "xpto", "nr_os")).toEqual(order);
    expect(moveOsHomeTableColumn(order, "ano", "ano")).toEqual(order);
    expect(moveOsHomeTableColumn(order, "titulo", "nr_os").slice(0, 2)).toEqual([
      "titulo",
      "nr_os",
    ]);
  });
});
