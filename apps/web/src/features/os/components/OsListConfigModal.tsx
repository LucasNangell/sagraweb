import { cn } from "@sagra/ui";
import { ArrowDown, ArrowUp, Lock, Plus, X } from "lucide-react";
import { useEffect, useState } from "react";

import { homeTestIds } from "@/lib/testId";
import {
  OS_HOME_TABLE_COLUMN_LABELS,
  OS_HOME_TABLE_DEFAULT_WIDTHS,
  addOsHomeTableColumn,
  defaultOsHomeTableLayout,
  isOsHomeTableColumnRequired,
  removeOsHomeTableColumn,
  shiftOsHomeTableColumn,
  visibleOsHomeTableColumns,
  type OsHomeTableLayout,
} from "../osHomeTableLayout";

interface OsListConfigModalProps {
  open: boolean;
  layout: OsHomeTableLayout;
  onClose: () => void;
  onApply: (layout: OsHomeTableLayout) => void;
}

/** Modal "Configurar lista": campos exibidos, ordem, campos para adicionar e larguras. */
export function OsListConfigModal({ open, layout, onClose, onApply }: OsListConfigModalProps) {
  const [draft, setDraft] = useState<OsHomeTableLayout>(layout);

  useEffect(() => {
    if (open) {
      setDraft(layout);
    }
  }, [open, layout]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const visible = visibleOsHomeTableColumns(draft);
  const available = draft.order.filter((id) => !draft.visibility[id]);

  return (
    <div
      className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="os-list-config-title"
      data-testid={homeTestIds.osListConfigModal}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-lg border-t-4 border-secondary-blue bg-white shadow-xl">
        <div className="flex items-start justify-between gap-2 px-6 pt-5">
          <div>
            <h3 id="os-list-config-title" className="text-lg font-semibold text-secondary-blue">
              Configurar lista
            </h3>
            <p className="mt-1 text-sm text-neutral-600">
              Escolha os campos exibidos e a ordem. As larguras são ajustadas arrastando a
              borda entre as colunas no cabeçalho e acompanham o tamanho da janela.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-neutral-500 hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-6 py-4 sm:grid-cols-2">
          <section aria-labelledby="os-list-config-visible">
            <h4
              id="os-list-config-visible"
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500"
            >
              Campos na lista ({visible.length})
            </h4>
            <ul className="divide-y divide-sagra-border/60 rounded-md border border-sagra-border">
              {visible.map((id, index) => {
                const required = isOsHomeTableColumnRequired(id);
                return (
                  <li
                    key={id}
                    className="flex items-center gap-1 px-2 py-1.5 text-sm"
                    data-testid={homeTestIds.osListConfigVisible(id)}
                  >
                    <span className="min-w-0 flex-1 truncate text-neutral-800">
                      {OS_HOME_TABLE_COLUMN_LABELS[id]}
                    </span>
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-500 hover:bg-slate-100 disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => setDraft((d) => shiftOsHomeTableColumn(d, id, -1))}
                      aria-label={`Mover ${OS_HOME_TABLE_COLUMN_LABELS[id]} para cima`}
                      title="Mover para cima"
                      data-testid={homeTestIds.osListConfigUp(id)}
                    >
                      <ArrowUp className="size-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 text-neutral-500 hover:bg-slate-100 disabled:opacity-30"
                      disabled={index === visible.length - 1}
                      onClick={() => setDraft((d) => shiftOsHomeTableColumn(d, id, 1))}
                      aria-label={`Mover ${OS_HOME_TABLE_COLUMN_LABELS[id]} para baixo`}
                      title="Mover para baixo"
                      data-testid={homeTestIds.osListConfigDown(id)}
                    >
                      <ArrowDown className="size-3.5" />
                    </button>
                    {required ? (
                      <span
                        className="p-1 text-neutral-400"
                        title="Campo obrigatório"
                        aria-label="Campo obrigatório"
                      >
                        <Lock className="size-3.5" />
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="rounded p-1 text-sagra-danger hover:bg-red-50"
                        onClick={() => setDraft((d) => removeOsHomeTableColumn(d, id))}
                        aria-label={`Remover ${OS_HOME_TABLE_COLUMN_LABELS[id]}`}
                        title="Remover da lista"
                        data-testid={homeTestIds.osListConfigRemove(id)}
                      >
                        <X className="size-3.5" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section aria-labelledby="os-list-config-available">
            <h4
              id="os-list-config-available"
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500"
            >
              Campos disponíveis para adicionar ({available.length})
            </h4>
            {available.length === 0 ? (
              <p className="rounded-md border border-dashed border-sagra-border px-3 py-4 text-center text-sm text-neutral-500">
                Todos os campos já estão na lista.
              </p>
            ) : (
              <ul className="divide-y divide-sagra-border/60 rounded-md border border-sagra-border">
                {available.map((id) => (
                  <li key={id} className="flex items-center gap-1 px-2 py-1.5 text-sm">
                    <span className="min-w-0 flex-1 truncate text-neutral-700">
                      {OS_HOME_TABLE_COLUMN_LABELS[id]}
                    </span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-secondary-blue hover:bg-slate-100"
                      onClick={() => setDraft((d) => addOsHomeTableColumn(d, id))}
                      aria-label={`Adicionar ${OS_HOME_TABLE_COLUMN_LABELS[id]}`}
                      data-testid={homeTestIds.osListConfigAdd(id)}
                    >
                      <Plus className="size-3.5" />
                      Adicionar
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sagra-border px-6 py-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={cn("sagra-btn sagra-btn--outline sagra-btn--sm")}
              onClick={() => setDraft(defaultOsHomeTableLayout())}
              data-testid={homeTestIds.osListConfigReset}
            >
              Restaurar padrão
            </button>
            <button
              type="button"
              className="sagra-btn sagra-btn--outline sagra-btn--sm"
              onClick={() =>
                setDraft((d) => ({ ...d, widths: { ...OS_HOME_TABLE_DEFAULT_WIDTHS } }))
              }
              data-testid={homeTestIds.osListConfigResetWidths}
            >
              Redefinir larguras
            </button>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="sagra-btn sagra-btn--outline sagra-btn--md"
              data-testid={homeTestIds.osListConfigCancel}
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => onApply(draft)}
              className="sagra-btn sagra-btn--secondary sagra-btn--md"
              data-testid={homeTestIds.osListConfigApply}
            >
              Aplicar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
