import { useMemo } from "react";

import type {
  ClienteDashboardResponse,
  ClienteOsItem,
  ClienteUser,
} from "@/api/cliente-portal";
import { formatRelativeTimeBr } from "@/lib/format";

export interface ClienteDashboardStats {
  totalOs: number;
  pendenciasTotal: number;
  problemasTecnicos: number;
  aguardandoAprovacao: number;
  aguardandoArquivos: number;
  emAndamento: number;
  lastDataAndamento: string | null;
  lastUpdatedLabel: string;
}

function maxDataAndamento(items: ClienteOsItem[]): string | null {
  let max: string | null = null;
  let maxTime = -Infinity;
  for (const item of items) {
    const raw = item.data_andamento;
    if (!raw) continue;
    const t = new Date(raw).getTime();
    if (!Number.isNaN(t) && t > maxTime) {
      maxTime = t;
      max = raw;
    }
  }
  return max;
}

function collectAllItems(data: ClienteDashboardResponse): ClienteOsItem[] {
  return [
    ...data.pendencias_pt,
    ...data.pendencias_aprovacao,
    ...data.pendencias_envio_arquivo,
    ...data.em_andamento,
  ];
}

export function useClienteDashboardStats(
  data: ClienteDashboardResponse | undefined,
  dataUpdatedAt: number | undefined,
): ClienteDashboardStats {
  return useMemo(() => {
    const pt = data?.pendencias_pt.length ?? 0;
    const aprov = data?.pendencias_aprovacao.length ?? 0;
    const arq = data?.pendencias_envio_arquivo.length ?? 0;
    const and = data?.em_andamento.length ?? 0;
    const total = pt + aprov + arq + and;

    const lastFromItems = data ? maxDataAndamento(collectAllItems(data)) : null;
    const syncDate =
      dataUpdatedAt != null && dataUpdatedAt > 0
        ? new Date(dataUpdatedAt)
        : lastFromItems
          ? new Date(lastFromItems)
          : null;

    const lastUpdatedLabel = syncDate
      ? formatRelativeTimeBr(syncDate)
      : "";

    return {
      totalOs: total,
      pendenciasTotal: pt + aprov + arq,
      problemasTecnicos: pt,
      aguardandoAprovacao: aprov,
      aguardandoArquivos: arq,
      emAndamento: and,
      lastDataAndamento: lastFromItems,
      lastUpdatedLabel,
    };
  }, [data, dataUpdatedAt]);
}

export interface VinculoDisplayInfo {
  primaryLabel: string;
  secondaryLabel: string;
  tipoLabel: string;
}

export interface ClienteContextBarInfo {
  solicitante: string;
  deputadoOuOrgaoLabel: string;
  deputadoOuOrgao: string;
  gabineteLabel: string;
  gabinete: string;
  usuarioNome: string;
  usuarioEmail: string;
  isPrincipal: boolean;
}

/** Dados da barra contextual abaixo do header — destaque no solicitante. */
export function resolveClienteContextBar(
  data: ClienteDashboardResponse | undefined,
  user: ClienteUser | null | undefined,
): ClienteContextBarInfo {
  const tipoConta = data?.tipo_conta ?? user?.tipo_conta ?? "gabinete";
  const isOrgao = tipoConta === "orgao";
  const vinculo = (data?.gabinete || user?.gabinete || "").trim();
  const solicitante =
    (data?.solicitante || "").trim() ||
    (isOrgao ? vinculo : "") ||
    vinculo ||
    "—";
  const deputadoOuOrgao =
    (data?.deputado_ou_orgao || "").trim() || vinculo || "—";

  return {
    solicitante,
    deputadoOuOrgaoLabel: isOrgao ? "Órgão" : "Deputado",
    deputadoOuOrgao,
    gabineteLabel: isOrgao ? "Unidade" : "Gabinete",
    gabinete: vinculo || "—",
    usuarioNome: user?.nome?.trim() || "—",
    usuarioEmail: user?.email?.trim() || "",
    isPrincipal: Boolean(user?.is_principal),
  };
}

/** Fallback seguro para identificação do gabinete/órgão no cabeçalho. */
export function resolveVinculoDisplay(
  data: ClienteDashboardResponse | undefined,
  user: ClienteUser | null | undefined,
): VinculoDisplayInfo {
  const tipo =
    data?.vinculo_label ||
    (user?.tipo_conta === "orgao" ? "Órgão" : "Gabinete");
  const vinculo = (data?.gabinete || user?.gabinete || "").trim();

  const sampleTitulo = data
    ? [
        ...data.pendencias_pt,
        ...data.pendencias_aprovacao,
        ...data.pendencias_envio_arquivo,
        ...data.em_andamento,
      ].find((i) => i.titulo?.trim())?.titulo?.trim()
    : undefined;

  let primaryLabel: string;
  if (vinculo) {
    primaryLabel = `${tipo} ${vinculo}`;
  } else if (sampleTitulo) {
    primaryLabel = sampleTitulo;
  } else {
    primaryLabel = tipo;
  }

  const secondaryLabel = sampleTitulo && vinculo ? sampleTitulo : "";

  return {
    primaryLabel,
    secondaryLabel,
    tipoLabel: tipo,
  };
}
