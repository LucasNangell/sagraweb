import { describe, expect, it } from "vitest";

import { buildOsExportQueryString, buildOsSearchQueryString } from "./os";
import type { OsSearchFilters } from "@/features/os/types";

const base: OsSearchFilters = {
  nrOs: undefined,
  anos: [2025],
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
};

describe("buildOsSearchQueryString", () => {
  it("envia anos múltiplos sem ano_mode", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      anos: [2025, 2026],
    });
    expect(qs).toContain("anos=2025");
    expect(qs).toContain("anos=2026");
    expect(qs).not.toContain("ano=");
    expect(qs).not.toContain("ano_mode=");
  });

  it("mantém ano_mode legado quando só ano está preenchido", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      anos: [],
      ano: 2025,
      anoMode: "from",
    });
    expect(qs).toContain("ano=2025");
    expect(qs).toContain("ano_mode=from");
  });

  it("envia produtos múltiplos", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      produtos: ["A", "B"],
    });
    expect(qs).toContain("produtos=A");
    expect(qs).toContain("produtos=B");
    expect(qs).not.toContain("produto=");
  });

  it("envia processo, categorias e maquinas", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      processo: "12.345.678/9012",
      categorias: ["Deputado"],
      maquinas: ["A1"],
    });
    expect(qs).toContain("processo=123456789012");
    expect(qs).not.toContain("processo=12.345");
    expect(qs).toContain("categorias=Deputado");
    expect(qs).toContain("maquinas=A1");
  });

  it("mantém produto legado quando array vazio", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      produto: "Folder",
    });
    expect(qs).toContain("produto=Folder");
  });

  it("omite include_total no lookup exato por Nr OS", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      nrOs: 2244,
      exactOsLookup: true,
    });
    expect(qs).toContain("nr_os=2244");
    expect(qs).toContain("exact_os_lookup=true");
    expect(qs).not.toContain("include_total=true");
  });

  it("envia fetch_all na busca da home e mantém include_total", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      fetchAll: true,
      sortBy: "ano",
      sortDir: "asc",
    });
    expect(qs).toContain("fetch_all=true");
    expect(qs).toContain("include_total=true");
    expect(qs).toContain("sort_by=ano");
    expect(qs).toContain("sort_dir=asc");
  });

  it("envia a fila sorts e omite quando vazia", () => {
    const withSorts = buildOsSearchQueryString({
      ...base,
      sorts: [
        { column: "ano", dir: "desc" },
        { column: "nr_os", dir: "asc" },
      ],
      sortBy: "ano",
      sortDir: "desc",
    });
    expect(withSorts).toContain("sorts=ano%3Adesc");
    expect(withSorts).toContain("sorts=nr_os%3Aasc");

    const empty = buildOsSearchQueryString({
      ...base,
      sorts: [],
      sortBy: undefined,
      sortDir: undefined,
    });
    expect(empty).not.toContain("sorts=");
    expect(empty).not.toContain("sort_by=");
  });

  it("não envia fetch_all no preview de relatório", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      limit: 1,
    });
    expect(qs).not.toContain("fetch_all=");
    expect(qs).toContain("limit=1");
  });

  it("envia filtros avançados", () => {
    const qs = buildOsSearchQueryString({
      ...base,
      formatos: ["A4", "A5"],
      papel: "couché",
      cores: "4x4",
      acabamento: "laminação",
      observacao: "miolo",
      dataEntradaDe: "2026-01-10",
      dataEntradaAte: "2026-02-20",
    });
    expect(qs).toContain("formatos=A4");
    expect(qs).toContain("formatos=A5");
    expect(qs).toContain("papel=couch");
    expect(qs).toContain("cores=4x4");
    expect(qs).toContain("acabamento=");
    expect(qs).toContain("observacao=miolo");
    expect(qs).toContain("data_entrada_de=2026-01-10");
    expect(qs).toContain("data_entrada_ate=2026-02-20");
  });
});

describe("buildOsExportQueryString", () => {
  it("remove parâmetros de paginação", () => {
    const qs = buildOsExportQueryString({ ...base, fetchAll: true });
    expect(qs).not.toContain("page=");
    expect(qs).not.toContain("limit=");
    expect(qs).not.toContain("simple_pagination=");
    expect(qs).not.toContain("include_total=");
    expect(qs).not.toContain("fetch_all=");
    expect(qs).toContain("anos=2025");
  });
});
