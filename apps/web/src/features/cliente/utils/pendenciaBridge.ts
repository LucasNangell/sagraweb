import type { ClienteOsItem } from "@/api/cliente-portal";

import { PROOF_VIEW_LABEL } from "./proofApprovalUtils";

export type PortalLinkType = "pt" | "aprovacao" | "arquivos";

export interface ParsedPortalLink {
  type: PortalLinkType;
  token: string;
  os: number;
  ano: number;
}

/** Extrai token e parâmetros de URLs geradas pelo backend. */
export function parsePortalLinkFromUrl(url: string): ParsedPortalLink | null {
  if (!url?.trim()) return null;
  try {
    const parsed = new URL(url, window.location.origin);
    const pathname = parsed.pathname;

    const ptMatch = pathname.match(/\/portal\/pt\/([^/]+)/);
    if (ptMatch) {
      return {
        type: "pt",
        token: decodeURIComponent(ptMatch[1]),
        os: Number(parsed.searchParams.get("os")) || 0,
        ano: Number(parsed.searchParams.get("ano")) || 0,
      };
    }

    const aprovMatch = pathname.match(/\/portal\/aprovacao\/([^/]+)/);
    if (aprovMatch) {
      return {
        type: "aprovacao",
        token: decodeURIComponent(aprovMatch[1]),
        os: Number(parsed.searchParams.get("os")) || 0,
        ano: Number(parsed.searchParams.get("ano")) || 0,
      };
    }

    const arqMatch = pathname.match(/\/portal\/os-arquivos\/([^/]+)/);
    if (arqMatch) {
      return {
        type: "arquivos",
        token: decodeURIComponent(arqMatch[1]),
        os: Number(parsed.searchParams.get("os")) || 0,
        ano: Number(parsed.searchParams.get("ano")) || 0,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function getClienteOsActionPath(item: ClienteOsItem): string | null {
  switch (item.pendencia_tipo) {
    case "problema_tecnico":
      return "/cliente/os/$ano/$nrOs/problemas-tecnicos";
    case "aprovacao_prova":
      return "/cliente/os/$ano/$nrOs/prova";
    case "envio_arquivo":
      return "/cliente/os/$ano/$nrOs/arquivos";
    default:
      return null;
  }
}

export function getClienteOsActionParams(item: ClienteOsItem) {
  return { ano: String(item.ano), nrOs: String(item.nr_os) };
}

export function getClienteOsActionLabel(
  pendenciaTipo: string | null | undefined,
): string {
  switch (pendenciaTipo) {
    case "problema_tecnico":
      return "Ver problemas técnicos";
    case "aprovacao_prova":
      return PROOF_VIEW_LABEL;
    case "envio_arquivo":
      return "Enviar arquivos";
    default:
      return "Ver pendência";
  }
}

export function findOsInDashboard(
  data: {
    pendencias_pt: ClienteOsItem[];
    pendencias_aprovacao: ClienteOsItem[];
    pendencias_envio_arquivo: ClienteOsItem[];
    pendencias_usuario?: ClienteOsItem[];
    em_andamento: ClienteOsItem[];
  },
  ano: number,
  nrOs: number,
): ClienteOsItem | null {
  const all = [
    ...data.pendencias_pt,
    ...data.pendencias_aprovacao,
    ...data.pendencias_envio_arquivo,
    ...(data.pendencias_usuario ?? []),
    ...data.em_andamento,
  ];
  return all.find((i) => i.ano === ano && i.nr_os === nrOs) ?? null;
}
