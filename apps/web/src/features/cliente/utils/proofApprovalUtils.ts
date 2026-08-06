import type { ClienteOsItem, ClienteTimelineStep } from "@/api/cliente-portal";

import type { SectionKind } from "../types/clienteProgress";

export const PROOF_VIEW_LABEL = "Visualizar prova";

export const PROOF_APPROVED_MESSAGE = "Prova aprovada e enviada ao setor responsável";

const PROOF_SITUACOES = new Set(["Aguard. Aprovação", "Aguardando Aprovação"]);

function normalizeText(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

/** Indica se a OS está aguardando aprovação de prova pelo cliente. */
export function isProofApprovalPending(
  item: Pick<ClienteOsItem, "pendencia_tipo" | "situacao" | "observacao">,
  sectionKind?: SectionKind,
): boolean {
  if (item.pendencia_tipo === "aprovacao_prova") return true;
  if (sectionKind === "pendencias_aprovacao") return true;
  if (PROOF_SITUACOES.has(String(item.situacao ?? "").trim())) return true;
  const obs = normalizeText(item.observacao);
  return obs.includes("prova") && obs.includes("aprova");
}

/** Indica mensagem informativa de prova já aprovada (sem ação do cliente). */
export function isProofApprovedTimelineMessage(
  step: Pick<ClienteTimelineStep, "pendencia_mensagem">,
): boolean {
  return normalizeText(step.pendencia_mensagem).includes(
    normalizeText(PROOF_APPROVED_MESSAGE),
  );
}

/** Indica se o andamento da timeline corresponde à pendência de prova/aprovação. */
export function isProofTimelineMovement(step: ClienteTimelineStep): boolean {
  if (isProofApprovedTimelineMessage(step)) return false;
  if (step.pendencia_tipo === "aprovacao_prova") return true;

  const situacao = String(step.situacao ?? "").trim();
  if (PROOF_SITUACOES.has(situacao)) return true;

  const label = normalizeText(step.pendencia_label);
  if (
    label.includes("visualizar prova") ||
    label.includes("analisar prova") ||
    label.includes("aprovação") ||
    label.includes("aprovacao")
  ) {
    return true;
  }

  const mensagem = normalizeText(step.pendencia_mensagem);
  if (mensagem.includes("aguardando aprovação") || mensagem.includes("aprovação do cliente")) {
    return true;
  }

  return false;
}

export function getProofApprovalRoute(ano: number, nrOs: number) {
  return {
    to: "/cliente/os/$ano/$nrOs/prova" as const,
    params: { ano: String(ano), nrOs: String(nrOs) },
  };
}
