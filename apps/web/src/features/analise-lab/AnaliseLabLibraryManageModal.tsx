import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, Plus, Save, Trash2, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  addProblemaPadrao,
  deleteProblemaPadrao,
  fetchProblemasPadrao,
  updateProblemaPadrao,
} from "@/api/analise";
import { queryKeys } from "@/api/query-keys";
import { AnaliseHtmlEditor } from "@/features/analise/components/AnaliseHtmlEditor";
import type { ProblemaPadrao } from "@/features/analise/types";

import { confirmDiscardUnsavedChanges } from "./analiseLabItemPanelDirty";
import {
  applyProvidenciasToHtml,
  libraryProvidenciaTextsFromDrafts,
  PROVIDENCIA_TIPO_LIVRE,
  seedProvidenciasDraft,
  stripAutorizarDraft,
  type ProvidenciaDraft,
} from "./analiseLabProvidencias";

interface AnaliseLabLibraryManageModalProps {
  open: boolean;
  onClose: () => void;
}

type EditorState = {
  id: number | null;
  titulo: string;
  categoria: string;
  html: string;
  providencias: ProvidenciaDraft[];
};

function emptyEditor(): EditorState {
  return {
    id: null,
    titulo: "",
    categoria: "Geral",
    html: "",
    providencias: seedProvidenciasDraft(""),
  };
}

function fromProblema(p: ProblemaPadrao): EditorState {
  return {
    id: p.ID,
    titulo: p.TituloPT || "",
    categoria: p.Categoria || "Geral",
    html: p.ProbTecHTML || "",
    providencias: seedProvidenciasDraft(p.ProbTecHTML || ""),
  };
}

function editorFingerprint(state: EditorState): string {
  return JSON.stringify({
    id: state.id,
    titulo: state.titulo.trim(),
    categoria: state.categoria.trim(),
    html: state.html,
    providencias: libraryProvidenciaTextsFromDrafts(state.providencias),
  });
}

export function AnaliseLabLibraryManageModal({
  open,
  onClose,
}: AnaliseLabLibraryManageModalProps) {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [editor, setEditor] = useState<EditorState>(emptyEditor);
  const [baseline, setBaseline] = useState(() =>
    editorFingerprint(emptyEditor()),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const libraryQuery = useQuery({
    queryKey: ["problemas-padrao"],
    queryFn: fetchProblemasPadrao,
    enabled: open,
    staleTime: 60_000,
  });

  const dirty = editorFingerprint(editor) !== baseline;

  const filtered = useMemo(() => {
    const list = libraryQuery.data ?? [];
    const term = search.trim().toLowerCase();
    const sorted = [...list].sort((a, b) =>
      (a.TituloPT || "").localeCompare(b.TituloPT || "", "pt-BR"),
    );
    if (!term) return sorted;
    return sorted.filter((item) =>
      (item.TituloPT || "").toLowerCase().includes(term),
    );
  }, [libraryQuery.data, search]);

  useEffect(() => {
    if (!open) {
      setSearch("");
      setEditor(emptyEditor());
      setBaseline(editorFingerprint(emptyEditor()));
      setError(null);
    }
  }, [open]);

  const invalidateLibrary = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ["problemas-padrao"] }),
      qc.invalidateQueries({ queryKey: queryKeys.analise.library }),
    ]);
  };

  const loadItem = (p: ProblemaPadrao) => {
    if (dirty && !confirmDiscardUnsavedChanges()) return;
    const next = fromProblema(p);
    setEditor(next);
    setBaseline(editorFingerprint(next));
    setError(null);
  };

  const startNew = () => {
    if (dirty && !confirmDiscardUnsavedChanges()) return;
    const next = emptyEditor();
    setEditor(next);
    setBaseline(editorFingerprint(next));
    setError(null);
  };

  const requestClose = () => {
    if (dirty && !confirmDiscardUnsavedChanges()) return;
    onClose();
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      const titulo = editor.titulo.trim();
      if (!titulo) throw new Error("Informe o título do problema.");
      const html = applyProvidenciasToHtml(
        editor.html,
        libraryProvidenciaTextsFromDrafts(editor.providencias),
      );
      const payload = {
        titulo,
        html_snapshot: html,
        categoria: editor.categoria.trim() || "Geral",
      };
      if (editor.id == null) {
        return addProblemaPadrao(payload);
      }
      return updateProblemaPadrao(editor.id, payload);
    },
    onSuccess: async (data) => {
      await invalidateLibrary();
      const html = applyProvidenciasToHtml(
        editor.html,
        libraryProvidenciaTextsFromDrafts(editor.providencias),
      );
      const next: EditorState = {
        id: data.id,
        titulo: data.titulo,
        categoria: editor.categoria.trim() || "Geral",
        html,
        providencias: seedProvidenciasDraft(html),
      };
      setEditor(next);
      setBaseline(editorFingerprint(next));
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Erro ao salvar.");
    },
  });

  const duplicateMutation = useMutation({
    mutationFn: async () => {
      const tituloBase = editor.titulo.trim() || "Problema técnico";
      const html = applyProvidenciasToHtml(
        editor.html,
        libraryProvidenciaTextsFromDrafts(editor.providencias),
      );
      return addProblemaPadrao({
        titulo: `${tituloBase} (cópia)`,
        html_snapshot: html,
        categoria: editor.categoria.trim() || "Geral",
      });
    },
    onSuccess: async (data) => {
      await invalidateLibrary();
      const html = applyProvidenciasToHtml(
        editor.html,
        libraryProvidenciaTextsFromDrafts(editor.providencias),
      );
      const next: EditorState = {
        id: data.id,
        titulo: data.titulo,
        categoria: editor.categoria.trim() || "Geral",
        html,
        providencias: seedProvidenciasDraft(html),
      };
      setEditor(next);
      setBaseline(editorFingerprint(next));
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Erro ao duplicar.");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (editor.id == null) throw new Error("Nada para excluir.");
      return deleteProblemaPadrao(editor.id);
    },
    onSuccess: async () => {
      await invalidateLibrary();
      const next = emptyEditor();
      setEditor(next);
      setBaseline(editorFingerprint(next));
      setError(null);
    },
    onError: (e) => {
      setError(e instanceof Error ? e.message : "Erro ao excluir.");
    },
  });

  if (!open) return null;

  const saving =
    busy ||
    saveMutation.isPending ||
    duplicateMutation.isPending ||
    deleteMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-3"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Gerenciar biblioteca de problemas"
        className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-xl"
      >
        <header className="flex items-center justify-between gap-2 border-b border-sagra-border px-3 py-2">
          <h2 className="text-sm font-semibold text-sagra-text">
            Biblioteca de problemas técnicos
          </h2>
          <button
            type="button"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100"
            title="Fechar"
            onClick={requestClose}
          >
            <X className="size-4" aria-hidden />
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <aside className="flex w-full shrink-0 flex-col border-b border-sagra-border md:w-64 md:border-b-0 md:border-r">
            <div className="flex gap-1 border-b border-sagra-border p-2">
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filtrar…"
                className="min-w-0 flex-1 rounded border border-sagra-border px-2 py-1 text-xs"
              />
              <button
                type="button"
                title="Novo item"
                className="inline-flex size-8 items-center justify-center rounded border border-sagra-border text-neutral-700 hover:bg-neutral-50"
                onClick={startNew}
              >
                <Plus className="size-4" aria-hidden />
              </button>
            </div>
            <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto p-1.5">
              {filtered.map((p) => (
                <li key={p.ID}>
                  <button
                    type="button"
                    onClick={() => loadItem(p)}
                    className={
                      editor.id === p.ID
                        ? "w-full truncate rounded bg-primary-green/15 px-1.5 py-1 text-left text-xs font-medium text-neutral-800"
                        : "w-full truncate rounded px-1.5 py-1 text-left text-xs text-neutral-700 hover:bg-neutral-50"
                    }
                    title={p.TituloPT}
                  >
                    {p.TituloPT}
                  </button>
                </li>
              ))}
              {!filtered.length && !libraryQuery.isLoading ? (
                <li className="px-1 text-[11px] text-neutral-400">
                  Nenhum resultado.
                </li>
              ) : null}
            </ul>
          </aside>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 overflow-y-auto p-3 text-sm">
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs text-neutral-600">
                Título
                <input
                  value={editor.titulo}
                  onChange={(e) =>
                    setEditor((prev) => ({ ...prev, titulo: e.target.value }))
                  }
                  className="rounded border border-sagra-border px-2 py-1.5 text-sm"
                  disabled={saving}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-600">
                Categoria
                <input
                  value={editor.categoria}
                  onChange={(e) =>
                    setEditor((prev) => ({
                      ...prev,
                      categoria: e.target.value,
                    }))
                  }
                  className="rounded border border-sagra-border px-2 py-1.5 text-sm"
                  disabled={saving}
                />
              </label>
            </div>

            <div className="flex flex-col gap-1 text-xs text-neutral-600">
              Conteúdo
              <AnaliseHtmlEditor
                html={editor.html}
                itemTitulo={editor.titulo}
                onChange={(html) => setEditor((prev) => ({ ...prev, html }))}
                className="min-h-[160px]"
                readOnly={saving}
              />
            </div>

            <div className="space-y-2 rounded border border-sagra-border bg-neutral-50 p-2 text-xs">
              <h3 className="text-[11px] font-semibold uppercase text-neutral-600">
                Providências padrão
              </h3>
              <ul className="space-y-1.5">
                {editor.providencias.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-start gap-1.5 rounded border border-sagra-border bg-white px-1.5 py-1"
                  >
                    <input
                      type="text"
                      value={row.texto}
                      disabled={saving}
                      className="min-w-0 flex-1 rounded border border-sagra-border px-1.5 py-1 text-[11px] disabled:bg-neutral-50"
                      onChange={(e) => {
                        const texto = e.target.value;
                        setEditor((prev) => ({
                          ...prev,
                          providencias: prev.providencias.map((p) =>
                            p.key === row.key ? { ...p, texto } : p,
                          ),
                        }));
                      }}
                    />
                    <button
                      type="button"
                      className="mt-0.5 text-sagra-danger"
                      disabled={saving}
                      title="Remover"
                      onClick={() =>
                        setEditor((prev) => ({
                          ...prev,
                          providencias: prev.providencias.filter(
                            (p) => p.key !== row.key,
                          ),
                        }))
                      }
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                disabled={saving}
                className="rounded border border-sagra-border bg-white px-2 py-1 text-[11px] hover:bg-neutral-50 disabled:opacity-50"
                onClick={() =>
                  setEditor((prev) => ({
                    ...prev,
                    providencias: stripAutorizarDraft([
                      ...prev.providencias,
                      {
                        key: `new-${Date.now()}`,
                        texto: "",
                        tipo: PROVIDENCIA_TIPO_LIVRE,
                        ordem: prev.providencias.length,
                        selecionada: true,
                        origem: "biblioteca",
                      },
                    ]),
                  }))
                }
              >
                + Providência
              </button>
            </div>

            {error ? (
              <p className="text-xs text-sagra-danger" role="alert">
                {error}
              </p>
            ) : null}
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-sagra-border px-3 py-2">
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              disabled={saving}
              className="inline-flex items-center gap-1 rounded border border-sagra-border px-2 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
              onClick={startNew}
            >
              <Plus className="size-3.5" aria-hidden />
              Novo
            </button>
            <button
              type="button"
              disabled={saving || (!editor.html && !editor.titulo.trim())}
              className="inline-flex items-center gap-1 rounded border border-sagra-border px-2 py-1.5 text-xs hover:bg-neutral-50 disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                duplicateMutation.mutate(undefined, {
                  onSettled: () => setBusy(false),
                });
              }}
            >
              <Copy className="size-3.5" aria-hidden />
              Duplicar
            </button>
            <button
              type="button"
              disabled={saving || editor.id == null}
              className="inline-flex items-center gap-1 rounded border border-sagra-danger/40 px-2 py-1.5 text-xs text-sagra-danger hover:bg-red-50 disabled:opacity-50"
              onClick={() => {
                if (
                  !window.confirm(
                    "Excluir este item da biblioteca? Problemas já registrados nas OS não serão removidos.",
                  )
                ) {
                  return;
                }
                setBusy(true);
                deleteMutation.mutate(undefined, {
                  onSettled: () => setBusy(false),
                });
              }}
            >
              <Trash2 className="size-3.5" aria-hidden />
              Excluir
            </button>
          </div>
          <div className="flex gap-1">
            <button
              type="button"
              className="rounded border border-sagra-border px-3 py-1.5 text-xs hover:bg-neutral-50"
              onClick={requestClose}
              disabled={saving}
            >
              Fechar
            </button>
            <button
              type="button"
              disabled={saving || !editor.titulo.trim()}
              className="inline-flex items-center gap-1 rounded bg-secondary-blue px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              onClick={() => {
                setBusy(true);
                saveMutation.mutate(undefined, {
                  onSettled: () => setBusy(false),
                });
              }}
            >
              <Save className="size-3.5" aria-hidden />
              Salvar
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
