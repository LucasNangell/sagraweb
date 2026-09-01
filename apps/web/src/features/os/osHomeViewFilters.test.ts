import { describe, expect, it } from "vitest";

import { osSearchQueryKey } from "./osSearchQueryKey";
import {
  applyOsHomeLocalView,
  applyOsHomeViewFilters,
  canUseOsHomeLocalView,
  countUniqueOsProtocols,
  osHomeDatasetQueryKey,
  osHomePatchTriggersFetch,
  sortOsHomeViewRows,
  toOsHomeDatasetFilters,
} from "./osHomeViewFilters";
import type { OsSearchFilters, OsSearchRow } from "./types";

const baseFilters: OsSearchFilters = {
  nrOs: undefined,
  anos: [2026],
  produto: "",
  produtos: [],
  titulo: "",
  processo: "",
  solicitante: "",
  solicitantes: [],
  categorias: [],
  maquinas: [],
  situacao: [],
  setor: [],
  prioridade: [],
  includeFinished: true,
  includeOs: true,
  includeSp: true,
  page: 1,
  limit: 20,
  sortBy: "ano",
  sortDir: "asc",
  fetchAll: true,
};

function row(partial: Partial<OsSearchRow> & Pick<OsSearchRow, "nr_os" | "ano">): OsSearchRow {
  return partial;
}

describe("canUseOsHomeLocalView", () => {
  it("é true com anos", () => {
    expect(canUseOsHomeLocalView(baseFilters)).toBe(true);
  });

  it("é false sem ano", () => {
    expect(canUseOsHomeLocalView({ ...baseFilters, anos: [] })).toBe(false);
  });
});

describe("toOsHomeDatasetFilters", () => {
  it("zera visão quando há ano", () => {
    const dataset = toOsHomeDatasetFilters({
      ...baseFilters,
      situacao: ["Em Execução"],
      setor: ["SEFOC"],
      prioridade: ["Normal"],
      titulo: "relatorio",
      solicitantes: ["Gab"],
      nrOs: 10,
      includeOs: false,
      includeSp: true,
      sortBy: "situacao",
      sortDir: "desc",
      exactOsLookup: true,
    });
    expect(dataset.situacao).toEqual([]);
    expect(dataset.setor).toEqual([]);
    expect(dataset.prioridade).toEqual([]);
    expect(dataset.titulo).toBe("");
    expect(dataset.solicitantes).toEqual([]);
    expect(dataset.nrOs).toBeUndefined();
    expect(dataset.exactOsLookup).toBe(false);
    expect(dataset.includeOs).toBe(true);
    expect(dataset.includeSp).toBe(true);
    expect(dataset.sortBy).toBe("ano");
    expect(dataset.sortDir).toBe("asc");
    expect(dataset.anos).toEqual([2026]);
  });

  it("preserva produtos e processo no conjunto", () => {
    const dataset = toOsHomeDatasetFilters({
      ...baseFilters,
      produtos: ["Cartaz"],
      processo: "12",
      situacao: ["Entregue"],
    });
    expect(dataset.produtos).toEqual(["Cartaz"]);
    expect(dataset.processo).toBe("12");
    expect(dataset.situacao).toEqual([]);
  });

  it("mantém situação quando não há ano", () => {
    const dataset = toOsHomeDatasetFilters({
      ...baseFilters,
      anos: [],
      situacao: ["Em Execução"],
    });
    expect(dataset.situacao).toEqual(["Em Execução"]);
  });
});

describe("osHomeDatasetQueryKey", () => {
  it("não muda a chave quando só a situação muda (com ano)", () => {
    const a = osHomeDatasetQueryKey({
      ...baseFilters,
      situacao: ["Em Andamento"],
      setor: ["Arte"],
    });
    const b = osHomeDatasetQueryKey({
      ...baseFilters,
      situacao: ["Entregue"],
      setor: ["SEFOC"],
      sortBy: "situacao",
    });
    expect(a).toEqual(b);
  });

  it("muda a chave quando o ano muda", () => {
    const a = osHomeDatasetQueryKey(baseFilters);
    const b = osHomeDatasetQueryKey({ ...baseFilters, anos: [2025] });
    expect(a).not.toEqual(b);
  });

  it("sem ano, situação entra na chave do servidor", () => {
    const a = osSearchQueryKey(
      toOsHomeDatasetFilters({
        ...baseFilters,
        anos: [],
        situacao: ["Em Andamento"],
      }),
    );
    const b = osSearchQueryKey(
      toOsHomeDatasetFilters({
        ...baseFilters,
        anos: [],
        situacao: ["Entregue"],
      }),
    );
    expect(a).not.toEqual(b);
  });
});

describe("osHomePatchTriggersFetch", () => {
  it("não dispara GET ao mudar situação com ano", () => {
    expect(
      osHomePatchTriggersFetch({ situacao: ["Em Execução"] }, baseFilters),
    ).toBe(false);
    expect(
      osHomePatchTriggersFetch({ setor: ["Arte"], page: 1 }, baseFilters),
    ).toBe(false);
    expect(
      osHomePatchTriggersFetch({ sortBy: "situacao", sortDir: "asc" }, baseFilters),
    ).toBe(false);
  });

  it("não dispara GET quando o patch só muda visão com o mesmo ano", () => {
    expect(
      osHomePatchTriggersFetch(
        { anos: [2026], situacao: ["Em Execução"], setor: ["Arte"] },
        baseFilters,
      ),
    ).toBe(false);
  });

  it("dispara GET ao mudar ano ou produto", () => {
    expect(osHomePatchTriggersFetch({ anos: [2025] }, baseFilters)).toBe(true);
    expect(osHomePatchTriggersFetch({ produtos: ["Cartaz"] }, baseFilters)).toBe(
      true,
    );
  });

  it("dispara GET ao mudar situação sem ano", () => {
    expect(
      osHomePatchTriggersFetch(
        { situacao: ["Em Execução"] },
        { ...baseFilters, anos: [] },
      ),
    ).toBe(true);
  });
});

describe("applyOsHomeViewFilters", () => {
  const rows: OsSearchRow[] = [
    row({
      nr_os: 10,
      ano: 2026,
      situacao: "Em Execução",
      setor: "SEFOC",
      prioridade: "Normal",
      titulo: "Cartaz sessão",
      solicitante: "Gabinete A",
    }),
    row({
      nr_os: 11,
      ano: 2026,
      situacao: "Entregue",
      setor: "Arte",
      prioridade: "Solicitado p/",
      titulo: "Folder",
      solicitante: "Gabinete B",
    }),
    row({
      nr_os: 12,
      ano: 2026,
      kind: "sub_os",
      is_sub_os: true,
      sub_os_id: 1,
      situacao: "Em Execução",
      setor: "Arte",
      titulo: "Miolo",
      solicitante: "Gabinete A",
    }),
    row({ nr_os: 5001, ano: 2026, situacao: "Em Execução", setor: "SEFOC" }),
  ];

  it("filtra situação e setor na linha visível, inclusive Sub OS", () => {
    const filtered = applyOsHomeViewFilters(rows, {
      ...baseFilters,
      situacao: ["Em Execução"],
      setor: ["Arte"],
    });
    expect(filtered.map((r) => r.nr_os)).toEqual([12]);
    expect(filtered[0]?.is_sub_os).toBe(true);
  });

  it("não filtra título curto sem âncora", () => {
    const filtered = applyOsHomeViewFilters(rows, {
      ...baseFilters,
      titulo: "ca",
    });
    expect(filtered).toHaveLength(rows.length);
  });

  it("filtra título por contains", () => {
    const filtered = applyOsHomeViewFilters(rows, {
      ...baseFilters,
      titulo: "cartaz",
    });
    expect(filtered.map((r) => r.nr_os)).toEqual([10]);
  });

  it("filtra Nr OS no ano", () => {
    const filtered = applyOsHomeViewFilters(rows, {
      ...baseFilters,
      nrOs: 11,
    });
    expect(filtered.map((r) => r.nr_os)).toEqual([11]);
  });

  it("respeita includeOs / includeSp", () => {
    const onlySp = applyOsHomeViewFilters(rows, {
      ...baseFilters,
      includeOs: false,
      includeSp: true,
    });
    expect(onlySp.map((r) => r.nr_os)).toEqual([5001]);
  });

  it("sem ano, não filtra no cliente", () => {
    const filtered = applyOsHomeViewFilters(rows, {
      ...baseFilters,
      anos: [],
      situacao: ["Em Execução"],
    });
    expect(filtered).toHaveLength(rows.length);
  });
});

describe("countUniqueOsProtocols", () => {
  it("não conta linhas de componente como OP extra", () => {
    const rows: OsSearchRow[] = [
      row({ nr_os: 10, ano: 2026, kind: "main_os" }),
      row({
        nr_os: 10,
        ano: 2026,
        kind: "sub_os",
        is_sub_os: true,
        sub_os_id: 1,
      }),
      row({
        nr_os: 10,
        ano: 2026,
        kind: "sub_os",
        is_sub_os: true,
        sub_os_id: 2,
      }),
      row({ nr_os: 11, ano: 2026 }),
    ];
    expect(countUniqueOsProtocols(rows)).toBe(2);
  });
});

describe("sortOsHomeViewRows", () => {
  it("ordena ano crescente com nr_os no mesmo sentido", () => {
    const sorted = sortOsHomeViewRows(
      [
        row({ nr_os: 20, ano: 2026 }),
        row({ nr_os: 10, ano: 2025 }),
        row({ nr_os: 5, ano: 2026 }),
      ],
      { sortBy: "ano", sortDir: "asc" },
    );
    expect(sorted.map((r) => `${r.ano}-${r.nr_os}`)).toEqual([
      "2025-10",
      "2026-5",
      "2026-20",
    ]);
  });

  it("ordena situação com desempate ano/número", () => {
    const sorted = sortOsHomeViewRows(
      [
        row({ nr_os: 2, ano: 2026, situacao: "Beta" }),
        row({ nr_os: 1, ano: 2026, situacao: "Alfa" }),
        row({ nr_os: 3, ano: 2026, situacao: "Alfa" }),
      ],
      { sortBy: "situacao", sortDir: "asc" },
    );
    expect(sorted.map((r) => r.nr_os)).toEqual([3, 1, 2]);
  });
});

describe("applyOsHomeLocalView", () => {
  it("filtra, ordena e conta OPs únicas", () => {
    const result = applyOsHomeLocalView(
      [
        row({
          nr_os: 20,
          ano: 2026,
          situacao: "Em Execução",
          setor: "SEFOC",
        }),
        row({
          nr_os: 10,
          ano: 2026,
          situacao: "Em Execução",
          setor: "SEFOC",
          kind: "sub_os",
          is_sub_os: true,
          sub_os_id: 1,
        }),
        row({
          nr_os: 10,
          ano: 2026,
          situacao: "Entregue",
          setor: "Arte",
        }),
      ],
      {
        ...baseFilters,
        situacao: ["Em Execução"],
        sortBy: "ano",
        sortDir: "asc",
      },
    );
    expect(result.rows.map((r) => r.nr_os)).toEqual([10, 20]);
    expect(result.totalRecords).toBe(2);
  });
});
