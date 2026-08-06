import type { PermissionKey } from "@/features/auth/types";

export interface IpPermissionRecord {
  id: number;
  ip: string;
  descricao: string | null;
  grupo: string | null;
  ativo: boolean | number;
  ctx_nova_os: boolean | number;
  ctx_duplicar_os: boolean | number;
  ctx_editar_os: boolean | number;
  ctx_vincular_os: boolean | number;
  ctx_abrir_pasta: boolean | number;
  ctx_mover_pastas: boolean | number;
  ctx_imprimir_ficha: boolean | number;
  ctx_detalhes_os: boolean | number;
  sb_inicio: boolean | number;
  sb_gerencia: boolean | number;
  sb_email: boolean | number;
  sb_analise: boolean | number;
  sb_papelaria: boolean | number;
  sb_usuario: boolean | number;
  sb_configuracoes: boolean | number;
  sb_relatorio: boolean | number;
  sb_dashboard_setor: boolean | number;
  sb_admin_ips: boolean | number;
  sb_pcp: boolean | number;
  sb_usuarios: boolean | number;
  sb_active_computers: boolean | number;
  sb_gravacao: boolean | number;
  sb_cotas_graf: boolean | number;
  sb_gravacao_externa: boolean | number;
  sb_gravacao_pendente: boolean | number;
  sb_gravacao_externa_operador: boolean | number;
  sb_gravacao_pendente_excluir: boolean | number;
  sb_gravacao_externa_entrega: boolean | number;
  sb_gravacao_externa_lancar: boolean | number;
  sb_estoque: boolean | number;
  sb_estoque_gerente: boolean | number;
  sb_lombada: boolean | number;
  sb_credenciais_depol: boolean | number;
}

export type IpPermissionPayload = Record<PermissionKey, boolean> & {
  ip: string;
  descricao?: string;
  grupo?: string;
  ativo: boolean;
};

export interface IpMetaDraft {
  ip?: string;
  descricao?: string;
  grupo?: string;
}

export interface IpPermissionUpdatePayload {
  id: number;
  ip?: string;
  descricao?: string;
  grupo?: string;
  ativo?: boolean;
  [key: string]: boolean | number | string | undefined;
}

export interface AccessRequestRecord {
  id: number;
  ip: string;
  nome: string;
  ponto: number;
  secao: string;
  data_solicitacao: string;
}

export interface PendingRequestMeta {
  requestId: number;
  ponto: number;
  nome: string;
}

export type AdminIpsMessageType = "success" | "error";

export interface AdminIpsMessage {
  type: AdminIpsMessageType;
  text: string;
}
