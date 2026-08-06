import { cn } from "@sagra/ui";
import {
  ChevronDown,
  FolderOpen,
  Loader2,
  Save,
  ToggleLeft,
  ToggleRight,
  Trash2,
} from "lucide-react";

import {
  ALL_PERMISSION_COLUMNS,
  CONTEXT_PERMISSION_COLUMNS,
  isIpActive,
  readPermissionValue,
  SIDEBAR_PERMISSION_COLUMNS,
} from "@/features/admin-ips/constants";
import type {
  IpMetaDraft,
  IpPermissionRecord,
  IpPermissionUpdatePayload,
} from "@/features/admin-ips/types";
import type { PermissionKey } from "@/features/auth/types";

const metaInputClassName =
  "h-8 w-full min-w-[7rem] rounded border border-slate-300 bg-white px-2 text-sm outline-none ring-primary-green/30 focus:ring-2 disabled:cursor-not-allowed disabled:bg-slate-50";

interface AdminIpsPermissionsTableProps {
  groupedIps: [string, IpPermissionRecord[]][];
  collapsedGroups: Set<string>;
  onToggleGroup: (grupo: string) => void;
  getPermValue: (ip: IpPermissionRecord, key: PermissionKey) => boolean;
  onPermChange: (id: number, key: PermissionKey, value: boolean) => void;
  getMetaValue: (
    ip: IpPermissionRecord,
    field: keyof IpMetaDraft,
  ) => string;
  onMetaChange: (
    id: number,
    field: keyof IpMetaDraft,
    value: string,
  ) => void;
  onSave: (ip: IpPermissionRecord) => void;
  onToggleActive: (ip: IpPermissionRecord) => void;
  onDelete: (ip: IpPermissionRecord) => void;
  savingId: number | null;
  togglingId: number | null;
  deletingId: number | null;
}

export function AdminIpsPermissionsTable({
  groupedIps,
  collapsedGroups,
  onToggleGroup,
  getPermValue,
  onPermChange,
  getMetaValue,
  onMetaChange,
  onSave,
  onToggleActive,
  onDelete,
  savingId,
  togglingId,
  deletingId,
}: AdminIpsPermissionsTableProps) {
  const totalColumns =
    4 + CONTEXT_PERMISSION_COLUMNS.length + SIDEBAR_PERMISSION_COLUMNS.length + 1;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1400px] border-collapse text-sm">
        <thead className="sticky top-0 z-[5] bg-slate-50">
          <tr>
            <th className="border-b-2 border-slate-200 px-2 py-3 text-left pl-5 font-semibold uppercase text-slate-600">
              IP
            </th>
            <th className="border-b-2 border-slate-200 px-2 py-3 text-left font-semibold uppercase text-slate-600">
              Descrição
            </th>
            <th className="min-w-[140px] border-b-2 border-slate-200 px-2 py-3 text-left font-semibold uppercase text-slate-600">
              Grupo
            </th>
            <th className="w-[100px] border-b-2 border-slate-200 px-2 py-3 text-center font-semibold uppercase text-slate-600">
              Status
            </th>
            <th
              colSpan={CONTEXT_PERMISSION_COLUMNS.length}
              className="border-b border-slate-200 px-1 py-2 text-center text-[0.7rem] font-semibold uppercase text-primary-green"
            >
              Menu de Contexto
            </th>
            <th
              colSpan={SIDEBAR_PERMISSION_COLUMNS.length}
              className="border-b border-slate-200 px-1 py-2 text-center text-[0.7rem] font-semibold uppercase text-primary-green"
            >
              Sidebar
            </th>
            <th className="w-[130px] border-b-2 border-slate-200 px-2 py-3 text-center font-semibold uppercase text-slate-600">
              Ações
            </th>
          </tr>
          <tr>
            <th className="border-b-2 border-slate-200" />
            <th className="border-b-2 border-slate-200" />
            <th className="border-b-2 border-slate-200" />
            <th className="border-b-2 border-slate-200" />
            {ALL_PERMISSION_COLUMNS.map((col) => (
              <th
                key={col.key}
                title={col.title}
                className="border-b-2 border-slate-200 px-1 py-2 text-center text-[0.75rem] font-semibold uppercase text-slate-600"
              >
                {col.label}
              </th>
            ))}
            <th className="border-b-2 border-slate-200" />
          </tr>
        </thead>

        {groupedIps.map(([grupo, ips]) => {
          const collapsed = collapsedGroups.has(grupo);
          return (
            <tbody key={grupo}>
              <tr>
                <td colSpan={totalColumns} className="p-0">
                  <button
                    type="button"
                    onClick={() => onToggleGroup(grupo)}
                    className="flex w-full items-center justify-between border-l-4 border-primary-green bg-slate-200/80 px-5 py-3 text-left font-bold text-slate-700 transition hover:bg-slate-300/80"
                  >
                    <span className="flex items-center gap-2">
                      <FolderOpen className="size-4 text-primary-green" aria-hidden />
                      {grupo}
                    </span>
                    <span className="flex items-center gap-2 text-sm font-normal">
                      <span className="rounded-full bg-white px-2 py-0.5 text-xs text-slate-500">
                        {ips.length} IP{ips.length !== 1 ? "s" : ""}
                      </span>
                      <ChevronDown
                        className={cn(
                          "size-4 transition-transform",
                          collapsed && "-rotate-90",
                        )}
                        aria-hidden
                      />
                    </span>
                  </button>
                </td>
              </tr>

              {!collapsed
                ? ips.map((ip) => {
                    const active = isIpActive(ip.ativo);
                    const rowBusy =
                      savingId === ip.id ||
                      togglingId === ip.id ||
                      deletingId === ip.id;

                    return (
                      <tr
                        key={ip.id}
                        className="border-b border-slate-100 hover:bg-slate-50"
                      >
                        <td className="px-2 py-2 pl-5">
                          <input
                            type="text"
                            value={getMetaValue(ip, "ip")}
                            onChange={(e) =>
                              onMetaChange(ip.id, "ip", e.target.value)
                            }
                            disabled={rowBusy}
                            title="Endereço IP"
                            aria-label={`IP do registro ${ip.id}`}
                            className={cn(metaInputClassName, "font-semibold")}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={getMetaValue(ip, "descricao")}
                            onChange={(e) =>
                              onMetaChange(ip.id, "descricao", e.target.value)
                            }
                            disabled={rowBusy}
                            title="Descrição"
                            aria-label={`Descrição do IP ${ip.ip}`}
                            placeholder="Descrição"
                            className={metaInputClassName}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <input
                            type="text"
                            value={getMetaValue(ip, "grupo")}
                            onChange={(e) =>
                              onMetaChange(ip.id, "grupo", e.target.value)
                            }
                            disabled={rowBusy}
                            title="Grupo/Sala"
                            aria-label={`Grupo do IP ${ip.ip}`}
                            placeholder="Sem Grupo"
                            className={metaInputClassName}
                          />
                        </td>
                        <td className="px-2 py-3 text-center">
                          <span
                            className={cn(
                              "inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold",
                              active
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-red-100 text-red-800",
                            )}
                          >
                            {active ? "Ativo" : "Inativo"}
                          </span>
                        </td>

                        {ALL_PERMISSION_COLUMNS.map((col) => (
                          <td key={col.key} className="px-1 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={getPermValue(ip, col.key)}
                              onChange={(e) =>
                                onPermChange(ip.id, col.key, e.target.checked)
                              }
                              disabled={rowBusy}
                              title={col.title}
                              className="size-[18px] cursor-pointer accent-primary-green disabled:cursor-not-allowed"
                            />
                          </td>
                        ))}

                        <td className="px-2 py-3">
                          <div className="flex items-center justify-center gap-1">
                            <button
                              type="button"
                              onClick={() => onSave(ip)}
                              disabled={rowBusy}
                              title="Salvar"
                              className="inline-flex items-center justify-center rounded bg-primary-green px-2.5 py-1.5 text-white transition hover:bg-primary-green/90 disabled:opacity-60"
                            >
                              {savingId === ip.id ? (
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                              ) : (
                                <Save className="size-4" aria-hidden />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => onToggleActive(ip)}
                              disabled={rowBusy}
                              title={active ? "Desativar" : "Ativar"}
                              className="inline-flex items-center justify-center rounded bg-amber-400 px-2.5 py-1.5 text-black transition hover:bg-amber-500 disabled:opacity-60"
                            >
                              {togglingId === ip.id ? (
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                              ) : active ? (
                                <ToggleRight className="size-4" aria-hidden />
                              ) : (
                                <ToggleLeft className="size-4" aria-hidden />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => onDelete(ip)}
                              disabled={rowBusy}
                              title="Excluir"
                              className="inline-flex items-center justify-center rounded bg-sagra-danger px-2.5 py-1.5 text-white transition hover:bg-red-700 disabled:opacity-60"
                            >
                              {deletingId === ip.id ? (
                                <Loader2 className="size-4 animate-spin" aria-hidden />
                              ) : (
                                <Trash2 className="size-4" aria-hidden />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                : null}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

export function buildUpdatePayloadFromDraft(
  ip: IpPermissionRecord,
  permDraft: Partial<Record<PermissionKey, boolean>> | undefined,
  metaDraft: IpMetaDraft | undefined,
): IpPermissionUpdatePayload {
  const nextIp = (metaDraft?.ip ?? ip.ip).trim();
  const nextDescricao = (metaDraft?.descricao ?? ip.descricao ?? "").trim();
  const nextGrupo =
    (metaDraft?.grupo ?? ip.grupo ?? "").trim() || "Sem Grupo";

  const payload: IpPermissionUpdatePayload = {
    id: ip.id,
    ip: nextIp,
    descricao: nextDescricao,
    grupo: nextGrupo,
  };

  for (const col of ALL_PERMISSION_COLUMNS) {
    payload[col.key] =
      permDraft?.[col.key] !== undefined
        ? permDraft[col.key]!
        : readPermissionValue(ip, col.key);
  }
  return payload;
}
