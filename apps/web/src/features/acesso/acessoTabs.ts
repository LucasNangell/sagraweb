import { hasPermission } from "@/features/auth/permissions";
import type { PermissionKey, Permissions } from "@/features/auth/types";

export type AcessoAba = "visao-geral" | "usuarios" | "terminais" | "clientes";

export interface AcessoSearch {
  aba?: AcessoAba;
  /** Usuário aberto no painel lateral (aba Usuários / simulador). */
  ponto?: number;
  /** Terminal (id em ip_permissions) aberto no painel lateral. */
  terminal?: number;
}

export interface AcessoTabMeta {
  id: AcessoAba;
  label: string;
  /** Aceita se o usuário tiver qualquer uma das chaves. */
  anyOf: PermissionKey[];
}

export const ACESSO_TABS: ReadonlyArray<AcessoTabMeta> = [
  { id: "usuarios", label: "Usuários", anyOf: ["sb_usuarios"] },
  { id: "terminais", label: "Terminais", anyOf: ["sb_admin_ips"] },
];

const ABA_IDS = new Set<string>(["visao-geral", "usuarios", "terminais", "clientes"]);

function parsePositiveInt(value: unknown): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** `validateSearch` da rota /admin/acesso — tolera valores inválidos (descarta). */
export function parseAcessoSearch(search: Record<string, unknown>): AcessoSearch {
  const out: AcessoSearch = {};
  const aba = search["aba"];
  if (typeof aba === "string" && ABA_IDS.has(aba)) {
    out.aba = aba as AcessoAba;
  }
  const ponto = parsePositiveInt(search["ponto"]);
  if (ponto !== undefined) out.ponto = ponto;
  const terminal = parsePositiveInt(search["terminal"]);
  if (terminal !== undefined) out.terminal = terminal;
  return out;
}

export function getVisibleAcessoTabs(permissions: Permissions): AcessoTabMeta[] {
  return ACESSO_TABS.filter((tab) => tab.anyOf.some((key) => hasPermission(permissions, key)));
}

/** Aba efetiva: a pedida na URL se permitida; senão a primeira visível. */
export function resolveAcessoAba(
  requested: AcessoAba | undefined,
  visible: ReadonlyArray<AcessoTabMeta>,
): AcessoAba | null {
  if (visible.length === 0) return null;
  if (requested && visible.some((t) => t.id === requested)) return requested;
  return visible[0]!.id;
}
