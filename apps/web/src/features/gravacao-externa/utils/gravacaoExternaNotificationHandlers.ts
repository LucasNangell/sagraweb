import type { QueryClient } from "@tanstack/react-query";



import { queryKeys } from "@/api/query-keys";

import { matchesViewingGravacaoExternaOs } from "@/features/gravacao-externa/gravacaoExternaUiStore";



import { applyGravacaoMensagemToCache } from "./gravacaoExternaThreadCache";



export interface GravacaoExternaWsPayload {

  type?: string;

  action?: string;

  situacao?: string;

  gravacao_externa_id?: number;

  os_ano?: number;

  os_nro?: number;

  lancado_por_ponto?: string;

  status?: string;

  message?: Record<string, unknown>;

  id?: number;

  ano?: number;

  gravacao_message_id?: number;

  message_id?: number;

}



export function sameGravacaoOs(

  aAno: number | null | undefined,

  aNro: number | null | undefined,

  bAno: number | null | undefined,

  bNro: number | null | undefined,

): boolean {

  if (aAno == null || aNro == null || bAno == null || bNro == null) {

    return false;

  }

  return Number(aAno) === Number(bAno) && Number(aNro) === Number(bNro);

}



export function extractGravacaoOsFromWs(

  data: GravacaoExternaWsPayload,

): { ano: number; nrOs: number } | null {

  const ano = data.os_ano ?? data.ano ?? null;

  const nrOs = data.os_nro ?? data.id ?? null;

  if (ano == null || nrOs == null) {

    return null;

  }

  return { ano: Number(ano), nrOs: Number(nrOs) };

}



export async function refreshGravacaoExternaDetail(

  qc: QueryClient,

  ano: number,

  nrOs: number,

  rawMessage?: Record<string, unknown>,

  gravacaoExternaId?: number | null,

): Promise<void> {

  if (gravacaoExternaId != null) {
    // Telas sem id (chat do lançador na OS) usam o detalhe padrão da OS; a mensagem
    // pode ser de outro envio, então só o servidor sabe se ela pertence a esse cache.
    void qc.refetchQueries({
      queryKey: queryKeys.gravacaoExterna.detail(ano, nrOs, null),
      exact: true,
      type: "active",
    });
  }

  if (rawMessage) {

    const result = applyGravacaoMensagemToCache(
      qc,
      ano,
      nrOs,
      rawMessage,
      gravacaoExternaId,
    );

    if (import.meta.env.DEV) {

      console.info("[gravacao-ws] cache merge", result, { ano, nrOs });

    }

    if (result === "appended" || result === "duplicate") {

      return;

    }

  }



  await qc.refetchQueries({

    queryKey: queryKeys.gravacaoExterna.detail(ano, nrOs, gravacaoExternaId),

    type: "all",

  });

}



export async function handleGravacaoExternaMensagemWs(

  qc: QueryClient,

  data: GravacaoExternaWsPayload,

  scope?: {

    ano?: number | null;

    nrOs?: number | null;

    /** Atualiza o cache mesmo sem conversa aberta (ex.: notification_new no handler global). */

    forceRefresh?: boolean;

  },

): Promise<void> {

  const msgType = data.type ?? "";



  if (msgType === "gravacao_externa_message") {

    const os = extractGravacaoOsFromWs(data);

    if (!os) {

      return;

    }

    if (

      !scope?.forceRefresh &&

      scope?.ano != null &&

      scope?.nrOs != null &&

      !sameGravacaoOs(scope.ano, scope.nrOs, os.ano, os.nrOs)

    ) {

      return;

    }

    await refreshGravacaoExternaDetail(
      qc,
      os.ano,
      os.nrOs,
      data.message,
      data.gravacao_externa_id,
    );

    return;

  }



  if (msgType === "notification_new" && data.action === "gravacao_externa_mensagem") {

    const os = extractGravacaoOsFromWs(data);

    if (!os) {

      return;

    }

    const viewing = matchesViewingGravacaoExternaOs(os.ano, os.nrOs);

    const inScope =

      scope?.ano != null &&

      scope?.nrOs != null &&

      sameGravacaoOs(scope.ano, scope.nrOs, os.ano, os.nrOs);

    if (!scope?.forceRefresh && !viewing && !inScope) {

      return;

    }

    // Sem body: gravacao_externa_message fará o merge; evita refetch concorrente.

    if (!data.message) {

      if (viewing || inScope) {

        return;

      }

      await qc.invalidateQueries({

        queryKey: queryKeys.gravacaoExterna.detail(
          os.ano,
          os.nrOs,
          data.gravacao_externa_id,
        ),

      });

      return;

    }

    await refreshGravacaoExternaDetail(
      qc,
      os.ano,
      os.nrOs,
      data.message,
      data.gravacao_externa_id,
    );

  }

}

