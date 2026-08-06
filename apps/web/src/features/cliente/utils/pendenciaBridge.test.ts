import { describe, expect, it } from "vitest";

import type { ClienteDashboardResponse, ClienteOsItem } from "@/api/cliente-portal";

import {
  findOsInDashboard,
  getClienteOsActionLabel,
  getClienteOsActionParams,
  getClienteOsActionPath,
  parsePortalLinkFromUrl,
} from "./pendenciaBridge";

function osItem(overrides: Partial<ClienteOsItem> = {}): ClienteOsItem {
  return {
    nr_os: 123,
    ano: 2026,
    titulo: "Título",
    produto: "Produto",
    situacao: "Pendente",
    setor: "Gráfica",
    ...overrides,
  };
}

function emptyDashboard(): ClienteDashboardResponse {
  return {
    gabinete: "214",
    tipo_conta: "gabinete",
    vinculo_label: "Gabinete",
    em_andamento: [],
    pendencias_pt: [],
    pendencias_aprovacao: [],
    pendencias_envio_arquivo: [],
    pendencias_usuario: [],
  };
}

describe("parsePortalLinkFromUrl", () => {
  it("extrai token PT com os e ano", () => {
    const parsed = parsePortalLinkFromUrl(
      "https://app.example/portal/pt/abc%2Btoken?os=123&ano=2026",
    );
    expect(parsed).toEqual({
      type: "pt",
      token: "abc+token",
      os: 123,
      ano: 2026,
    });
  });

  it("extrai token de aprovação", () => {
    const parsed = parsePortalLinkFromUrl("/portal/aprovacao/xyz?os=10&ano=2025");
    expect(parsed?.type).toBe("aprovacao");
    expect(parsed?.token).toBe("xyz");
  });

  it("retorna null para URL desconhecida", () => {
    expect(parsePortalLinkFromUrl("/outro/caminho")).toBeNull();
  });
});

describe("getClienteOsActionPath", () => {
  it("mapeia pendências para rotas autenticadas", () => {
    expect(getClienteOsActionPath(osItem({ pendencia_tipo: "problema_tecnico" }))).toBe(
      "/cliente/os/$ano/$nrOs/problemas-tecnicos",
    );
    expect(getClienteOsActionPath(osItem({ pendencia_tipo: "aprovacao_prova" }))).toBe(
      "/cliente/os/$ano/$nrOs/prova",
    );
    expect(getClienteOsActionPath(osItem({ pendencia_tipo: "envio_arquivo" }))).toBe(
      "/cliente/os/$ano/$nrOs/arquivos",
    );
  });

  it("retorna params stringificados", () => {
    expect(getClienteOsActionParams(osItem({ ano: 2026, nr_os: 99 }))).toEqual({
      ano: "2026",
      nrOs: "99",
    });
  });

  it("retorna labels amigáveis", () => {
    expect(getClienteOsActionLabel("problema_tecnico")).toBe("Ver problemas técnicos");
    expect(getClienteOsActionLabel("aprovacao_prova")).toBe("Visualizar prova");
  });
});

describe("findOsInDashboard", () => {
  it("localiza OS em qualquer lista", () => {
    const data = emptyDashboard();
    data.pendencias_aprovacao = [osItem({ nr_os: 50, ano: 2024 })];
    const found = findOsInDashboard(data, 2024, 50);
    expect(found?.nr_os).toBe(50);
  });
});
