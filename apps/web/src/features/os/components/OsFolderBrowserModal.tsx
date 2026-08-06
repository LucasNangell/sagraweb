import { cn } from "@sagra/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  File,
  FileImage,
  FileSpreadsheet,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createOsFolder,
  fetchOsFolderBrowse,
  fetchOsFolderPlan,
  type OsFolderBrowseEntry,
} from "@/api/os";
import { queryKeys } from "@/api/query-keys";
import { formatOsLabel } from "@/lib/format";
import { isGravacaoExternaFile } from "@/features/gravacao-externa/constants";
import {
  confirmCreateOsFolderDialog,
  OsFolderCreatePanel,
} from "./OsFolderCreatePanel";
import type { OsSearchRow } from "../types";

export interface OsFolderPdfPick {
  relative: string;
  name: string;
}

interface OsFolderBrowserModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
  /** Quando definido, permite escolher um PDF (ex.: prova em Sefoc). */
  mode?: "browse" | "pick-pdf" | "pick-gravacao-externa";
  onPickPdf?: (pick: OsFolderPdfPick) => void;
  /** Multi-seleção PDF/TIF para Gravação Externa. */
  onConfirmGravacaoExterna?: (files: OsFolderPdfPick[]) => void;
}

interface FolderTreeNode {
  entry: OsFolderBrowseEntry;
  children: FolderTreeNode[] | null;
  loading: boolean;
  error: string | null;
}

function formatFileSize(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) {
    return "—";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(bytes >= 10 * 1024 ? 0 : 1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function fileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "pdf") {
    return FileText;
  }
  if (["jpg", "jpeg", "png", "gif", "webp", "bmp", "tif", "tiff"].includes(ext)) {
    return FileImage;
  }
  if (["xls", "xlsx", "csv"].includes(ext)) {
    return FileSpreadsheet;
  }
  if (["doc", "docx", "txt", "rtf", "mht", "html", "htm"].includes(ext)) {
    return FileText;
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

export function OsFolderBrowserModal({
  row,
  open,
  onClose,
  mode = "browse",
  onPickPdf,
  onConfirmGravacaoExterna,
}: OsFolderBrowserModalProps) {
  const pickPdfMode = mode === "pick-pdf";
  const pickGravacaoMode = mode === "pick-gravacao-externa";
  const pickMode = pickPdfMode || pickGravacaoMode;
  const queryClient = useQueryClient();
  const ano = row?.ano ?? null;
  const id = row?.nr_os ?? null;

  const [tree, setTree] = useState<FolderTreeNode[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([""]));
  const [selectedRelative, setSelectedRelative] = useState("");
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [createMessage, setCreateMessage] = useState<string | null>(null);
  const [gravacaoPicks, setGravacaoPicks] = useState<OsFolderPdfPick[]>([]);

  const rootQuery = useQuery({
    queryKey:
      open && ano != null && id != null
        ? queryKeys.os.folderBrowse(ano, id, "")
        : ["os", "folderBrowse", "idle"],
    queryFn: () => fetchOsFolderBrowse(ano!, id!, ""),
    enabled: open && ano != null && id != null,
  });

  const folderMissing =
    rootQuery.isSuccess &&
    Boolean(rootQuery.data?.error || !rootQuery.data?.root_path);

  const planQuery = useQuery({
    queryKey:
      open && ano != null && id != null && folderMissing
        ? queryKeys.os.folderPlan(ano, id)
        : ["os", "folderPlan", "idle"],
    queryFn: () => fetchOsFolderPlan(ano!, id!),
    enabled: open && ano != null && id != null && folderMissing,
  });

  const createMutation = useMutation({
    mutationFn: () => createOsFolder(ano!, id!),
    onSuccess: async (result) => {
      setCreateMessage(result.message);
      await queryClient.invalidateQueries({
        queryKey: queryKeys.os.path(ano!, id!),
      });
      await queryClient.invalidateQueries({
        queryKey: ["os", "folderBrowse", ano, id],
      });
      await queryClient.invalidateQueries({
        queryKey: queryKeys.os.folderPlan(ano!, id!),
      });
    },
  });

  const detailQuery = useQuery({
    queryKey:
      open && ano != null && id != null
        ? queryKeys.os.folderBrowse(ano, id, selectedRelative)
        : ["os", "folderBrowse", "detail", "idle"],
    queryFn: () => fetchOsFolderBrowse(ano!, id!, selectedRelative),
    enabled:
      open && ano != null && id != null && rootQuery.isSuccess && !folderMissing,
  });

  useEffect(() => {
    if (!open) {
      setTree([]);
      setExpanded(new Set([""]));
      setSelectedRelative("");
      setCopyHint(null);
      setCreateMessage(null);
      setGravacaoPicks([]);
      return;
    }
    if (!rootQuery.data || rootQuery.data.error) {
      setTree([]);
      return;
    }
    setTree(buildTreeNodes(rootQuery.data.entries));
    setExpanded(new Set([""]));
    setSelectedRelative("");
  }, [open, rootQuery.data]);

  const loadFolderChildren = useCallback(
    async (relative: string) => {
      if (ano == null || id == null) {
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
        const data = await fetchOsFolderBrowse(ano, id, relative);
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
    [ano, id],
  );

  useEffect(() => {
    if (!open || !pickPdfMode || !rootQuery.data?.entries?.length) {
      return;
    }
    const sefoc = rootQuery.data.entries.find(
      (entry) => entry.type === "folder" && entry.name.toLowerCase() === "sefoc",
    );
    if (!sefoc) {
      return;
    }
    setSelectedRelative(sefoc.relative);
    setExpanded((prev) => {
      const next = new Set(prev);
      next.add("");
      next.add(sefoc.relative);
      return next;
    });
    const node = findTreeNode(tree, sefoc.relative);
    if (node?.children === null) {
      void loadFolderChildren(sefoc.relative);
    }
  }, [open, pickPdfMode, rootQuery.data, tree, loadFolderChildren]);

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

  const detailEntries = detailQuery.data?.entries ?? [];
  const detailLoading = detailQuery.isLoading || detailQuery.isFetching;
  const detailError = detailQuery.data?.error ?? null;

  const breadcrumbParts = useMemo(() => {
    if (!selectedRelative) {
      return [];
    }
    return selectedRelative.split("/");
  }, [selectedRelative]);

  const fullSelectedPath = useMemo(() => {
    const root = rootQuery.data?.root_path;
    if (!root) {
      return "";
    }
    if (!selectedRelative) {
      return root;
    }
    return `${root}\\${selectedRelative.replace(/\//g, "\\")}`;
  }, [rootQuery.data?.root_path, selectedRelative]);

  const handleCopyPath = async () => {
    const path = fullSelectedPath || rootQuery.data?.root_path;
    if (!path) {
      return;
    }
    try {
      await navigator.clipboard.writeText(path);
      setCopyHint("Caminho copiado.");
    } catch {
      setCopyHint("Não foi possível copiar o caminho.");
    }
  };

  const handlePickPdfEntry = useCallback(
    (entry: OsFolderBrowseEntry) => {
      if (!pickPdfMode || entry.type !== "file") {
        return;
      }
      if (!entry.name.toLowerCase().endsWith(".pdf")) {
        window.alert("Selecione um arquivo PDF.");
        return;
      }
      const rel = entry.relative.replace(/\\/g, "/");
      if (!rel.toLowerCase().startsWith("sefoc/")) {
        window.alert("O PDF de prova deve estar dentro da pasta Sefoc.");
        return;
      }
      onPickPdf?.({ relative: rel, name: entry.name });
      onClose();
    },
    [onClose, onPickPdf, pickPdfMode],
  );

  const toggleGravacaoPick = useCallback((entry: OsFolderBrowseEntry) => {
    if (!pickGravacaoMode || entry.type !== "file") {
      return;
    }
    if (!isGravacaoExternaFile(entry.name)) {
      window.alert("Selecione apenas arquivos PDF ou TIF.");
      return;
    }
    const rel = entry.relative.replace(/\\/g, "/");
    setGravacaoPicks((prev) => {
      const exists = prev.some((p) => p.relative === rel);
      if (exists) {
        return prev.filter((p) => p.relative !== rel);
      }
      return [...prev, { relative: rel, name: entry.name }];
    });
  }, [pickGravacaoMode]);

  const confirmGravacaoPicks = useCallback(() => {
    if (gravacaoPicks.length === 0) {
      window.alert("Selecione ao menos um arquivo PDF ou TIF.");
      return;
    }
    onConfirmGravacaoExterna?.(gravacaoPicks);
    onClose();
  }, [gravacaoPicks, onClose, onConfirmGravacaoExterna]);

  const handleCreateFolder = async () => {
    if (ano == null || id == null || !row || !planQuery.data) {
      return;
    }
    const plan = planQuery.data;
    if (!confirmCreateOsFolderDialog(formatOsLabel(row), plan)) {
      return;
    }
    setCreateMessage(null);
    try {
      await createMutation.mutateAsync();
    } catch (e) {
      window.alert(
        e instanceof Error ? e.message : "Não foi possível criar a pasta na rede.",
      );
    }
  };

  if (!open || !row) {
    return null;
  }

  const rootName = rootQuery.data?.root_path
    ? rootQuery.data.root_path.split(/[/\\]/).filter(Boolean).pop() ?? "Pasta da OS"
    : planQuery.data?.folder_name ?? "Pasta da OS";

  return (
    <div
      className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={
        pickPdfMode
          ? `Selecionar PDF de prova — OS ${formatOsLabel(row)}`
          : pickGravacaoMode
            ? `Arquivos para Gravação Externa — OS ${formatOsLabel(row)}`
            : `Explorar pasta da OS ${formatOsLabel(row)}`
      }
    >
      <div className="flex h-[min(88vh,720px)] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-[#f3f3f3] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-300 bg-white px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-secondary-blue">
              {pickPdfMode
                ? `Selecionar PDF de prova — OS ${formatOsLabel(row)}`
                : pickGravacaoMode
                  ? `Arquivos para Gravação Externa — OS ${formatOsLabel(row)}`
                  : `Explorar pasta — OS ${formatOsLabel(row)}`}
            </h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {pickPdfMode
                ? "Navegue até a pasta Sefoc e escolha o PDF que será enviado ao cliente."
                : pickGravacaoMode
                  ? "Marque os arquivos PDF ou TIF que serão disponibilizados para gravação externa."
                  : "Serviço local indisponível — visualização via servidor"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-slate-300 bg-[#fafafa] px-3 py-2">
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Endereço
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
            <button
              type="button"
              className="truncate hover:text-secondary-blue"
              onClick={() => setSelectedRelative("")}
              title={rootQuery.data?.root_path ?? rootName}
            >
              {rootName}
            </button>
            {breadcrumbParts.map((part, index) => {
              const rel = breadcrumbParts.slice(0, index + 1).join("/");
              return (
                <span key={rel} className="flex shrink-0 items-center gap-1">
                  <ChevronRight className="size-3 text-slate-400" aria-hidden />
                  <button
                    type="button"
                    className="truncate hover:text-secondary-blue"
                    onClick={() => setSelectedRelative(rel)}
                    title={part}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => void handleCopyPath()}
            className="inline-flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
            title="Copiar caminho"
          >
            <Copy className="size-3.5" aria-hidden />
            Copiar
          </button>
        </div>
        {copyHint ? (
          <p className="border-b border-slate-200 bg-blue-50 px-4 py-1.5 text-xs text-secondary-blue">
            {copyHint}
          </p>
        ) : null}
        {createMessage ? (
          <p className="border-b border-emerald-200 bg-emerald-50 px-4 py-1.5 text-xs font-medium text-emerald-800">
            {createMessage}
          </p>
        ) : null}

        {folderMissing ? (
          <OsFolderCreatePanel
            plan={planQuery.data}
            planLoading={planQuery.isLoading}
            planError={planQuery.error}
            creating={createMutation.isPending}
            onCreate={() => void handleCreateFolder()}
          />
        ) : (
        <div className="flex min-h-0 flex-1">
          <section
            className="flex w-[42%] min-w-[220px] flex-col border-r border-slate-300 bg-white"
            aria-label="Árvore de pastas"
          >
            <div className="border-b border-slate-200 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Pastas
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-1">
              {rootQuery.isLoading ? (
                <div className="flex items-center justify-center gap-2 py-8 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Carregando pasta…
                </div>
              ) : rootQuery.isError ? (
                <p className="px-3 py-6 text-sm text-red-700">
                  {rootQuery.error instanceof Error
                    ? rootQuery.error.message
                    : "Erro ao carregar a pasta da OS."}
                </p>
              ) : rootQuery.data?.error ? (
                <p className="px-3 py-6 text-sm text-red-700">{rootQuery.data.error}</p>
              ) : (
                <FolderTreeList
                  nodes={tree}
                  depth={0}
                  expanded={expanded}
                  selectedRelative={selectedRelative}
                  onToggle={toggleFolder}
                  onSelectFolder={setSelectedRelative}
                  onToggleRoot={() => {
                    setExpanded((prev) => {
                      const next = new Set(prev);
                      if (next.has("")) {
                        next.delete("");
                      } else {
                        next.add("");
                      }
                      return next;
                    });
                  }}
                  rootExpanded={expanded.has("")}
                  rootLabel={rootName}
                  rootSelected={selectedRelative === ""}
                  onSelectRoot={() => setSelectedRelative("")}
                />
              )}
            </div>
          </section>

          <section
            className="flex min-w-0 flex-1 flex-col bg-white"
            aria-label="Conteúdo da pasta selecionada"
          >
            <div
              className={cn(
                "grid border-b border-slate-200 bg-[#fafafa] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500",
                pickPdfMode
                  ? "grid-cols-[minmax(0,1fr)_88px_88px]"
                  : pickGravacaoMode
                    ? "grid-cols-[minmax(0,1fr)_40px_88px]"
                    : "grid-cols-[minmax(0,1fr)_88px]",
              )}
            >
              <span>Nome</span>
              {pickGravacaoMode ? <span className="text-center">✓</span> : null}
              <span className="text-right">Tamanho</span>
              {pickPdfMode ? <span className="text-right">Ação</span> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto">
              {detailLoading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                  Carregando…
                </div>
              ) : detailError ? (
                <p className="px-4 py-8 text-center text-sm text-red-700">{detailError}</p>
              ) : detailEntries.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-slate-500">
                  Esta pasta está vazia.
                </p>
              ) : (
                detailEntries.map((entry) => {
                  const Icon =
                    entry.type === "folder" ? Folder : fileIcon(entry.name);
                  const isPdf =
                    entry.type === "file" && entry.name.toLowerCase().endsWith(".pdf");
                  const canPickPdf =
                    pickPdfMode &&
                    isPdf &&
                    entry.relative.replace(/\\/g, "/").toLowerCase().startsWith("sefoc/");

                  const canPickGravacao =
                    pickGravacaoMode &&
                    entry.type === "file" &&
                    isGravacaoExternaFile(entry.name);
                  const gravacaoRel = entry.relative.replace(/\\/g, "/");
                  const gravacaoChecked = gravacaoPicks.some(
                    (p) => p.relative === gravacaoRel,
                  );

                  const openFolder = () => {
                    setSelectedRelative(entry.relative);
                    setExpanded((prev) => new Set(prev).add(entry.relative));
                    const node = findTreeNode(tree, entry.relative);
                    if (node?.children === null) {
                      void loadFolderChildren(entry.relative);
                    }
                  };

                  if (!pickMode) {
                    return (
                      <button
                        key={entry.relative}
                        type="button"
                        onClick={() => {
                          if (entry.type === "folder") {
                            openFolder();
                          }
                        }}
                        className={cn(
                          "grid w-full grid-cols-[minmax(0,1fr)_88px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-sm hover:bg-[#e8f4fd]",
                          entry.type === "folder" && "font-medium text-slate-800",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              entry.type === "folder"
                                ? "text-amber-500"
                                : "text-slate-500",
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{entry.name}</span>
                        </span>
                        <span className="text-right text-xs tabular-nums text-slate-500">
                          {entry.type === "folder"
                            ? "Pasta"
                            : formatFileSize(entry.size)}
                        </span>
                      </button>
                    );
                  }

                  if (pickGravacaoMode) {
                    return (
                      <div
                        key={entry.relative}
                        className={cn(
                          "grid w-full grid-cols-[minmax(0,1fr)_40px_88px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm",
                          entry.type === "folder" ? "font-medium text-slate-800" : "",
                        )}
                      >
                        <button
                          type="button"
                          onClick={() => {
                            if (entry.type === "folder") {
                              openFolder();
                            }
                          }}
                          className="flex min-w-0 items-center gap-2 text-left hover:text-secondary-blue"
                        >
                          <Icon
                            className={cn(
                              "size-4 shrink-0",
                              entry.type === "folder"
                                ? "text-amber-500"
                                : "text-slate-500",
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{entry.name}</span>
                        </button>
                        <span className="flex justify-center">
                          {canPickGravacao ? (
                            <input
                              type="checkbox"
                              checked={gravacaoChecked}
                              onChange={() => toggleGravacaoPick(entry)}
                              aria-label={`Selecionar ${entry.name}`}
                            />
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </span>
                        <span className="text-right text-xs tabular-nums text-slate-500">
                          {entry.type === "folder"
                            ? "Pasta"
                            : formatFileSize(entry.size)}
                        </span>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={entry.relative}
                      className={cn(
                        "grid w-full grid-cols-[minmax(0,1fr)_88px_88px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm",
                        entry.type === "folder" ? "font-medium text-slate-800" : "",
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          if (entry.type === "folder") {
                            openFolder();
                          } else if (canPickPdf) {
                            handlePickPdfEntry(entry);
                          }
                        }}
                        onDoubleClick={() => {
                          if (canPickPdf) {
                            handlePickPdfEntry(entry);
                          }
                        }}
                        className="flex min-w-0 items-center gap-2 text-left hover:text-secondary-blue"
                      >
                        <Icon
                          className={cn(
                            "size-4 shrink-0",
                            entry.type === "folder"
                              ? "text-amber-500"
                              : "text-slate-500",
                          )}
                          aria-hidden
                        />
                        <span className="truncate">{entry.name}</span>
                      </button>
                      <span className="text-right text-xs tabular-nums text-slate-500">
                        {entry.type === "folder"
                          ? "Pasta"
                          : formatFileSize(entry.size)}
                      </span>
                      <span className="text-right">
                        {canPickPdf ? (
                          <button
                            type="button"
                            onClick={() => handlePickPdfEntry(entry)}
                            className="rounded border border-secondary-blue/40 bg-white px-2 py-0.5 text-[11px] font-semibold text-secondary-blue hover:bg-blue-50"
                          >
                            Selecionar
                          </button>
                        ) : (
                          <span className="text-[11px] text-slate-400">—</span>
                        )}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          </section>
        </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-slate-300 bg-[#fafafa] px-4 py-2">
          <p className="min-w-0 truncate text-xs text-slate-600" title={fullSelectedPath}>
            {pickGravacaoMode
              ? `${gravacaoPicks.length} arquivo(s) selecionado(s)`
              : fullSelectedPath || rootQuery.data?.root_path || "—"}
          </p>
          <div className="flex shrink-0 gap-2">
            {pickGravacaoMode ? (
              <button
                type="button"
                onClick={confirmGravacaoPicks}
                className="rounded bg-primary-green px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
              >
                Confirmar seleção
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="rounded bg-neutral-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700"
            >
              {pickGravacaoMode ? "Cancelar" : "Fechar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FolderTreeListProps {
  nodes: FolderTreeNode[];
  depth: number;
  expanded: Set<string>;
  selectedRelative: string;
  onToggle: (relative: string) => void | Promise<void>;
  onSelectFolder: (relative: string) => void;
  rootExpanded: boolean;
  rootLabel: string;
  rootSelected: boolean;
  onSelectRoot: () => void;
  onToggleRoot: () => void;
}

function FolderTreeList({
  nodes,
  depth,
  expanded,
  selectedRelative,
  onToggle,
  onSelectFolder,
  rootExpanded,
  rootLabel,
  rootSelected,
  onSelectRoot,
  onToggleRoot,
}: FolderTreeListProps) {
  if (depth === 0) {
    return (
      <div>
        <TreeRow
          depth={0}
          label={rootLabel}
          type="folder"
          expanded={rootExpanded}
          selected={rootSelected}
          loading={false}
          onToggle={onToggleRoot}
          onSelect={onSelectRoot}
        />
        {rootExpanded
          ? nodes.map((node) => (
              <FolderTreeNodeRow
                key={node.entry.relative}
                node={node}
                depth={1}
                expanded={expanded}
                selectedRelative={selectedRelative}
                onToggle={onToggle}
                onSelectFolder={onSelectFolder}
              />
            ))
          : null}
      </div>
    );
  }

  return (
    <>
      {nodes.map((node) => (
        <FolderTreeNodeRow
          key={node.entry.relative}
          node={node}
          depth={depth}
          expanded={expanded}
          selectedRelative={selectedRelative}
          onToggle={onToggle}
          onSelectFolder={onSelectFolder}
        />
      ))}
    </>
  );
}

interface FolderTreeNodeRowProps {
  node: FolderTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedRelative: string;
  onToggle: (relative: string) => void | Promise<void>;
  onSelectFolder: (relative: string) => void;
}

function FolderTreeNodeRow({
  node,
  depth,
  expanded,
  selectedRelative,
  onToggle,
  onSelectFolder,
}: FolderTreeNodeRowProps) {
  const { entry, children, loading, error } = node;
  const isFolder = entry.type === "folder";
  const isExpanded = isFolder && expanded.has(entry.relative);
  const isSelected = selectedRelative === entry.relative;
  const Icon = isFolder
    ? isExpanded
      ? FolderOpen
      : Folder
    : fileIcon(entry.name);

  return (
    <div>
      <TreeRow
        depth={depth}
        label={entry.name}
        type={entry.type}
        expanded={isExpanded}
        selected={isSelected}
        loading={loading}
        onToggle={() => {
          if (isFolder) {
            void onToggle(entry.relative);
          }
        }}
        onSelect={() => {
          if (isFolder) {
            onSelectFolder(entry.relative);
          }
        }}
        icon={Icon}
      />
      {isFolder && isExpanded ? (
        <>
          {loading ? (
            <div
              className="flex items-center gap-2 py-1 text-xs text-slate-500"
              style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
            >
              <Loader2 className="size-3 animate-spin" aria-hidden />
              Carregando…
            </div>
          ) : error ? (
            <p
              className="py-1 text-xs text-red-600"
              style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
            >
              {error}
            </p>
          ) : children && children.length > 0 ? (
            children.map((child) =>
              child.entry.type === "folder" ? (
                <FolderTreeNodeRow
                  key={child.entry.relative}
                  node={child}
                  depth={depth + 1}
                  expanded={expanded}
                  selectedRelative={selectedRelative}
                  onToggle={onToggle}
                  onSelectFolder={onSelectFolder}
                />
              ) : (
                <TreeRow
                  key={child.entry.relative}
                  depth={depth + 1}
                  label={child.entry.name}
                  type="file"
                  expanded={false}
                  selected={false}
                  loading={false}
                  onToggle={() => {}}
                  onSelect={() => {}}
                  icon={fileIcon(child.entry.name)}
                />
              ),
            )
          ) : (
            <p
              className="py-1 text-xs text-slate-400"
              style={{ paddingLeft: `${(depth + 1) * 16 + 28}px` }}
            >
              Pasta vazia
            </p>
          )}
        </>
      ) : null}
    </div>
  );
}

interface TreeRowProps {
  depth: number;
  label: string;
  type: "folder" | "file";
  expanded: boolean;
  selected: boolean;
  loading: boolean;
  onToggle: () => void;
  onSelect: () => void;
  icon?: typeof Folder;
}

function TreeRow({
  depth,
  label,
  type,
  expanded,
  selected,
  loading,
  onToggle,
  onSelect,
  icon: Icon = Folder,
}: TreeRowProps) {
  const paddingLeft = depth * 16 + 8;

  return (
    <div
      className={cn(
        "flex min-w-0 items-center gap-0.5 rounded-sm py-0.5 pr-2 text-sm",
        selected && "bg-[#cce8ff]",
        !selected && "hover:bg-[#e5f3ff]",
      )}
      style={{ paddingLeft }}
    >
      {type === "folder" ? (
        <button
          type="button"
          onClick={onToggle}
          className="shrink-0 rounded p-0.5 text-slate-600 hover:bg-white/70"
          aria-label={expanded ? "Recolher pasta" : "Expandir pasta"}
        >
          {loading ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : expanded ? (
            <ChevronDown className="size-3.5" aria-hidden />
          ) : (
            <ChevronRight className="size-3.5" aria-hidden />
          )}
        </button>
      ) : (
        <span className="inline-block w-5 shrink-0" aria-hidden />
      )}
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        disabled={type === "file"}
      >
        <Icon
          className={cn(
            "size-4 shrink-0",
            type === "folder" ? "text-amber-500" : "text-slate-500",
          )}
          aria-hidden
        />
        <span className="truncate">{label}</span>
      </button>
    </div>
  );
}

