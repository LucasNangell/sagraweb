import { apiFetch } from "@/lib/api";

import type {
  GravacaoBoardResponse,
  GravacaoLancarPayload,
  GravacaoLancarResponse,
} from "./types";

export function fetchPainelGravacaoBoard(): Promise<GravacaoBoardResponse> {
  return apiFetch<GravacaoBoardResponse>("/painel/gravacao");
}

export function lancarPainelGravacao(
  ano: number,
  nrOs: number,
  payload: GravacaoLancarPayload,
): Promise<GravacaoLancarResponse> {
  return apiFetch<GravacaoLancarResponse>(`/painel/gravacao/${ano}/${nrOs}/lancar`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}
