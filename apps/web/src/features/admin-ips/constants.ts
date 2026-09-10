import type { PermissionKey } from "@/features/auth/types";
import type { IpPermissionPayload } from "./types";

export interface PermissionColumn {
  key: PermissionKey;
  label: string;
  title: string;
}

export const CONTEXT_PERMISSION_COLUMNS: PermissionColumn[] = [
  { key: "ctx_nova_os", label: "Nova", title: "Nova OS" },
  { key: "ctx_duplicar_os", label: "Dup", title: "Duplicar" },
  { key: "ctx_editar_os", label: "Edit", title: "Editar" },
  { key: "ctx_vincular_os", label: "Vinc", title: "Vincular" },
  { key: "ctx_abrir_pasta", label: "Pasta", title: "Pasta" },
  { key: "ctx_mover_pastas", label: "Mov", title: "Mover Pastas" },
  { key: "ctx_imprimir_ficha", label: "Ficha", title: "Ficha" },
  { key: "ctx_detalhes_os", label: "Det", title: "Detalhes" },
  { key: "ctx_orcamento", label: "Orç", title: "Orçamento" },
];

export const SIDEBAR_PERMISSION_COLUMNS: PermissionColumn[] = [
  { key: "sb_inicio", label: "Ini", title: "Início" },
  { key: "sb_gerencia", label: "Ger", title: "Gerência" },
  { key: "sb_email", label: "Email", title: "Email" },
  { key: "sb_analise", label: "Ana", title: "Análise" },
  { key: "sb_papelaria", label: "Pap", title: "Papelaria" },
  { key: "sb_usuario", label: "Usr", title: "Usuário" },
  { key: "sb_configuracoes", label: "Cfg", title: "Config" },
  { key: "sb_relatorio", label: "Rel", title: "Relatório" },
  { key: "sb_dashboard_setor", label: "Dsh", title: "Dashboard Setor" },
  { key: "sb_admin_ips", label: "Adm", title: "Admin IPs" },
  { key: "sb_pcp", label: "PCP", title: "PCP" },
  { key: "sb_usuarios", label: "Usr", title: "Usuários" },
  { key: "sb_active_computers", label: "Atv", title: "Ativos" },
  { key: "sb_gravacao", label: "Grv", title: "Gravação" },
  { key: "sb_gravacao_externa", label: "GEx", title: "Gravação Externa" },
  { key: "sb_gravacao_pendente", label: "GPn", title: "Gravações Pendentes" },
  { key: "sb_gravacao_externa_operador", label: "OpG", title: "Operador Grv. Externa" },
  { key: "sb_gravacao_pendente_excluir", label: "ExG", title: "Excluir controle de chapas" },
  { key: "sb_gravacao_externa_entrega", label: "Rec", title: "Lançar recebimento das chapas" },
  { key: "sb_gravacao_externa_lancar", label: "LGx", title: "Enviar para gravação externa" },
  { key: "sb_cotas_graf", label: "Cot", title: "Cotas Graf" },
  { key: "sb_estoque", label: "Est", title: "Estoque (operador)" },
  { key: "sb_estoque_gerente", label: "EGe", title: "Estoque (gerente)" },
  { key: "sb_lombada", label: "Lom", title: "Lombada" },
  { key: "sb_credenciais_depol", label: "Dep", title: "Credenciais DEPOL" },
  { key: "sb_manipular_imagem", label: "Img", title: "Manipular Imagem" },
];

export const ALL_PERMISSION_COLUMNS: PermissionColumn[] = [
  ...CONTEXT_PERMISSION_COLUMNS,
  ...SIDEBAR_PERMISSION_COLUMNS,
];

export function buildDefaultNewIpPayload(
  ip: string,
  descricao: string,
  grupo: string,
): IpPermissionPayload {
  return {
    ip,
    descricao,
    grupo,
    ativo: true,
    ctx_nova_os: true,
    ctx_duplicar_os: true,
    ctx_editar_os: true,
    ctx_vincular_os: true,
    ctx_abrir_pasta: true,
    ctx_mover_pastas: true,
    ctx_imprimir_ficha: true,
    ctx_detalhes_os: true,
    ctx_orcamento: false,
    sb_inicio: true,
    sb_gerencia: true,
    sb_email: true,
    sb_analise: true,
    sb_papelaria: true,
    sb_usuario: true,
    sb_configuracoes: true,
    sb_relatorio: true,
    sb_dashboard_setor: true,
    sb_admin_ips: false,
    sb_pcp: true,
    sb_usuarios: true,
    sb_active_computers: true,
    sb_gravacao: true,
    sb_cotas_graf: true,
    sb_gravacao_externa: true,
    sb_gravacao_pendente: true,
    sb_gravacao_externa_operador: false,
    sb_gravacao_pendente_excluir: false,
    sb_gravacao_externa_entrega: false,
    sb_gravacao_externa_lancar: false,
    sb_estoque: false,
    sb_estoque_gerente: false,
    sb_lombada: false,
    sb_credenciais_depol: false,
    sb_manipular_imagem: false,
  };
}

export function isIpActive(value: boolean | number | null | undefined): boolean {
  return value === true || value === 1;
}

export function readPermissionValue(
  record: Record<string, boolean | number | null | undefined>,
  key: PermissionKey,
): boolean {
  return isIpActive(record[key]);
}
