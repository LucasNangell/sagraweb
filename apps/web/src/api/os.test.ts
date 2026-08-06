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
});

describe("buildOsExportQueryString", () => {
  it("remove parâmetros de paginação", () => {
    const qs = buildOsExportQueryString(base);
    expect(qs).not.toContain("page=");
    expect(qs).not.toContain("limit=");
    expect(qs).not.toContain("simple_pagination=");
    expect(qs).not.toContain("include_total=");
    expect(qs).toContain("anos=2025");
  });
});
