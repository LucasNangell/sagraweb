import type { PermissionKey } from "@/features/auth/types";
import type { GerenciaSearchParams } from "@/features/gerencia/types";

import type { OsSearchRow } from "./types";

export type OsNovaType = "normal" | "papelaria";

export type OsGerenciaModalMode =
  | { kind: "existing" }
  | { kind: "new"; type: OsNovaType }
  | { kind: "duplicate" };

const NOVA_OS_PAPELARIA_CONFIRM = "Deseja criar uma OS de Papelaria?";

export interface OsContextMenuItem {
  id: string;
  label: string;
  permission: PermissionKey;
  /** Ações que exigem linha selecionada */
  requiresRow?: boolean;
  separatorBefore?: boolean;
}

export const OS_CONTEXT_MENU_ITEMS: OsContextMenuItem[] = [
  { id: "new", label: "Nova OS", permission: "ctx_nova_os" },
  {
    id: "duplicate",
    label: "Duplicar OS",
    permission: "ctx_duplicar_os",
    requiresRow: true,
  },
  {
    id: "edit",
    label: "Editar OS",
    permission: "ctx_editar_os",
    requiresRow: true,
  },
  {
    id: "details",
    label: "Detalhes da OS",
    permission: "ctx_detalhes_os",
    requiresRow: true,
  },
  {
    id: "history",
    label: "Histórico",
    permission: "ctx_detalhes_os",
    requiresRow: true,
    separatorBefore: true,
  },
  {
    id: "link",
    label: "Vincular OS",
    permission: "ctx_vincular_os",
    requiresRow: true,
  },
  {
    id: "folder",
    label: "Abrir Pasta",
    permission: "ctx_abrir_pasta",
    requiresRow: true,
  },
  {
    id: "moveFolders",
    label: "Mover Pastas",
    permission: "ctx_mover_pastas",
    requiresRow: true,
  },
  {
    id: "provaWeb",
    label: "Prova WEB",
    permission: "ctx_prova_web",
    requiresRow: true,
    separatorBefore: true,
  },
  {
    id: "print",
    label: "Imprimir Ficha",
    permission: "ctx_imprimir_ficha",
    requiresRow: true,
  },
  {
    id: "separador",
    label: "Separador",
    permission: "ctx_imprimir_separador",
    requiresRow: true,
  },
  {
    id: "orcamento",
    label: "Orçamento",
    permission: "ctx_orcamento",
    requiresRow: true,
  },
  {
    id: "notify",
    label: "Notificar",
    permission: "ctx_detalhes_os",
    requiresRow: true,
  },
];

export function getVisibleContextMenuItems(
  can: (key: PermissionKey) => boolean,
  row: OsSearchRow | null,
): OsContextMenuItem[] {
  return OS_CONTEXT_MENU_ITEMS.filter((item) => {
    if (!can(item.permission)) {
      return false;
    }
    if (item.requiresRow && !row) {
      return false;
    }
    return true;
  });
}

export function gerenciaSearchFromRow(
  row: OsSearchRow | null,
  extra?: Record<string, string>,
): Record<string, string> {
  if (!row) {
    return { ...(extra ?? {}) };
  }
  return {
    ano: String(row.ano),
    id: String(row.nr_os),
    ...(extra ?? {}),
  };
}

export function confirmNovaOsType(): OsNovaType {
  return window.confirm(NOVA_OS_PAPELARIA_CONFIRM) ? "papelaria" : "normal";
}

export function novaOsGerenciaSearch(type: OsNovaType): GerenciaSearchParams {
  return { action: "new", type };
}

export function duplicateOsGerenciaSearch(row: {
  ano: number;
  nr_os: number;
}): GerenciaSearchParams {
  return {
    action: "duplicate",
    ano: String(row.ano),
    id: String(row.nr_os),
  };
}

export function gerenciaSearchForModal(
  row: { ano: number; nr_os: number } | null,
  mode: OsGerenciaModalMode,
): GerenciaSearchParams {
  if (mode.kind === "new") {
    return novaOsGerenciaSearch(mode.type);
  }
  if (!row) {
    return { ano: undefined, id: undefined };
  }
  if (mode.kind === "duplicate") {
    return duplicateOsGerenciaSearch(row);
  }
  return { ano: String(row.ano), id: String(row.nr_os) };
}

export function isGerenciaModalExistingOnly(mode: OsGerenciaModalMode): boolean {
  return mode.kind === "existing";
}

export function gerenciaModalTitle(
  row: { ano: number; nr_os: number } | null,
  mode: OsGerenciaModalMode,
): string {
  if (mode.kind === "new") {
    const t = mode.type === "papelaria" ? "Papelaria" : "Normal";
    return `Nova Ordem de Serviço (${t})`;
  }
  if (mode.kind === "duplicate" && row) {
    return `Nova OS (Cópia de ${row.nr_os}/${row.ano})`;
  }
  if (row) {
    return `OS ${row.nr_os}/${row.ano}`;
  }
  return "Nova Ordem de Serviço";
}
