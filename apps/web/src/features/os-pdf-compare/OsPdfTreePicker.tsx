import { ChevronDown, ChevronRight, FileText, Folder } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { fetchOsFolderBrowse, type OsFolderBrowseEntry } from "@/api/os";

export type AssignSlot = "previous" | "current";

interface TreeNodeState {
  relative: string;
  name: string;
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
  folders: OsFolderBrowseEntry[];
  pdfs: OsFolderBrowseEntry[];
  expanded: boolean;
}

interface OsPdfTreePickerProps {
  ano: number;
  osId: number;
  previousRelative: string | null;
  currentRelative: string | null;
  assignSlot: AssignSlot;
  onAssignSlotChange: (slot: AssignSlot) => void;
  onSelectPdf: (relative: string, name: string) => void;
  onRootPath?: (rootPath: string) => void;
  disabled?: boolean;
}

function isPdf(entry: OsFolderBrowseEntry): boolean {
  return entry.type === "file" && entry.name.toLowerCase().endsWith(".pdf");
}

export function OsPdfTreePicker({
  ano,
  osId,
  previousRelative,
  currentRelative,
  assignSlot,
  onAssignSlotChange,
  onSelectPdf,
  onRootPath,
  disabled,
}: OsPdfTreePickerProps) {
  const [nodes, setNodes] = useState<Record<string, TreeNodeState>>({});

  const loadNode = useCallback(
    async (relative: string): Promise<Pick<TreeNodeState, "folders" | "pdfs" | "error">> => {
      try {
        const data = await fetchOsFolderBrowse(ano, osId, relative);
        if (relative === "" && data.root_path) {
          onRootPath?.(data.root_path);
        }
        if (data.error) {
          return { folders: [], pdfs: [], error: data.error };
        }
        return {
          folders: data.entries.filter((e) => e.type === "folder"),
          pdfs: data.entries.filter(isPdf),
          error: null,
        };
      } catch (err) {
        return {
          folders: [],
          pdfs: [],
          error: err instanceof Error ? err.message : "Falha ao listar pasta.",
        };
      }
    },
    [ano, onRootPath, osId],
  );

  const ensureLoaded = useCallback(
    async (relative: string, name: string, expand = true) => {
      setNodes((prev) => {
        const existing = prev[relative];
        if (existing?.loaded) {
          return {
            ...prev,
            [relative]: { ...existing, expanded: expand || existing.expanded },
          };
        }
        if (existing?.loading) return prev;
        return {
          ...prev,
          [relative]: {
            relative,
            name,
            loading: true,
            loaded: false,
            expanded: true,
            folders: [],
            pdfs: [],
            error: null,
          },
        };
      });

      const loaded = await loadNode(relative);
      setNodes((prev) => ({
        ...prev,
        [relative]: {
          relative,
          name,
          loading: false,
          loaded: true,
          expanded: expand,
          folders: loaded.folders,
          pdfs: loaded.pdfs,
          error: loaded.error,
        },
      }));
    },
    [loadNode],
  );

  useEffect(() => {
    void ensureLoaded("", `OS ${osId}/${ano}`, true);
  }, [ano, osId, ensureLoaded]);

  const toggleFolder = (relative: string, name: string) => {
    const node = nodes[relative];
    if (node?.expanded) {
      setNodes((prev) => ({
        ...prev,
        [relative]: { ...prev[relative], expanded: false },
      }));
      return;
    }
    void ensureLoaded(relative, name, true);
  };

  const renderNode = (relative: string, name: string, depth: number) => {
    const node = nodes[relative];
    const expanded = node?.expanded ?? false;

    return (
      <div key={relative || "root"} className="os-pdf-tree-node">
        <button
          type="button"
          className="os-pdf-tree-folder"
          style={{ paddingLeft: 8 + depth * 14 }}
          disabled={disabled}
          onClick={() => toggleFolder(relative, name)}
        >
          {expanded ? (
            <ChevronDown className="size-3.5 shrink-0" />
          ) : (
            <ChevronRight className="size-3.5 shrink-0" />
          )}
          <Folder className="size-3.5 shrink-0 text-amber-700" />
          <span>{name}</span>
        </button>
        {expanded && node && (
          <div>
            {node.loading && (
              <div
                className="os-pdf-tree-muted"
                style={{ paddingLeft: 28 + depth * 14 }}
              >
                Carregando…
              </div>
            )}
            {node.error && (
              <div
                className="os-pdf-tree-error"
                style={{ paddingLeft: 28 + depth * 14 }}
              >
                {node.error}
              </div>
            )}
            {node.folders.map((folder) =>
              renderNode(folder.relative, folder.name, depth + 1),
            )}
            {node.pdfs.map((pdf) => {
              const isPrev = previousRelative === pdf.relative;
              const isCurr = currentRelative === pdf.relative;
              return (
                <button
                  key={pdf.relative}
                  type="button"
                  className={
                    "os-pdf-tree-file" +
                    (isPrev ? " is-previous" : "") +
                    (isCurr ? " is-current" : "")
                  }
                  style={{ paddingLeft: 28 + depth * 14 }}
                  disabled={disabled}
                  title={pdf.relative}
                  onClick={() => onSelectPdf(pdf.relative, pdf.name)}
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{pdf.name}</span>
                  {isPrev && <span className="os-pdf-tree-badge">A</span>}
                  {isCurr && <span className="os-pdf-tree-badge curr">B</span>}
                </button>
              );
            })}
            {node.loaded &&
              !node.loading &&
              !node.error &&
              node.folders.length === 0 &&
              node.pdfs.length === 0 && (
                <div
                  className="os-pdf-tree-muted"
                  style={{ paddingLeft: 28 + depth * 14 }}
                >
                  Sem PDFs nesta pasta
                </div>
              )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="os-pdf-tree">
      <div className="os-pdf-tree-slot-bar">
        <span>Clique no PDF para atribuir a:</span>
        <div className="os-pdf-tree-slot-toggle">
          <button
            type="button"
            className={assignSlot === "previous" ? "active" : ""}
            disabled={disabled}
            onClick={() => onAssignSlotChange("previous")}
          >
            Versão anterior
          </button>
          <button
            type="button"
            className={assignSlot === "current" ? "active" : ""}
            disabled={disabled}
            onClick={() => onAssignSlotChange("current")}
          >
            Versão atual
          </button>
        </div>
      </div>
      <div className="os-pdf-tree-scroll">
        {nodes[""] ? (
          renderNode("", nodes[""].name, 0)
        ) : (
          <div className="os-pdf-tree-muted">Carregando pasta da OS…</div>
        )}
      </div>
    </div>
  );
}
