import { cn } from "@sagra/ui";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  File,
  FileImage,
  FileText,
  Folder,
  FolderInput,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useOsPathMutation } from "@/api/hooks/useOsPath";
import {
  fetchOsFolderBrowse,
  osFolderFileUrl,
  type OsFolderBrowseEntry,
} from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { useAccessControl } from "@/features/auth/useAccessControl";
import { tryOpenFileLocally } from "@/lib/sagraLocalOpener";
import { openNetworkFolder } from "../osFolderActions";
import {
  isOriginalFolderName,
  isPreviewableFileName,
  joinOsAbsolutePath,
} from "../osOriginalFolders";

interface OsOriginalFilesPanelProps {
  ano: number | null;
  osId: number | null;
  className?: string;
}

interface FolderTreeNode {
  entry: OsFolderBrowseEntry;
  children: FolderTreeNode[] | null;
  loading: boolean;
  error: string | null;
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") {
    return FileText;
  }
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"].includes(ext)) {
    return FileImage;
  }
  return File;
}

function buildTreeNodes(entries: OsFolderBrowseEntry[]): FolderTreeNode[] {
  return entries.map((entry) => ({
    entry,
    children: entry.type === "folder" ? null : [],
    loading: false,
    error: null,
  }));
}

function updateTreeNode(
  nodes: FolderTreeNode[],
  relative: string,
  updater: (node: FolderTreeNode) => FolderTreeNode,
): FolderTreeNode[] {
  return nodes.map((node) => {
    if (node.entry.relative === relative) {
      return updater(node);
    }
    if (node.children && node.children.length > 0) {
      return {
        ...node,
        children: updateTreeNode(node.children, relative, updater),
      };
    }
    return node;
  });
}

function findTreeNode(
  nodes: FolderTreeNode[],
  relative: string,
): FolderTreeNode | null {
  for (const node of nodes) {
    if (node.entry.relative === relative) {
      return node;
    }
    if (node.children) {
      const found = findTreeNode(node.children, relative);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export function OsOriginalFilesPanel({
  ano,
  osId,
  className,
}: OsOriginalFilesPanelProps) {
  const { can } = useAccessControl();
  const canOpenOsFolder = can("ctx_abrir_pasta");
  const canMoveFolders = can("ctx_mover_pastas");
  const pathMutation = useOsPathMutation();
  const enabled = ano != null && osId != null && ano > 0 && osId > 0;

  const [tree, setTree] = useState<FolderTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<OsFolderBrowseEntry | null>(null);
  const [opening, setOpening] = useState(false);
  const [openingFolder, setOpeningFolder] = useState(false);

  const rootQuery = useQuery({
    queryKey:
      enabled && ano != null && osId != null
        ? queryKeys.os.folderBrowse(ano, osId, "")
        : ["os", "folderBrowse", "original-idle"],
    queryFn: () => fetchOsFolderBrowse(ano!, osId!, ""),
    enabled,
  });

  useEffect(() => {
    if (!enabled || !rootQuery.data || rootQuery.data.error) {
      setTree([]);
      setExpanded(new Set());
      setSelected(null);
      return;
    }
    const originals = rootQuery.data.entries.filter(
      (entry) => entry.type === "folder" && isOriginalFolderName(entry.name),
    );
    setTree(buildTreeNodes(originals));
    setExpanded(new Set());
    setSelected(null);
  }, [enabled, rootQuery.data]);

  const loadFolderChildren = useCallback(
    async (relative: string) => {
      if (ano == null || osId == null) {
        return;
      }
      setTree((prev) =>
        updateTreeNode(prev, relative, (node) => ({
          ...node,
          loading: true,
          error: null,
        })),
      );
      try {
        const data = await fetchOsFolderBrowse(ano, osId, relative);
        if (data.error) {
          setTree((prev) =>
            updateTreeNode(prev, relative, (node) => ({
              ...node,
              loading: false,
              error: data.error ?? "Erro ao carregar pasta.",
              children: [],
            })),
          );
          return;
        }
        setTree((prev) =>
          updateTreeNode(prev, relative, (node) => ({
            ...node,
            loading: false,
            error: null,
            children: buildTreeNodes(data.entries),
          })),
        );
      } catch (e) {
        setTree((prev) =>
          updateTreeNode(prev, relative, (node) => ({
            ...node,
            loading: false,
            error:
              e instanceof Error ? e.message : "Falha ao carregar subpasta.",
            children: [],
          })),
        );
      }
    },
    [ano, osId],
  );

  const toggleFolder = useCallback(
    async (relative: string) => {
      const isExpanded = expanded.has(relative);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (isExpanded) {
          next.delete(relative);
        } else {
          next.add(relative);
        }
        return next;
      });
      if (isExpanded) {
        return;
      }
      const node = findTreeNode(tree, relative);
      if (node?.children === null) {
        await loadFolderChildren(relative);
      }
    },
    [expanded, loadFolderChildren, tree],
  );

  const previewUrl = useMemo(() => {
    if (!selected || ano == null || osId == null) {
      return null;
    }
    if (!isPreviewableFileName(selected.name)) {
      return null;
    }
    return osFolderFileUrl(ano, osId, selected.relative);
  }, [ano, osId, selected]);

  const handleOpen = async () => {
    if (!selected || ano == null || osId == null) {
      return;
    }
    setOpening(true);
    try {
      const root = rootQuery.data?.root_path ?? "";
      const abs = joinOsAbsolutePath(root, selected.relative);
      const localOk = root ? await tryOpenFileLocally(abs) : false;
      if (localOk) {
        return;
      }
      if (isPreviewableFileName(selected.name)) {
        window.open(
          osFolderFileUrl(ano, osId, selected.relative),
          "_blank",
          "noopener",
        );
        return;
      }
      window.alert(
        "Não foi possível abrir este arquivo. Com o SAGRA Folder Opener em execução, PDF e imagens abrem no programa correspondente; outros tipos não podem ser abertos no navegador.",
      );
    } finally {
      setOpening(false);
    }
  };

  const handleOpenOsFolder = async () => {
    if (!enabled || ano == null || osId == null || !canOpenOsFolder) {
      return;
    }
    setOpeningFolder(true);
    try {
      await openNetworkFolder({ ano, nr_os: osId }, (input) =>
        pathMutation.mutateAsync(input),
      );
    } finally {
      setOpeningFolder(false);
    }
  };

  const handleMoveFolders = () => {
    if (!enabled || !canMoveFolders) {
      return;
    }
    window.dispatchEvent(new CustomEvent("sagra:os-mover-pastas"));
  };

  const folderMissing = Boolean(rootQuery.data?.error || !rootQuery.data?.root_path);
  const isPdf = selected ? selected.name.toLowerCase().endsWith(".pdf") : false;
  const isImage = selected
    ? isPreviewableFileName(selected.name) && !isPdf
    : false;

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 overflow-hidden rounded-md border border-slate-200 bg-white",
        className,
      )}
    >
      <section
        className="flex min-w-0 flex-1 flex-col border-r border-slate-200"
        aria-label="Pastas Original"
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-2.5 py-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Pastas Original
          </span>
          <div className="flex shrink-0 items-center gap-1">
            {canMoveFolders ? (
              <button
                type="button"
                onClick={handleMoveFolders}
                disabled={!enabled}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-secondary-blue/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-secondary-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FolderInput className="size-3" aria-hidden />
                Mover pastas
              </button>
            ) : null}
            {canOpenOsFolder ? (
              <button
                type="button"
                onClick={() => void handleOpenOsFolder()}
                disabled={!enabled || openingFolder}
                className="inline-flex shrink-0 items-center gap-1 rounded border border-secondary-blue/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-secondary-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {openingFolder ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <FolderOpen className="size-3" aria-hidden />
                )}
                Abrir pasta
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {!enabled ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400">
              Salve a OS para listar as pastas Original.
            </p>
          ) : rootQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-slate-500">
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
              Carregando pastas…
            </div>
          ) : rootQuery.isError ? (
            <p className="px-2 py-6 text-center text-xs text-red-700">
              {rootQuery.error instanceof Error
                ? rootQuery.error.message
                : "Erro ao carregar as pastas da OS."}
            </p>
          ) : folderMissing ? (
            <p className="px-2 py-6 text-center text-xs text-slate-500">
              {rootQuery.data?.error || "Pasta da OS não encontrada na rede."}
            </p>
          ) : tree.length === 0 ? (
            <p className="px-2 py-6 text-center text-xs text-slate-400">
              Nenhuma pasta Original encontrada.
            </p>
          ) : (
            tree.map((node) => (
              <OriginalTreeNodeRow
                key={node.entry.relative}
                node={node}
                depth={0}
                expanded={expanded}
                selectedRelative={selected?.relative ?? ""}
                onToggle={toggleFolder}
                onSelectFile={setSelected}
              />
            ))
          )}
        </div>
      </section>

      <aside
        className="flex w-[42%] min-w-[10.5rem] max-w-[18rem] flex-col bg-slate-50/70"
        aria-label="Pré-visualização do arquivo"
      >
        <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-2.5 py-1.5">
          <p
            className="min-w-0 flex-1 truncate text-xs font-medium text-slate-700"
            title={selected?.name}
          >
            {selected?.name ?? "Selecione um arquivo"}
          </p>
          <button
            type="button"
            onClick={() => void handleOpen()}
            disabled={!selected || opening}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-secondary-blue/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-secondary-blue hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {opening ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : (
              <ExternalLink className="size-3" aria-hidden />
            )}
            Abrir
          </button>
        </div>
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-2">
          {!selected ? (
            <p className="text-center text-[11px] text-slate-400">
              Clique em um arquivo para visualizar.
            </p>
          ) : previewUrl && isPdf ? (
            <iframe
              title={selected.name}
              src={previewUrl}
              className="size-full rounded border border-slate-200 bg-white"
            />
          ) : previewUrl && isImage ? (
            <img
              alt={selected.name}
              src={previewUrl}
              className="max-h-full max-w-full object-contain"
            />
          ) : (
            <p className="px-2 text-center text-[11px] text-slate-500">
              Pré-visualização indisponível para este tipo de arquivo.
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

function OriginalTreeNodeRow({
  node,
  depth,
  expanded,
  selectedRelative,
  onToggle,
  onSelectFile,
}: {
  node: FolderTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedRelative: string;
  onToggle: (relative: string) => void | Promise<void>;
  onSelectFile: (entry: OsFolderBrowseEntry) => void;
}) {
  const { entry, children, loading, error } = node;
  const isFolder = entry.type === "folder";
  const isExpanded = isFolder && expanded.has(entry.relative);
  const isSelected = selectedRelative === entry.relative;
  const Icon = isFolder
    ? isExpanded
      ? FolderOpen
      : Folder
    : fileIcon(entry.name);
  const paddingLeft = depth * 14 + 4;

  return (
    <div>
      <div
        className={cn(
          "flex min-w-0 items-center gap-0.5 rounded-sm py-0.5 pr-1 text-xs",
          isSelected && "bg-[#cce8ff]",
          !isSelected && "hover:bg-[#e5f3ff]",
        )}
        style={{ paddingLeft }}
      >
        {isFolder ? (
          <button
            type="button"
            onClick={() => void onToggle(entry.relative)}
            className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-white/70"
            aria-label={isExpanded ? "Recolher pasta" : "Expandir pasta"}
          >
            {loading ? (
              <Loader2 className="size-3 animate-spin" aria-hidden />
            ) : isExpanded ? (
              <ChevronDown className="size-3.5" aria-hidden />
            ) : (
              <ChevronRight className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="inline-block w-4 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => {
            if (isFolder) {
              void onToggle(entry.relative);
            } else {
              onSelectFile(entry);
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <Icon
            className={cn(
              "size-3.5 shrink-0",
              isFolder ? "text-amber-500" : "text-slate-500",
            )}
            aria-hidden
          />
          <span className="truncate">{entry.name}</span>
        </button>
      </div>
      {isFolder && isExpanded ? (
        <>
          {loading ? (
            <div
              className="flex items-center gap-1.5 py-1 text-[11px] text-slate-500"
              style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}
            >
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Carregando…
            </div>
          ) : error ? (
            <p
              className="py-1 text-[11px] text-red-600"
              style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}
            >
              {error}
            </p>
          ) : children && children.length > 0 ? (
            children.map((child) => (
              <OriginalTreeNodeRow
                key={child.entry.relative}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                selectedRelative={selectedRelative}
                onToggle={onToggle}
                onSelectFile={onSelectFile}
              />
            ))
          ) : (
            <p
              className="py-1 text-[11px] text-slate-400"
              style={{ paddingLeft: `${(depth + 1) * 14 + 22}px` }}
            >
              Pasta vazia
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}
