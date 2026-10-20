import {
  PERMISSION_KEYS,
  type PermissionKey,
  type Permissions,
  type PermissionsResponse,
} from "./types";

/** Política restritiva padrão — anti fail-open (todas negadas). */
export function createDeniedPermissions(): Permissions {
  const acc = PERMISSION_KEYS.reduce(
    (state, key) => {
      state[key] = false;
      return state;
    },
    {} as Record<PermissionKey, boolean>,
  );
  return {
    ...acc,
    painelSetores: [],
    painelSetoresLegacyAll: false,
  };
}

/** Valor vindo da API ou MySQL (true, 1, false, 0, null). */
export function isPermissionGranted(value: unknown): boolean {
  return value === true || value === 1;
}

function parsePainelSetores(raw: PermissionsResponse | null | undefined): string[] {
  const list = raw?.painel_setores;
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((s) => String(s).trim()).filter(Boolean);
}

/** Só concede permissão quando a API retorna explicitamente permitido. */
export function parsePermissionsFromApi(
  raw: PermissionsResponse | null | undefined,
): Permissions {
  const denied = createDeniedPermissions();
  if (!raw) {
    return denied;
  }
  for (const key of PERMISSION_KEYS) {
    denied[key] = isPermissionGranted(raw[key]);
  }
  denied.painelSetores = parsePainelSetores(raw);
  denied.painelSetoresLegacyAll =
    isPermissionGranted(raw.painel_setores_legacy_all) ||
    (isPermissionGranted(raw.sb_dashboard_setor) && denied.painelSetores.length === 0);
  return denied;
}

export function hasPermission(
  permissions: Permissions,
  key: PermissionKey,
): boolean {
  return isPermissionGranted(permissions[key]);
}

export function hasPainelGlobalAccess(permissions: Permissions): boolean {
  return hasPermission(permissions, "sb_dashboard_global");
}

export function hasPainelSetorAccess(permissions: Permissions): boolean {
  if (permissions.painelSetores.length > 0) {
    return true;
  }
  return permissions.painelSetoresLegacyAll || hasPermission(permissions, "sb_dashboard_setor");
}

export function canAccessPainelSetor(
  permissions: Permissions,
  setor: string,
): boolean {
  const normalized = setor.trim();
  if (!normalized) {
    return false;
  }
  if (permissions.painelSetoresLegacyAll) {
    return true;
  }
  if (permissions.painelSetores.length > 0) {
    return permissions.painelSetores.includes(normalized);
  }
  return hasPermission(permissions, "sb_dashboard_setor");
}

export function filterAllowedPainelSetores(
  permissions: Permissions,
  allSetores: string[],
): string[] {
  if (permissions.painelSetoresLegacyAll) {
    return allSetores;
  }
  if (permissions.painelSetores.length > 0) {
    return allSetores.filter((s) => permissions.painelSetores.includes(s));
  }
  return hasPermission(permissions, "sb_dashboard_setor") ? allSetores : [];
}

export function hasPainelTabletAccess(permissions: Permissions): boolean {
  return hasPermission(permissions, "sb_dashboard_tablet");
}

export function canAccessPainelRoute(
  permissions: Permissions,
  route:
    | "/painel/global"
    | "/painel/setor"
    | "/painel/tablet"
    | "/painel/celular"
    | "/painel/gravacao",
): boolean {
  if (route === "/painel/global") {
    return hasPainelGlobalAccess(permissions);
  }
  if (
    route === "/painel/tablet" ||
    route === "/painel/celular" ||
    route === "/painel/gravacao"
  ) {
    return hasPainelTabletAccess(permissions);
  }
  return hasPainelSetorAccess(permissions);
}
