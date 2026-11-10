import { useQuery } from "@tanstack/react-query";

import type { PermissionKey } from "@/features/auth/types";
import { apiFetch } from "@/lib/api";

export type AccessPreviewOrigem = "local" | "internet";

export type AccessPreviewMode =
  | "master_remoto"
  | "conta_inativa"
  | "internet_usuario"
  | "internet_sem_permissoes"
  | "local_usuario"
  | "local_terminal"
  | "terminal_nao_autorizado";

export type AccessPermissionSource = "master" | "ip" | "user";

export interface AccessPreviewResponse {
  ponto: number;
  ip: string | null;
  origem: AccessPreviewOrigem;
  modo: AccessPreviewMode | "";
  descricao: string;
  acesso: boolean;
  usuario: {
    ponto: number;
    nome: string | null;
    conta_ativa: boolean;
    email_verificado: boolean;
    permissoes_proprias: boolean;
  } | null;
  terminal: {
    privilegiado: boolean;
    cadastro: {
      id: number;
      ip: string;
      descricao: string | null;
      grupo: string | null;
      curinga: boolean;
    } | null;
  } | null;
  permissoes: Record<PermissionKey, boolean> | null;
  painel_setores: string[];
  painel_setores_legacy_all: boolean;
  origem_por_chave: Partial<Record<PermissionKey, AccessPermissionSource>>;
  permissoes_terminal: Record<PermissionKey, boolean> | null;
  permissoes_usuario: Record<PermissionKey, boolean> | null;
}

export interface AccessOverviewResponse {
  usuarios: { total: number; online: number; conta_internet: number; ativacao_pendente: number };
  terminais: { total: number; ativos: number };
  solicitacoes_pendentes: number;
}

export interface AccessPreviewParams {
  ponto: number;
  ip: string;
  origem: AccessPreviewOrigem;
}

export async function fetchAccessPreview(params: AccessPreviewParams): Promise<AccessPreviewResponse> {
  const qs = new URLSearchParams({
    ponto: String(params.ponto),
    ip: params.origem === "local" ? params.ip.trim() : "",
    origem: params.origem,
  });
  return apiFetch<AccessPreviewResponse>(`/admin/access/preview?${qs.toString()}`);
}

export async function fetchAccessOverview(): Promise<AccessOverviewResponse> {
  return apiFetch<AccessOverviewResponse>("/admin/access/overview");
}

export function useAccessOverview() {
  return useQuery({
    queryKey: ["acesso", "overview"] as const,
    queryFn: fetchAccessOverview,
    refetchInterval: 30_000,
    staleTime: 10_000,
    placeholderData: (previous) => previous,
  });
}

export function useAccessPreview(params: AccessPreviewParams | null) {
  return useQuery({
    queryKey: ["acesso", "preview", params] as const,
    queryFn: () => fetchAccessPreview(params!),
    enabled: params != null,
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });
}
