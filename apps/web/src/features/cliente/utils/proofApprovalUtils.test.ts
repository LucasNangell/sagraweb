import { describe, expect, it } from "vitest";

import type { ClienteOsItem, ClienteTimelineStep } from "@/api/cliente-portal";

import {
  getProofApprovalRoute,
  isProofApprovalPending,
  isProofApprovedTimelineMessage,
  isProofTimelineMovement,
  PROOF_APPROVED_MESSAGE,
  PROOF_VIEW_LABEL,
} from "./proofApprovalUtils";

function osItem(overrides: Partial<ClienteOsItem> = {}): ClienteOsItem {
  return {
    nr_os: 123,
    ano: 2026,
    titulo: "Título",
    produto: "Produto",
    situacao: "Em Execução",
    setor: "SEFOC",
    ...overrides,
  };
}

function timelineStep(overrides: Partial<ClienteTimelineStep> = {}): ClienteTimelineStep {
  return {
    ordem: 1,
    situacao: "Em Execução",
    setor: "SEFOC",
    concluido: false,
    ...overrides,
  };
}

describe("isProofApprovalPending", () => {
  it("detecta pendencia_tipo aprovacao_prova", () => {
    expect(isProofApprovalPending(osItem({ pendencia_tipo: "aprovacao_prova" }))).toBe(true);
  });

  it("detecta seção Aguardando Aprovação", () => {
    expect(isProofApprovalPending(osItem(), "pendencias_aprovacao")).toBe(true);
  });

  it("detecta situação Aguard. Aprovação", () => {
    expect(isProofApprovalPending(osItem({ situacao: "Aguard. Aprovação" }))).toBe(true);
  });

  it("retorna false fora de aprovação", () => {
    expect(isProofApprovalPending(osItem({ situacao: "Em Execução" }), "em_andamento")).toBe(
      false,
    );
  });
});

describe("isProofTimelineMovement", () => {
  it("detecta pendencia_tipo aprovacao_prova", () => {
    expect(
      isProofTimelineMovement(timelineStep({ pendencia_tipo: "aprovacao_prova" })),
    ).toBe(true);
  });

  it("detecta label Visualizar prova", () => {
    expect(
      isProofTimelineMovement(
        timelineStep({ pendencia_label: PROOF_VIEW_LABEL, pendencia_tipo: "aprovacao_prova" }),
      ),
    ).toBe(true);
  });

  it("ignora andamentos sem relação com prova", () => {
    expect(
      isProofTimelineMovement(
        timelineStep({ pendencia_tipo: "problema_tecnico", pendencia_label: "Ver PT" }),
      ),
    ).toBe(false);
  });

  it("não trata mensagem de prova aprovada como pendência ativa", () => {
    expect(
      isProofTimelineMovement(
        timelineStep({ pendencia_mensagem: PROOF_APPROVED_MESSAGE }),
      ),
    ).toBe(false);
    expect(
      isProofApprovedTimelineMessage(
        timelineStep({ pendencia_mensagem: PROOF_APPROVED_MESSAGE }),
      ),
    ).toBe(true);
  });
});

describe("getProofApprovalRoute", () => {
  it("monta rota autenticada da prova", () => {
    expect(getProofApprovalRoute(2026, 99)).toEqual({
      to: "/cliente/os/$ano/$nrOs/prova",
      params: { ano: "2026", nrOs: "99" },
    });
  });
});
