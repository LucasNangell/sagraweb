import type { PermissionKey, PermissionsResponse } from "@/features/auth/types";

import { USER_MATRIX_PERMISSION_KEYS } from "./permissionCatalog";
import type { UsuarioRecord, UsuarioRow } from "./types";

type Flag = number | boolean | null | undefined;

function truthy(value: Flag): boolean {
  return value === true || value === 1;
}

/** Conta internet: tem e-mail, senha, ativação pendente ou e-mail verificado. */
export function hasInternetAccount(user: Pick<UsuarioRecord, "Email" | "ContaInternet">): boolean {
  return Boolean(user.Email?.trim()) || truthy(user.ContaInternet);
}

/** `AuthAtivo` ausente/nulo = ativo (default da coluna). */
export function isAccountActive(user: Pick<UsuarioRecord, "AuthAtivo">): boolean {
  return user.AuthAtivo == null ? true : truthy(user.AuthAtivo);
}

export function isFornecedor(user: Pick<UsuarioRecord, "Fornecedor">): boolean {
  return truthy(user.Fornecedor);
}

/** Um IP por linha, vírgula ou ponto e vírgula; remove vazios e duplicados (ordem preservada). */
export function parseIpsText(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,;]+/)) {
    const ip = raw.trim();
    if (ip && !seen.has(ip)) {
      seen.add(ip);
      out.push(ip);
    }
  }
  return out;
}

export interface UserPermissionsState {
  values: Partial<Record<PermissionKey, boolean>>;
  painelGlobal: boolean;
  painelTablet: boolean;
  /** Setores explícitos; `legacyAll` = todos os setores (cadastro antigo). */
  painelSetores: string[];
  legacyAll: boolean;
}

export function permissionsStateFromResponse(data: PermissionsResponse): UserPermissionsState {
  const values: Partial<Record<PermissionKey, boolean>> = {};
  for (const key of USER_MATRIX_PERMISSION_KEYS) {
    values[key] = Boolean(data[key as keyof PermissionsResponse]);
  }
  const explicit = (data.painel_setores ?? []).map((s) => String(s).trim()).filter(Boolean);
  const legacyAll =
    Boolean(data.painel_setores_legacy_all) ||
    (Boolean(data.sb_dashboard_setor) && explicit.length === 0);
  return {
    values,
    painelGlobal: Boolean(data.sb_dashboard_global),
    painelTablet: Boolean(data.sb_dashboard_tablet),
    painelSetores: explicit,
    legacyAll,
  };
}

/** Setores marcados na UI: legado "todos" expande para a lista atual de setores. */
export function resolvePainelSetoresSelection(
  state: Pick<UserPermissionsState, "painelSetores" | "legacyAll">,
  allSetores: ReadonlyArray<string>,
): string[] {
  return state.legacyAll ? [...allSetores] : [...state.painelSetores];
}

/**
 * Espelha `is_user_permissions_customized` do backend: basta uma flag ou setor liberado
 * para o cadastro do usuário substituir as permissões do terminal.
 */
export function isUserPermissionsCustomized(
  values: Partial<Record<PermissionKey, boolean>>,
  extras: { painelGlobal: boolean; painelTablet: boolean; painelSetores: ReadonlyArray<string> },
): boolean {
  return (
    USER_MATRIX_PERMISSION_KEYS.some((key) => Boolean(values[key])) ||
    extras.painelGlobal ||
    extras.painelTablet ||
    extras.painelSetores.length > 0
  );
}

/** Corpo do PUT /api/admin/users/{ponto}/permissions (sem auth_ativo — salvo à parte). */
export function buildUserPermissionsPayload(
  values: Partial<Record<PermissionKey, boolean>>,
  painel: { painelGlobal: boolean; painelTablet: boolean; painelSetores: ReadonlyArray<string> },
): Partial<Record<PermissionKey, boolean>> & { painel_setores: string[] } {
  const payload: Partial<Record<PermissionKey, boolean>> & { painel_setores: string[] } = {
    painel_setores: [...painel.painelSetores],
  };
  for (const key of USER_MATRIX_PERMISSION_KEYS) {
    payload[key] = Boolean(values[key]);
  }
  payload.sb_dashboard_global = painel.painelGlobal;
  payload.sb_dashboard_tablet = painel.painelTablet;
  payload.sb_dashboard_setor = painel.painelSetores.length > 0;
  return payload;
}

export function mergeUsuariosWithOnline(
  users: UsuarioRecord[],
  onlinePoints: Array<string | number>,
): UsuarioRow[] {
  const safeUsers = Array.isArray(users) ? users : [];
  const safeOnline = Array.isArray(onlinePoints) ? onlinePoints : [];

  const rows = safeUsers.map((user) => {
    const ponto = parseInt(String(user.Ponto), 10);
    const isOnline = safeOnline.some(
      (onlinePonto) => parseInt(String(onlinePonto), 10) === ponto,
    );
    return { ...user, isOnline };
  });

  rows.sort((a, b) => {
    if (a.isOnline && !b.isOnline) return -1;
    if (!a.isOnline && b.isOnline) return 1;

    const nomeA = (a.Nome || "").toLowerCase();
    const nomeB = (b.Nome || "").toLowerCase();
    return nomeA.localeCompare(nomeB, "pt-BR");
  });

  return rows;
}

export function formatUltimoAcesso(value: string | null | undefined): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("pt-BR");
}
