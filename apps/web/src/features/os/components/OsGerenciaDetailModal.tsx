import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@sagra/ui";
import { Loader2, Pencil, Save, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { queryKeys } from "@/api/query-keys";
import { useAccessControl } from "@/features/auth/useAccessControl";
import {
  GERENCIA_SECTIONS,
  renderGerenciaSection,
  type GerenciaSectionId,
} from "@/features/gerencia/components/GerenciaFormSections";
import { useGerenciaOsEditor } from "@/features/gerencia/hooks/useGerenciaOsEditor";

import type { OsSearchRow } from "../types";

interface OsGerenciaDetailModalProps {
  row: OsSearchRow | null;
  open: boolean;
  onClose: () => void;
}

export function OsGerenciaDetailModal({
  row,
  open,
  onClose,
}: OsGerenciaDetailModalProps) {
  const { can } = useAccessControl();
  const canEdit = can("ctx_editar_os");
  const qc = useQueryClient();

  const [editing, setEditing] = useState(false);
  const [section, setSection] = useState<GerenciaSectionId>("solicitante");

  const search = useMemo(
    () =>
      row
        ? { ano: String(row.ano), id: String(row.nr_os) }
        : { ano: undefined, id: undefined },
    [row],
  );

  const {
    form,
    update,
    techSpec,
    handleTechSpecChange,
    loading,
    saving,
    save,
    dirty,
    resetToSnapshot,
    deputyPhoto,
    fetchDeputadoIfNeeded,
    loadError,
    aux,
  } = useGerenciaOsEditor({
    search,
    enabled: open && row != null,
    readOnly: !editing,
    existingOnly: true,
  });

  useEffect(() => {
    if (!open) {
      setEditing(false);
      setSection("solicitante");
    }
  }, [open]);

  useEffect(() => {
    setEditing(false);
    setSection("solicitante");
  }, [row?.ano, row?.nr_os]);

  const requestClose = useCallback(() => {
    if (editing && dirty) {
      if (
        !window.confirm(
          "Há alterações não salvas. Deseja descartá-las e fechar?",
        )
      ) {
        return;
      }
      resetToSnapshot();
    }
    setEditing(false);
    onClose();
  }, [dirty, editing, onClose, resetToSnapshot]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, requestClose]);

  const handleStartEdit = () => {
    if (!canEdit) return;
    setEditing(true);
  };

  const handleCancelEdit = () => {
    if (dirty) {
      if (!window.confirm("Descartar alterações?")) return;
    }
    resetToSnapshot();
    setEditing(false);
  };

  const handleSave = async () => {
    const result = await save();
    if (!result) return;
    if (result.status === "ok") {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: queryKeys.os.searchPrefix });
      if (row) {
        void qc.invalidateQueries({
          queryKey: queryKeys.os.details(row.ano, row.nr_os),
        });
      }
      window.alert(
        result.message ||
          `OS salva com sucesso! (OS: ${result.id}/${result.ano})`,
      );
    } else {
      window.alert(result.message || "Erro ao salvar OS.");
    }
  };

  if (!open || !row) {
    return null;
  }

  const sectionProps = {
    form,
    update,
    readOnly: !editing,
    layout: "modal" as const,
    categorias: aux.categorias,
    produtos: aux.produtos,
    maquinas: aux.maquinas,
    papeis: aux.papeis,
    cores: aux.cores,
    formatos: aux.formatos,
    techSpec,
    onTechSpecChange: handleTechSpecChange,
    deputyPhoto,
    onSolicitanteBlur: () => void fetchDeputadoIfNeeded(),
  };

  const activeLabel =
    GERENCIA_SECTIONS.find((s) => s.id === section)?.label ?? "";

  return (
    <div
      className="fixed inset-0 z-[10002] flex items-center justify-center bg-black/60 p-3 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="os-gerencia-detail-title"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) requestClose();
      }}
    >
      <div className="relative flex h-[min(84vh,720px)] w-full max-w-5xl min-w-0 flex-col overflow-hidden rounded-lg border-t-4 border-[#24344D] bg-white shadow-xl">
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-sagra-border px-4 py-2.5 sm:px-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                id="os-gerencia-detail-title"
                className="text-lg font-semibold text-secondary-blue"
              >
                OS {row.nr_os}/{row.ano}
              </h3>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide",
                  editing
                    ? "bg-amber-100 text-amber-900"
                    : "bg-slate-100 text-slate-600",
                )}
              >
                {editing ? "Editando" : "Somente leitura"}
              </span>
            </div>
            <p className="mt-0.5 truncate text-sm text-neutral-600">
              {form.val_titulo || row.titulo || "—"}
            </p>
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="shrink-0 text-neutral-500 hover:text-neutral-800"
            aria-label="Fechar"
          >
            <X className="size-5" />
          </button>
        </header>

        <div className="flex min-h-0 min-w-0 flex-1">
          <nav
            className="flex w-40 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-sagra-border bg-slate-50/90 p-1.5 sm:w-44"
            aria-label="Seções da OS"
          >
            {GERENCIA_SECTIONS.map((item) => {
              const active = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSection(item.id)}
                  className={cn(
                    "rounded-md px-2.5 py-2 text-left text-xs font-semibold transition sm:text-sm",
                    active
                      ? "bg-secondary-blue text-white shadow-sm"
                      : "text-slate-700 hover:bg-white hover:text-secondary-blue",
                  )}
                  aria-current={active ? "page" : undefined}
                >
                  {item.label}
                </button>
              );
            })}
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-2">
              <h4 className="text-sm font-bold text-secondary-blue">
                {activeLabel}
              </h4>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3.5 sm:p-4">
              {loading ? (
                <div className="flex items-center justify-center gap-2 py-16 text-neutral-500">
                  <Loader2 className="size-5 animate-spin" aria-hidden />
                  Carregando dados da OS…
                </div>
              ) : loadError ? (
                <p className="py-8 text-center text-sm text-red-600">
                  {loadError}
                </p>
              ) : (
                renderGerenciaSection(section, sectionProps)
              )}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-sagra-border bg-slate-50/80 px-4 py-3 sm:px-5">
          {!editing ? (
            <>
              <button
                type="button"
                onClick={requestClose}
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Fechar
              </button>
              {canEdit ? (
                <button
                  type="button"
                  onClick={handleStartEdit}
                  disabled={loading || !!loadError}
                  className="inline-flex items-center gap-2 rounded-lg bg-secondary-blue px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-secondary-blue/90 disabled:opacity-50"
                >
                  <Pencil className="size-4" aria-hidden />
                  Editar
                </button>
              ) : null}
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={saving}
                className="rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-semibold text-red-700 shadow-sm transition hover:bg-red-50 disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-green px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-primary-green/90 disabled:opacity-60"
              >
                {saving ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Save className="size-4" aria-hidden />
                )}
                Salvar
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
