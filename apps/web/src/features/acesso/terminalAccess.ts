import { isIpActive, readPermissionValue } from "@/features/admin-ips/constants";
import type {
  IpPermissionRecord,
  IpPermissionUpdatePayload,
} from "@/features/admin-ips/types";
import type { PermissionKey } from "@/features/auth/types";

import { IP_PERMISSION_KEYS } from "./permissionCatalog";

export const SEM_GRUPO = "Sem Grupo";

type RawRecord = Record<string, boolean | number | string | null | undefined>;

export function terminalGroupName(record: Pick<IpPermissionRecord, "grupo">): string {
  return record.grupo?.trim() || SEM_GRUPO;
}

/** Valores das chaves de terminal de um registro de `ip_permissions`. */
export function terminalPermissionValues(
  record: IpPermissionRecord,
): Partial<Record<PermissionKey, boolean>> {
  const values: Partial<Record<PermissionKey, boolean>> = {};
  for (const key of IP_PERMISSION_KEYS) {
    values[key] = readPermissionValue(
      record as unknown as Record<string, boolean | number | null | undefined>,
      key,
    );
  }
  return values;
}

export function countActivePermissions(record: IpPermissionRecord): number {
  const values = terminalPermissionValues(record);
  return IP_PERMISSION_KEYS.filter((key) => values[key]).length;
}

export function isTerminalActive(record: Pick<IpPermissionRecord, "ativo">): boolean {
  return isIpActive(record.ativo);
}

/** IPv4/IPv6 com `%` como curinga (ex.: 10.120.1.%). Sem espaços nem outros símbolos. */
export function isValidIpPattern(ip: string): boolean {
  const value = ip.trim();
  return value.length > 0 && /^[0-9a-fA-F:.%]+$/.test(value) && /[0-9]/.test(value);
}

/** Terminal já cadastrado com exatamente o mesmo IP/padrão (ignora `exceptId`). */
export function findTerminalByIp(
  records: ReadonlyArray<IpPermissionRecord>,
  ip: string,
  exceptId?: number,
): IpPermissionRecord | undefined {
  const target = ip.trim();
  return records.find((r) => r.ip.trim() === target && r.id !== exceptId);
}

function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

export function filterTerminals(
  records: ReadonlyArray<IpPermissionRecord>,
  filters: { text: string; grupo: string; status: "todos" | "ativos" | "inativos" },
): IpPermissionRecord[] {
  const q = normalize(filters.text.trim());
  return records.filter((r) => {
    if (filters.grupo && terminalGroupName(r) !== filters.grupo) return false;
    if (filters.status === "ativos" && !isTerminalActive(r)) return false;
    if (filters.status === "inativos" && isTerminalActive(r)) return false;
    if (q) {
      const hay = normalize([r.ip, r.descricao, r.grupo].filter(Boolean).join(" "));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function groupTerminals(
  records: ReadonlyArray<IpPermissionRecord>,
): Array<[string, IpPermissionRecord[]]> {
  const map = new Map<string, IpPermissionRecord[]>();
  for (const r of records) {
    const g = terminalGroupName(r);
    const list = map.get(g);
    if (list) list.push(r);
    else map.set(g, [r]);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, "pt-BR"));
}

export interface TerminalDraft {
  ip: string;
  descricao: string;
  grupo: string;
  values: Partial<Record<PermissionKey, boolean>>;
}

/** Corpo do POST /api/admin/ip/update: metadados + todas as chaves do terminal (sem `ativo`). */
export function buildTerminalUpdatePayload(
  id: number,
  draft: TerminalDraft,
): IpPermissionUpdatePayload {
  const payload: IpPermissionUpdatePayload = {
    id,
    ip: draft.ip.trim(),
    descricao: draft.descricao.trim(),
    grupo: draft.grupo.trim() || SEM_GRUPO,
  };
  for (const key of IP_PERMISSION_KEYS) {
    payload[key] = Boolean(draft.values[key]);
  }
  return payload;
}

export function draftFromRecord(record: IpPermissionRecord): TerminalDraft {
  const raw = record as unknown as RawRecord;
  return {
    ip: String(raw["ip"] ?? ""),
    descricao: String(raw["descricao"] ?? ""),
    grupo: String(raw["grupo"] ?? ""),
    values: terminalPermissionValues(record),
  };
}
