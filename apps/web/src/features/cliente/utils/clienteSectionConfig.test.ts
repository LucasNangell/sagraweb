import { describe, expect, it } from "vitest";

import type { ClienteDashboardResponse } from "@/api/cliente-portal";

import { defaultOpenSection, CLIENTE_DASHBOARD_SECTIONS, CLIENTE_SECTIONS } from "./clienteSectionConfig";
import {
  resolveClienteContextBar,
  resolveVinculoDisplay,
} from "../hooks/useClienteDashboardStats";

function emptyDashboard(): ClienteDashboardResponse {
  return {
    gabinete: "214",
    tipo_conta: "gabinete",
    vinculo_label: "Gabinete",
    solicitante: "Dep. Exemplo",
    deputado_ou_orgao: "Dep. Exemplo",
    em_andamento: [],
    pendencias_pt: [],
    pendencias_aprovacao: [],
    pendencias_envio_arquivo: [],
    pendencias_usuario: [],
  };
}

describe("defaultOpenSection", () => {
  it("prioriza problemas técnicos", () => {
    const data = emptyDashboard();
    data.pendencias_pt = [{ nr_os: 1, ano: 2026, titulo: "T", produto: "P", situacao: "", setor: "" }];
    data.pendencias_aprovacao = [{ nr_os: 2, ano: 2026, titulo: "T", produto: "P", situacao: "", setor: "" }];
    expect(defaultOpenSection(data)).toBe("pendencias_pt");
  });

  it("retorna null sem pendências", () => {
    expect(defaultOpenSection(emptyDashboard())).toBeNull();
  });
});

describe("CLIENTE_DASHBOARD_SECTIONS", () => {
  it("exclui pendências usuário da visão geral", () => {
    expect(CLIENTE_SECTIONS.some((s) => s.kind === "pendencias_usuario")).toBe(true);
    expect(CLIENTE_DASHBOARD_SECTIONS.some((s) => s.kind === "pendencias_usuario")).toBe(
      false,
    );
  });
});

describe("resolveVinculoDisplay", () => {
  it("usa gabinete como identificação principal", () => {
    const info = resolveVinculoDisplay(emptyDashboard(), {
      id: 1,
      nome: "Maria",
      email: "m@test.com",
      gabinete: "214",
      tipo_conta: "gabinete",
      is_principal: true,
    });
    expect(info.primaryLabel).toBe("Gabinete 214");
  });

  it("não quebra sem dados", () => {
    const info = resolveVinculoDisplay(undefined, null);
    expect(info.primaryLabel).toBeTruthy();
  });
});

describe("resolveClienteContextBar", () => {
  it("destaca solicitante e mantém usuário como metadado", () => {
    const ctx = resolveClienteContextBar(emptyDashboard(), {
      id: 1,
      nome: "Maria Operadora",
      email: "m@test.com",
      gabinete: "214",
      tipo_conta: "gabinete",
      is_principal: true,
    });
    expect(ctx.solicitante).toBe("Dep. Exemplo");
    expect(ctx.usuarioNome).toBe("Maria Operadora");
    expect(ctx.solicitante).not.toBe(ctx.usuarioNome);
  });
});
