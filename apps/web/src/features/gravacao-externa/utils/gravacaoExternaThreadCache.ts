import type { QueryClient } from "@tanstack/react-query";

import type {
  GravacaoExternaDetail,
  GravacaoExternaMensagem,
} from "@/api/gravacaoExterna";
import { queryKeys } from "@/api/query-keys";

export type MergeGravacaoMessageResult = "appended" | "duplicate" | "cache_miss";

function normalizeGravacaoMensagem(
  raw: GravacaoExternaMensagem | Record<string, unknown>,
): GravacaoExternaMensagem | null {
  const id = raw.id ?? (raw as Record<string, unknown>).Id;
  const mensagem = raw.mensagem ?? (raw as Record<string, unknown>).Mensagem;
  if (id == null || mensagem == null) {
    return null;
  }
  return {
    id: Number(id),
    autor_ponto: String(
      raw.autor_ponto ?? (raw as Record<string, unknown>).AutorPonto ?? "",
    ),
    autor_nome:
      (raw.autor_nome ?? (raw as Record<string, unknown>).AutorNome ?? null) as
        | string
        | null,
    autor_papel: String(
      raw.autor_papel ?? (raw as Record<string, unknown>).AutorPapel ?? "",
    ),
    mensagem: String(mensagem),
    criado_em:
      (raw.criado_em ?? (raw as Record<string, unknown>).CriadoEm ?? null) as
        | string
        | null,
  };
}

export function mergeGravacaoMensagemIntoDetail(
  old: GravacaoExternaDetail | undefined,
  message: GravacaoExternaMensagem,
): { detail: GravacaoExternaDetail | undefined; result: MergeGravacaoMessageResult } {
  if (!old) {
    return { detail: old, result: "cache_miss" };
  }
  const thread = old.mensagens ?? [];
  if (thread.some((item) => item.id === message.id)) {
    return { detail: old, result: "duplicate" };
  }
  return {
    detail: {
      ...old,
      mensagens: [...thread, message],
    },
    result: "appended",
  };
}

export function applyGravacaoMensagemToCache(
  qc: QueryClient,
  ano: number,
  nrOs: number,
  rawMessage: GravacaoExternaMensagem | Record<string, unknown>,
  gravacaoExternaId?: number | null,
): MergeGravacaoMessageResult {
  const message = normalizeGravacaoMensagem(rawMessage);
  if (!message) {
    return "cache_miss";
  }

  const detailKey = queryKeys.gravacaoExterna.detail(ano, nrOs, gravacaoExternaId);
  let result: MergeGravacaoMessageResult = "cache_miss";
  qc.setQueryData<GravacaoExternaDetail | undefined>(detailKey, (old) => {
    const merged = mergeGravacaoMensagemIntoDetail(old, message);
    result = merged.result;
    return merged.detail ?? old;
  });

  if (result === "cache_miss") {
    void qc.refetchQueries({ queryKey: detailKey });
  }
  return result;
}
