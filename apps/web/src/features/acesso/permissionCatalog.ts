/**
 * Catálogo único das chaves de permissão (RBAC) administradas no Controle de Acesso.
 *
 * Fonte de verdade para rótulos, categoria e escopo de cada `PermissionKey`.
 * Toda chave nova em `PERMISSION_KEYS` precisa de uma entrada aqui — o teste
 * `permissionCatalog.test.ts` falha se alguma ficar de fora.
 *
 * Escopo:
 * - `ip`   — só no terminal (`ip_permissions`).
 * - `user` — só no usuário (`user_permissions`).
 * - `both` — no terminal e no usuário (hoje todas as chaves).
 */
import type { PermissionKey } from "@/features/auth/types";

export type PermissionScope = "ip" | "user" | "both";

export type PermissionCategory =
  | "menu"
  | "contexto"
  | "paineis"
  | "gravacao"
  | "estoque"
  | "outros";

export type PermissionTarget = "ip" | "user";

export interface PermissionCatalogEntry {
  key: PermissionKey;
  /** Rótulo curto (cabeçalhos compactos). */
  shortLabel: string;
  /** Rótulo completo exibido nos editores. */
  label: string;
  category: PermissionCategory;
  scope: PermissionScope;
  /** Valor inicial ao cadastrar um terminal novo (só para escopo ip/both). */
  defaultForNewIp: boolean;
  /** Explicação curta (tooltip / chaves fora de escopo). */
  hint?: string;
}

export const PERMISSION_CATEGORIES: ReadonlyArray<{
  id: PermissionCategory;
  label: string;
}> = [
  { id: "menu", label: "Menu lateral" },
  { id: "contexto", label: "Menu de contexto da OS" },
  { id: "paineis", label: "Painéis" },
  { id: "gravacao", label: "Gravação" },
  { id: "estoque", label: "Estoque" },
  { id: "outros", label: "Administração e outros" },
];

function entry(
  key: PermissionKey,
  shortLabel: string,
  label: string,
  category: PermissionCategory,
  scope: PermissionScope,
  defaultForNewIp: boolean,
  hint?: string,
): PermissionCatalogEntry {
  return { key, shortLabel, label, category, scope, defaultForNewIp, hint };
}

/** Ordem = ordem de exibição (mantém a ordem histórica das colunas de Admin IPs). */
export const PERMISSION_CATALOG: ReadonlyArray<PermissionCatalogEntry> = [
  // Menu de contexto da OS
  entry("ctx_nova_os", "Nova", "Nova OS", "contexto", "both", true),
  entry("ctx_duplicar_os", "Dup", "Duplicar OS", "contexto", "both", true),
  entry("ctx_editar_os", "Edit", "Editar OS", "contexto", "both", true),
  entry("ctx_vincular_os", "Vinc", "Vincular OS", "contexto", "both", true),
  entry("ctx_abrir_pasta", "Pasta", "Abrir pasta", "contexto", "both", true),
  entry("ctx_mover_pastas", "Mov", "Mover pastas", "contexto", "both", true),
  entry("ctx_imprimir_ficha", "Ficha", "Imprimir ficha", "contexto", "both", true),
  entry("ctx_imprimir_separador", "Sep", "Imprimir separador", "contexto", "both", false),
  entry("ctx_detalhes_os", "Det", "Detalhes da OS", "contexto", "both", true),
  entry("ctx_orcamento", "Orç", "Orçamento", "contexto", "both", false),
  entry("ctx_prova_web", "PWeb", "Prova WEB", "contexto", "both", false),
  entry("ctx_comparar_versoes", "Cmp", "Comparar versões PDF", "contexto", "both", false),

  // Menu lateral
  entry("sb_inicio", "Ini", "Início", "menu", "both", true),
  entry("sb_gerencia", "Ger", "Gerência", "menu", "both", true),
  entry("sb_email", "Email", "E-mail", "menu", "both", true),
  entry("sb_analise", "Ana", "Análise", "menu", "both", true),
  entry("sb_papelaria", "Pap", "Papelaria", "menu", "both", true),
  entry("sb_usuario", "Usr", "Usuário", "menu", "both", true),
  entry("sb_configuracoes", "Cfg", "Configurações", "menu", "both", true),
  entry("sb_relatorio", "Rel", "Relatórios", "menu", "both", true),
  entry("sb_dashboard_setor", "Dsh", "Painel de setor", "paineis", "both", true),
  entry(
    "sb_admin_ips",
    "Adm",
    "Controle de Acesso — Terminais (e páginas admin)",
    "outros",
    "both",
    false,
  ),
  entry("sb_pcp", "PCP", "PCP", "menu", "both", true),
  entry("sb_usuarios", "Usrs", "Controle de Acesso — Usuários", "outros", "both", true),
  entry("sb_active_computers", "Atv", "Computadores ativos", "outros", "both", true),
  entry("sb_gravacao", "Grv", "Gravação", "gravacao", "both", true),
  entry("sb_gravacao_externa", "GEx", "Gravação Externa", "gravacao", "both", true),
  entry("sb_gravacao_pendente", "GPn", "Gravações Pendentes", "gravacao", "both", true),
  entry("sb_gravacao_externa_operador", "OpG", "Operador Grv. Externa", "gravacao", "both", false),
  entry(
    "sb_gravacao_pendente_excluir",
    "ExG",
    "Excluir controle de chapas",
    "gravacao",
    "both",
    false,
  ),
  entry(
    "sb_gravacao_externa_entrega",
    "Rec",
    "Lançar recebimento das chapas",
    "gravacao",
    "both",
    false,
  ),
  entry(
    "sb_gravacao_externa_lancar",
    "LGx",
    "Enviar para gravação externa",
    "gravacao",
    "both",
    false,
  ),
  entry("sb_cotas_graf", "Cot", "Cotas Graf", "menu", "both", true),
  entry("sb_estoque", "Est", "Estoque (operador)", "estoque", "both", false),
  entry("sb_estoque_gerente", "EGe", "Estoque (gerente)", "estoque", "both", false),
  entry("sb_lombada", "Lom", "Calculadora de lombada", "outros", "both", false),
  entry("sb_credenciais_depol", "Dep", "Credenciais DEPOL", "menu", "both", false),
  entry("sb_manipular_imagem", "Img", "Manipular Imagem", "menu", "both", false),
  entry(
    "sb_reiniciar_sistema",
    "Rst",
    "Reiniciar sistema (serviços de produção)",
    "outros",
    "both",
    false,
    "Exibe o botão no header para reiniciar API, Sync, Monitor e Organizador.",
  ),

  // Painéis (no usuário, geridos na seção Painéis do painel lateral)
  entry("sb_dashboard_global", "DGl", "Painel global", "paineis", "both", false),
  entry("sb_dashboard_tablet", "DTb", "Painel tablet/celular/gravação", "paineis", "both", false),
];

const CATALOG_BY_KEY: ReadonlyMap<PermissionKey, PermissionCatalogEntry> = new Map(
  PERMISSION_CATALOG.map((item) => [item.key, item]),
);

export function getPermissionEntry(key: PermissionKey): PermissionCatalogEntry | undefined {
  return CATALOG_BY_KEY.get(key);
}

export function getPermissionLabel(key: PermissionKey): string {
  return CATALOG_BY_KEY.get(key)?.label ?? key;
}

/** A chave é editável diretamente no alvo informado? */
export function isPermissionInScope(
  entryOrKey: PermissionCatalogEntry | PermissionKey,
  target: PermissionTarget,
): boolean {
  const item = typeof entryOrKey === "string" ? CATALOG_BY_KEY.get(entryOrKey) : entryOrKey;
  if (!item) return false;
  return item.scope === "both" || item.scope === target;
}

/** Chaves com coluna em `ip_permissions` editável na tela de terminais. */
export const IP_PERMISSION_KEYS: ReadonlyArray<PermissionKey> = PERMISSION_CATALOG.filter((item) =>
  isPermissionInScope(item, "ip"),
).map((item) => item.key);

/**
 * Chaves booleanas editadas na matriz do usuário.
 * Painéis (setor/global/tablet) ficam na seção Painéis do usuário, não na matriz.
 */
export const USER_MATRIX_PERMISSION_KEYS: ReadonlyArray<PermissionKey> = PERMISSION_CATALOG.filter(
  (item) => isPermissionInScope(item, "user") && item.category !== "paineis",
).map((item) => item.key);

/** Valores iniciais das permissões de um terminal recém-cadastrado. */
export function buildDefaultIpPermissionValues(): Record<PermissionKey, boolean> {
  const values = {} as Record<PermissionKey, boolean>;
  for (const item of PERMISSION_CATALOG) {
    if (isPermissionInScope(item, "ip")) {
      values[item.key] = item.defaultForNewIp;
    }
  }
  return values;
}

/** Entradas do catálogo agrupadas por categoria, na ordem de `PERMISSION_CATEGORIES`. */
export function groupCatalogByCategory(
  entries: ReadonlyArray<PermissionCatalogEntry> = PERMISSION_CATALOG,
): Array<{ id: PermissionCategory; label: string; entries: PermissionCatalogEntry[] }> {
  return PERMISSION_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    entries: entries.filter((item) => item.category === cat.id),
  })).filter((group) => group.entries.length > 0);
}
