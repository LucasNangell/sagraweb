/** Chaves RBAC retornadas por GET /api/permissions */
export type PermissionKey =
  | "ctx_nova_os"
  | "ctx_duplicar_os"
  | "ctx_editar_os"
  | "ctx_vincular_os"
  | "ctx_abrir_pasta"
  | "ctx_mover_pastas"
  | "ctx_imprimir_ficha"
  | "ctx_detalhes_os"
  | "ctx_prova_web"
  | "ctx_orcamento"
  | "sb_inicio"
  | "sb_gerencia"
  | "sb_email"
  | "sb_analise"
  | "sb_papelaria"
  | "sb_usuario"
  | "sb_configuracoes"
  | "sb_relatorio"
  | "sb_dashboard_setor"
  | "sb_dashboard_global"
  | "sb_dashboard_tablet"
  | "sb_admin_ips"
  | "sb_pcp"
  | "sb_usuarios"
  | "sb_active_computers"
  | "sb_gravacao"
  | "sb_cotas_graf"
  | "sb_gravacao_externa"
  | "sb_gravacao_pendente"
  | "sb_gravacao_externa_operador"
  | "sb_gravacao_pendente_excluir"
  | "sb_gravacao_externa_entrega"
  | "sb_gravacao_externa_lancar"
  | "sb_estoque"
  | "sb_estoque_gerente"
  | "sb_lombada"
  | "sb_credenciais_depol"
  | "sb_manipular_imagem";

export interface Permissions extends Record<PermissionKey, boolean> {
  painelSetores: string[];
  /** Legado: sb_dashboard_setor sem lista explícita = todos os setores. */
  painelSetoresLegacyAll: boolean;
}

export const PERMISSION_KEYS: PermissionKey[] = [
  "ctx_nova_os",
  "ctx_duplicar_os",
  "ctx_editar_os",
  "ctx_vincular_os",
  "ctx_abrir_pasta",
  "ctx_mover_pastas",
  "ctx_imprimir_ficha",
  "ctx_detalhes_os",
  "ctx_prova_web",
  "ctx_orcamento",
  "sb_inicio",
  "sb_gerencia",
  "sb_email",
  "sb_analise",
  "sb_papelaria",
  "sb_usuario",
  "sb_configuracoes",
  "sb_relatorio",
  "sb_dashboard_setor",
  "sb_dashboard_global",
  "sb_dashboard_tablet",
  "sb_admin_ips",
  "sb_pcp",
  "sb_usuarios",
  "sb_active_computers",
  "sb_gravacao",
  "sb_cotas_graf",
  "sb_gravacao_externa",
  "sb_gravacao_pendente",
  "sb_gravacao_externa_operador",
  "sb_gravacao_pendente_excluir",
  "sb_gravacao_externa_entrega",
  "sb_gravacao_externa_lancar",
  "sb_estoque",
  "sb_estoque_gerente",
  "sb_lombada",
  "sb_credenciais_depol",
  "sb_manipular_imagem",
];

export interface SessionUser {
  ponto: number;
  nome: string;
  ip: string;
  auth_mode?: string;
  setor?: string | null;
  fornecedor?: boolean;
}

export interface PermissionsResponse {
  ip: string;
  ponto?: number | null;
  ctx_nova_os?: boolean;
  ctx_duplicar_os?: boolean;
  ctx_editar_os?: boolean;
  ctx_vincular_os?: boolean;
  ctx_abrir_pasta?: boolean;
  ctx_mover_pastas?: boolean;
  ctx_imprimir_ficha?: boolean;
  ctx_detalhes_os?: boolean;
  ctx_prova_web?: boolean;
  ctx_orcamento?: boolean;
  sb_inicio?: boolean;
  sb_gerencia?: boolean;
  sb_email?: boolean;
  sb_analise?: boolean;
  sb_papelaria?: boolean;
  sb_usuario?: boolean;
  sb_configuracoes?: boolean;
  sb_relatorio?: boolean;
  sb_dashboard_setor?: boolean;
  sb_dashboard_global?: boolean;
  sb_dashboard_tablet?: boolean;
  painel_setores?: string[];
  painel_setores_legacy_all?: boolean;
  sb_admin_ips?: boolean;
  sb_pcp?: boolean;
  sb_usuarios?: boolean;
  sb_active_computers?: boolean;
  sb_gravacao?: boolean;
  sb_cotas_graf?: boolean;
  sb_gravacao_externa?: boolean;
  sb_gravacao_pendente?: boolean;
  sb_gravacao_externa_operador?: boolean;
  sb_gravacao_pendente_excluir?: boolean;
  sb_gravacao_externa_entrega?: boolean;
  sb_gravacao_externa_lancar?: boolean;
  sb_estoque?: boolean;
  sb_estoque_gerente?: boolean;
  sb_lombada?: boolean;
  sb_credenciais_depol?: boolean;
  sb_manipular_imagem?: boolean;
}

export interface SessionCreateResponse {
  status: string;
  message: string;
  user: SessionUser;
}

export interface SessionMeResponse {
  ponto: number;
  nome: string;
  ip: string;
  auth_mode?: string;
  setor?: string | null;
  fornecedor?: boolean;
}
