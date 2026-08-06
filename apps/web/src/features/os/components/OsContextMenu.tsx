import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { useOsPathMutation } from "@/api/hooks/useOsPath";
import { fetchOsPath } from "@/api/os";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { tryOpenFolderLocally } from "@/lib/sagraLocalOpener";
import { gerenciaSearchFromRow } from "../contextMenuActions";
import { normalizeOsSelection } from "../osTableRows";
import { useOsSelectionStore } from "../osSelectionStore";
import type { OsSearchRow } from "../types";

interface OsContextMenuProps {
  row: OsSearchRow;
  children: React.ReactNode;
  onSelectRow: (row: OsSearchRow | null) => void;
}

export function OsRowContextMenu({
  row,
  children,
  onSelectRow,
}: OsContextMenuProps) {
  const navigate = useNavigate();
  const { can, contextMenuForRow, isReady } = useAccessControl();
  const setSelected = useOsSelectionStore((s) => s.setSelected);

  const pathMutation = useOsPathMutation();
  const items = isReady ? contextMenuForRow(row) : [];

  const goGerencia = useCallback(
    (extra?: Record<string, string>) => {
      void navigate({
        to: "/gerencia",
        search: gerenciaSearchFromRow(row, extra),
      });
    },
    [navigate, row],
  );

  const handleAction = useCallback(
    async (actionId: string) => {
      const required: Record<string, Parameters<typeof can>[0]> = {
        new: "ctx_nova_os",
        duplicate: "ctx_duplicar_os",
        edit: "ctx_editar_os",
        details: "ctx_detalhes_os",
        history: "ctx_detalhes_os",
        link: "ctx_vincular_os",
        folder: "ctx_abrir_pasta",
        moveFolders: "ctx_mover_pastas",
        provaWeb: "ctx_prova_web",
        print: "ctx_imprimir_ficha",
        notify: "ctx_detalhes_os",
      };
      const perm = required[actionId];
      if (perm && !can(perm)) {
        window.alert("Você não tem permissão para esta ação.");
        return;
      }

      setSelected(normalizeOsSelection(row));
      onSelectRow(normalizeOsSelection(row));

      switch (actionId) {
        case "new": {
          const papelaria = window.confirm(
            "Deseja criar uma OS de Papelaria?",
          );
          void navigate({
            to: "/gerencia",
            search: {
              action: "new",
              type: papelaria ? "papelaria" : "normal",
            },
          });
          break;
        }
        case "duplicate":
          void navigate({
            to: "/gerencia",
            search: {
              action: "duplicate",
              ano: String(row.ano),
              id: String(row.nr_os),
            },
          });
          break;
        case "edit":
          goGerencia();
          break;
        case "details":
          goGerencia({ modo: "detalhes" });
          break;
        case "history":
          window.dispatchEvent(new CustomEvent("sagra:os-audit-log"));
          break;
        case "link":
          window.dispatchEvent(new CustomEvent("sagra:os-vincular"));
          break;
        case "folder":
          await openNetworkFolder(row, (input) =>
            pathMutation.mutateAsync(input),
          );
          break;
        case "moveFolders":
          window.dispatchEvent(new CustomEvent("sagra:os-mover-pastas"));
          break;
        case "provaWeb":
          openProvaWebTab(row);
          break;
        case "print":
          window.dispatchEvent(new CustomEvent("sagra:os-print-ficha"));
          break;
        case "notify":
          window.dispatchEvent(new CustomEvent("sagra:os-notificar"));
          break;
        default:
          break;
      }
    },
    [can, goGerencia, navigate, onSelectRow, pathMutation, row, setSelected],
  );

  if (items.length === 0) {
    return <>{children}</>;
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuLabel>OS {row.nr_os}/{row.ano}</ContextMenuLabel>
        <ContextMenuSeparator />
        {items.map((item) => (
          <span key={item.id}>
            {item.separatorBefore && <ContextMenuSeparator />}
            <ContextMenuItem onSelect={() => void handleAction(item.id)}>
              {item.label}
            </ContextMenuItem>
          </span>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

function openProvaWebTab(row: OsSearchRow): void {
  const base = import.meta.env.BASE_URL;
  const baseWithSlash = base.endsWith("/") ? base : `${base}/`;
  const url = new URL(
    `${baseWithSlash}prova-web/${row.ano}/${row.nr_os}`,
    window.location.origin,
  ).href;
  // Âncora sintética garante nova ABA na mesma janela (window.open pode virar janela separada).
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

async function openNetworkFolder(
  row: OsSearchRow,
  fetchPath: (input: { ano: number; id: number }) => Promise<{ path: string }> = (
    input,
  ) => fetchOsPath(input.ano, input.id),
): Promise<void> {
  try {
    const { path } = await fetchPath({ ano: row.ano, id: row.nr_os });
    const lower = path.toLowerCase();
    const pathUsable =
      Boolean(path) &&
      !lower.includes("não encontrada") &&
      !lower.startsWith("erro");

    if (pathUsable) {
      const viaLocal = await tryOpenFolderLocally(path);
      if (viaLocal) {
        return;
      }
      await copyToClipboard(path);
    }

    window.dispatchEvent(new CustomEvent("sagra:os-folder-browser"));
  } catch (e) {
    console.error("Erro ao obter pasta da OS:", e);
    window.dispatchEvent(new CustomEvent("sagra:os-folder-browser"));
  }
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
