import type { PermissionKey } from "@/features/auth/types";
import type { OsSearchRow } from "./types";

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
    label: "Abrir Pasta de Rede",
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
