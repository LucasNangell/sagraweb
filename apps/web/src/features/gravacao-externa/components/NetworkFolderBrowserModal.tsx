import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  ChevronRight,
  File,
  FileImage,
  FileText,
  Folder,
  Home,
  Loader2,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { fetchNetworkBrowse, type NetworkFilePick } from "@/api/networkFiles";
import { isGravacaoExternaFile } from "@/features/gravacao-externa/constants";
import { compareNaturalName } from "@/features/gravacao-externa/utils/plateFilenameUtils";

interface NetworkFolderBrowserModalProps {
  open: boolean;
  title?: string;
  subtitle?: string;
  onClose: () => void;
  onConfirm: (files: NetworkFilePick[]) => void;
}

const BTN_SECONDARY =
  "inline-flex items-center justify-center gap-1.5 rounded-md bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white hover:bg-secondary-blue/90 disabled:cursor-not-allowed disabled:opacity-50";

const BTN_CLEAR =
  "inline-flex items-center justify-center gap-1.5 rounded-md border border-amber-600/50 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50";

const BTN_NAV =
  "inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 hover:border-secondary-blue/40 hover:bg-blue-50 hover:text-secondary-blue disabled:cursor-not-allowed disabled:opacity-40";

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
  if (["tif", "tiff"].includes(ext)) {
    return FileImage;
  }
  return File;
}

function joinRelative(base: string, name: string): string {
  const clean = base.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return clean ? `${clean}/${name}` : name;
}

function parentPath(path: string): string {
  const normalized = path.replace(/[/\\]+$/, "");
  const idx = Math.max(normalized.lastIndexOf("\\"), normalized.lastIndexOf("/"));
  if (idx <= 0) {
    return "";
  }
  // Preserve UNC prefix \\server\share
  if (normalized.startsWith("\\\\") && idx <= 1) {
    return "";
  }
  const parent = normalized.slice(0, idx);
  // UNC root like \\server\share — going up leaves \\server which is invalid; treat as top
  if (parent.startsWith("\\\\")) {
    const parts = parent.replace(/^\\\\/, "").split(/[/\\]/).filter(Boolean);
    if (parts.length < 2) {
      return "";
    }
  }
  return parent || "";
}

function normPathKey(path: string): string {
  return path.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

export function NetworkFolderBrowserModal({
  open,
  title = "Selecionar arquivos na rede",
  subtitle = "Marque os arquivos PDF ou TIF que serão utilizados.",
  onClose,
  onConfirm,
}: NetworkFolderBrowserModalProps) {
  const [relative, setRelative] = useState("");
  const [picks, setPicks] = useState<NetworkFilePick[]>([]);
  const [fileFilter, setFileFilter] = useState("");

  const browseQuery = useQuery({
    queryKey: ["networkBrowse", relative],
    queryFn: () => fetchNetworkBrowse(relative),
    enabled: open,
  });

  useEffect(() => {
    if (!open) {
      setRelative("");
      setPicks([]);
      setFileFilter("");
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFileFilter("");
  }, [relative, open]);

  const breadcrumbParts = useMemo(() => {
    const current = browseQuery.data?.current_path;
    const root = browseQuery.data?.root_path;
    if (current && root) {
      const normCurrent = current.replace(/\\/g, "/");
      const normRoot = root.replace(/\\/g, "/").replace(/\/$/, "");
      if (normCurrent === normRoot) {
        return [];
      }
      if (normCurrent.startsWith(`${normRoot}/`)) {
        return normCurrent.slice(normRoot.length + 1).split("/").filter(Boolean);
      }
    }
    if (!relative) {
      return [];
    }
    return relative.replace(/\\/g, "/").split("/").filter(Boolean);
  }, [browseQuery.data?.current_path, browseQuery.data?.root_path, relative]);

  const rootName = useMemo(() => {
    if (!relative && !browseQuery.data?.current_path) {
      return "Rede";
    }
    const root = browseQuery.data?.root_path;
    if (!root) {
      return "Rede";
    }
    return root.split(/[/\\]/).filter(Boolean).pop() ?? "Rede";
  }, [browseQuery.data?.current_path, browseQuery.data?.root_path, relative]);

  const atRootsList = !relative;
  const canGoHome = !atRootsList;
  const canGoBack = !atRootsList;

  const goHome = useCallback(() => {
    setRelative("");
  }, []);

  const goBack = useCallback(() => {
    if (!relative) {
      return;
    }
    const current = browseQuery.data?.current_path ?? "";
    const root = browseQuery.data?.root_path ?? "";
    if (current && root && normPathKey(current) === normPathKey(root)) {
      setRelative("");
      return;
    }
    if (current) {
      const parent = parentPath(current);
      if (!parent || (root && normPathKey(parent) === normPathKey(root))) {
        // Parent is the browse root folder itself — navigate to that root path
        if (root && parent && normPathKey(parent) === normPathKey(root)) {
          setRelative(root);
          return;
        }
        setRelative(root || "");
        return;
      }
      setRelative(parent);
      return;
    }
    setRelative("");
  }, [browseQuery.data?.current_path, browseQuery.data?.root_path, relative]);

  const togglePick = useCallback(
    (entryName: string, currentPath: string) => {
      if (!isGravacaoExternaFile(entryName)) {
        window.alert("Selecione apenas arquivos PDF ou TIF.");
        return;
      }
      const absolute_path = currentPath;
      setPicks((prev) => {
        const exists = prev.some((p) => p.absolute_path === absolute_path);
        if (exists) {
          return prev.filter((p) => p.absolute_path !== absolute_path);
        }
        return [...prev, { absolute_path, nome: entryName }];
      });
    },
    [],
  );

  const confirmPicks = useCallback(() => {
    if (picks.length === 0) {
      window.alert("Selecione ao menos um arquivo PDF ou TIF.");
      return;
    }
    onConfirm(picks);
  }, [onConfirm, picks]);

  const entries = browseQuery.data?.entries ?? [];
  const currentPath = browseQuery.data?.current_path ?? "";

  const filterNorm = fileFilter.trim().toLowerCase();

  useEffect(() => {
    setPicks((prev) => (prev.length > 0 ? [] : prev));
  }, [filterNorm]);

  const filteredEntries = useMemo(() => {
    const base = filterNorm
      ? entries.filter((entry) => entry.name.toLowerCase().includes(filterNorm))
      : entries;
    // Pastas primeiro; depois ordem natural por nome.
    return [...base].sort((a, b) => {
      const aDir = a.type === "dir" ? 0 : 1;
      const bDir = b.type === "dir" ? 0 : 1;
      if (aDir !== bDir) return aDir - bDir;
      return compareNaturalName(a.name, b.name);
    });
  }, [entries, filterNorm]);

  const pickableFilteredFiles = useMemo(
    () =>
      filteredEntries.filter(
        (entry) => entry.type === "file" && isGravacaoExternaFile(entry.name),
      ),
    [filteredEntries],
  );

  const selectAllFiltered = useCallback(() => {
    if (pickableFilteredFiles.length === 0) {
      return;
    }
    setPicks((prev) => {
      const byPath = new Map(prev.map((p) => [p.absolute_path, p]));
      for (const entry of pickableFilteredFiles) {
        const absolute_path = `${currentPath.replace(/[/\\]+$/, "")}\\${entry.name}`;
        byPath.set(absolute_path, { absolute_path, nome: entry.name });
      }
      return Array.from(byPath.values());
    });
  }, [currentPath, pickableFilteredFiles]);

  const clearSelection = useCallback(() => {
    setPicks([]);
  }, []);

  if (!open) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[10005] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="flex h-[min(88vh,720px)] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-[#f3f3f3] shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-300 bg-white px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-base font-semibold text-secondary-blue">{title}</h3>
            <p className="mt-0.5 truncate text-xs text-slate-500">{subtitle}</p>
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
          <button
            type="button"
            onClick={goBack}
            disabled={!canGoBack}
            className={BTN_NAV}
            title="Voltar"
            aria-label="Voltar uma pasta"
          >
            <ArrowLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={goHome}
            disabled={!canGoHome}
            className={BTN_NAV}
            title="Início"
            aria-label="Ir para o início (lista de raízes)"
          >
            <Home className="size-4" />
          </button>
          <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            Endereço
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700">
            <button
              type="button"
              className="truncate hover:text-secondary-blue"
              onClick={() => setRelative("")}
              title={browseQuery.data?.root_path ?? rootName}
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
                    onClick={() => {
                      const root = browseQuery.data?.root_path;
                      if (root) {
                        const joined = `${root.replace(/[/\\]+$/, "")}\\${rel.replace(/\//g, "\\")}`;
                        setRelative(joined);
                      } else {
                        setRelative(rel);
                      }
                    }}
                    title={part}
                  >
                    {part}
                  </button>
                </span>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-300 bg-white px-3 py-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={fileFilter}
              onChange={(e) => setFileFilter(e.target.value)}
              placeholder="Filtrar por nome…"
              className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-2 text-sm"
              aria-label="Filtrar arquivos por nome"
            />
          </div>
          <button
            type="button"
            onClick={clearSelection}
            disabled={picks.length === 0}
            className={BTN_CLEAR}
          >
            Limpar seleção
            {picks.length > 0 ? ` (${picks.length})` : ""}
          </button>
          <button
            type="button"
            onClick={selectAllFiltered}
            disabled={pickableFilteredFiles.length === 0}
            className={BTN_SECONDARY}
          >
            Selecionar tudo
            {filterNorm ? ` (${pickableFilteredFiles.length})` : ""}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-white">
          <div className="grid grid-cols-[40px_minmax(0,1fr)_88px] border-b border-slate-200 bg-[#fafafa] px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span className="text-center">✓</span>
            <span>Nome</span>
            <span className="text-right">Tamanho</span>
          </div>

          {browseQuery.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              Carregando…
            </div>
          ) : browseQuery.isError ? (
            <p className="px-4 py-8 text-center text-sm text-red-700">
              {browseQuery.error instanceof Error
                ? browseQuery.error.message
                : "Erro ao carregar pasta na rede."}
            </p>
          ) : filteredEntries.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-slate-500">
              {filterNorm
                ? "Nenhum item corresponde ao filtro."
                : "Esta pasta está vazia."}
            </p>
          ) : (
            filteredEntries.map((entry) => {
              const Icon = entry.type === "dir" ? Folder : fileIcon(entry.name);
              const canPick =
                entry.type === "file" && isGravacaoExternaFile(entry.name);
              const filePath =
                entry.type === "file"
                  ? `${currentPath.replace(/[/\\]+$/, "")}\\${entry.name}`
                  : "";
              const checked = picks.some((p) => p.absolute_path === filePath);

              if (entry.type === "dir") {
                const nextRel =
                  entry.path ??
                  (currentPath
                    ? `${currentPath.replace(/[/\\]+$/, "")}\\${entry.name}`
                    : joinRelative(relative, entry.name));
                return (
                  <button
                    key={nextRel}
                    type="button"
                    onClick={() => setRelative(nextRel)}
                    className="grid w-full grid-cols-[40px_minmax(0,1fr)_88px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-left text-sm font-medium text-slate-800 hover:bg-[#e8f4fd]"
                  >
                    <span />
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon className="size-4 shrink-0 text-amber-500" aria-hidden />
                      <span className="truncate">{entry.name}</span>
                    </span>
                    <span className="text-right text-xs text-slate-500">Pasta</span>
                  </button>
                );
              }

              return (
                <div
                  key={filePath}
                  className="grid w-full grid-cols-[40px_minmax(0,1fr)_88px] items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-sm"
                >
                  <span className="flex justify-center">
                    {canPick ? (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => togglePick(entry.name, filePath)}
                        aria-label={`Selecionar ${entry.name}`}
                      />
                    ) : (
                      <span className="text-slate-300">—</span>
                    )}
                  </span>
                  <span className="flex min-w-0 items-center gap-2">
                    <Icon className="size-4 shrink-0 text-slate-500" aria-hidden />
                    <span className="truncate">{entry.name}</span>
                  </span>
                  <span className="text-right text-xs tabular-nums text-slate-500">
                    {formatFileSize(entry.size)}
                  </span>
                </div>
              );
            })
          )}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-slate-300 bg-[#fafafa] px-4 py-2">
          <p className="min-w-0 truncate text-xs text-slate-600">
            {picks.length} arquivo(s) selecionado(s)
          </p>
          <div className="flex shrink-0 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center justify-center rounded-md bg-neutral-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmPicks}
              className="inline-flex items-center justify-center rounded-md bg-primary-green px-4 py-1.5 text-sm font-semibold text-white hover:opacity-90"
            >
              Confirmar seleção
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
