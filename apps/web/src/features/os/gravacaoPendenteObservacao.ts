import type { HistoryPayload } from "../types";

export function mergeGravacaoPendenteObservacoes(
  homeObs: string,
  biroObs: string,
): string {
  const homeText = homeObs.trim();
  const biroText = biroObs.trim();
  return [
    homeText,
    biroText ? `Observação para o Birô:\n${biroText}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function buildGravacaoPendenteObservacaoPayload(
  homeObs: string,
  biroObs: string,
): Pick<HistoryPayload, "obs" | "gravacao_pendente_observacao_biro"> {
  return {
    obs: mergeGravacaoPendenteObservacoes(homeObs, biroObs),
    gravacao_pendente_observacao_biro: biroObs.trim(),
  };
}
