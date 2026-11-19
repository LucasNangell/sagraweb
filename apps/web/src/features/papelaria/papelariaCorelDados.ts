import {
  iniciarComparacaoCorelPapelariaOs,
  resultadoComparacaoCorelPapelariaOs,
} from "@/api/papelaria";

import type { PapelariaCompararCorelResponse } from "./types";

export type CompararCorelDeps = {
  iniciar: typeof iniciarComparacaoCorelPapelariaOs;
  resultado: typeof resultadoComparacaoCorelPapelariaOs;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
};

const defaultDeps: CompararCorelDeps = {
  iniciar: iniciarComparacaoCorelPapelariaOs,
  resultado: resultadoComparacaoCorelPapelariaOs,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
};

export const COMPARAR_COREL_INTERVALO_MS = 1_500;
/** Worker pode estar ocupado com outra geração: espera razoável. */
export const COMPARAR_COREL_TIMEOUT_MS = 180_000;

/**
 * Lê (via worker) os textos do Corel da pasta e compara com o formulário.
 * Nunca lança: falhas viram ``status: "failed"`` para o usuário decidir.
 */
export async function compararDadosCorel(
  params: {
    ano: number;
    nro: number;
    modeloId: number;
    dados: Record<string, string>;
    signal?: AbortSignal;
  },
  deps: Partial<CompararCorelDeps> = {},
): Promise<PapelariaCompararCorelResponse> {
  const d = { ...defaultDeps, ...deps };
  const { ano, nro, modeloId, dados, signal } = params;
  try {
    const inicio = await d.iniciar(ano, nro, modeloId);
    if (inicio.status === "sem_corel" || !inicio.inspect_id) {
      return { status: "sem_corel" };
    }
    const arquivo = inicio.arquivo;
    const limite = d.now() + COMPARAR_COREL_TIMEOUT_MS;
    while (!signal?.aborted) {
      const res = await d.resultado(ano, nro, inicio.inspect_id, {
        modelo_id: modeloId,
        dados,
      });
      if (res.status === "completed" || res.status === "failed") {
        return { ...res, arquivo: res.arquivo || arquivo };
      }
      if (d.now() >= limite) {
        return {
          status: "failed",
          arquivo,
          erro: "O worker não leu o Corel a tempo (pode estar ocupado).",
        };
      }
      await d.sleep(COMPARAR_COREL_INTERVALO_MS);
    }
    return { status: "failed", arquivo, erro: "Leitura cancelada." };
  } catch (err) {
    return {
      status: "failed",
      erro: err instanceof Error ? err.message : "Falha ao ler o Corel da pasta.",
    };
  }
}
