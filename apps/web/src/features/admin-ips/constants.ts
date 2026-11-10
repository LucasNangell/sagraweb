import {
  buildDefaultIpPermissionValues,
  getPermissionEntry,
  IP_PERMISSION_KEYS,
} from "@/features/acesso/permissionCatalog";
import type { PermissionKey } from "@/features/auth/types";
import type { IpPermissionPayload } from "./types";

export interface PermissionColumn {
  key: PermissionKey;
  label: string;
  title: string;
}

function toColumn(key: PermissionKey): PermissionColumn {
  const item = getPermissionEntry(key);
  return { key, label: item?.shortLabel ?? key, title: item?.label ?? key };
}

/** Colunas do terminal derivadas do catálogo único (`features/acesso/permissionCatalog`). */
export const CONTEXT_PERMISSION_COLUMNS: PermissionColumn[] = IP_PERMISSION_KEYS.filter((k) =>
  k.startsWith("ctx_"),
).map(toColumn);

export const SIDEBAR_PERMISSION_COLUMNS: PermissionColumn[] = IP_PERMISSION_KEYS.filter((k) =>
  k.startsWith("sb_"),
).map(toColumn);

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
    ...buildDefaultIpPermissionValues(),
    ip,
    descricao,
    grupo,
    ativo: true,
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
