import { cn } from "@sagra/ui";
import { FileSpreadsheet, FileText, Loader2 } from "lucide-react";

import { AVAILABLE_FIELDS } from "../constants";
import type { ReportFormat } from "../types";

interface RelatorioColumnsPanelProps {
  fieldSelection: Record<string, boolean>;
  onToggleField: (fieldId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean) => void;
  previewCount: number | null;
  previewLoading: boolean;
  previewError: string | null;
  generatingFormat: ReportFormat | null;
  onExportExcel: () => void;
  onGeneratePdf: () => void;
}

export function RelatorioColumnsPanel({
  fieldSelection,
  onToggleField,
  onToggleAll,
  previewCount,
  previewLoading,
  previewError,
  generatingFormat,
  onExportExcel,
  onGeneratePdf,
}: RelatorioColumnsPanelProps) {
  const previewText = previewError
    ? previewError
    : previewCount != null
      ? `${previewCount} registros encontrados com os filtros atuais.`
      : previewLoading
        ? "Contando registros..."
        : "0 registros encontrados com os filtros atuais.";

  return (
    <section className="flex flex-col rounded-lg border border-sagra-border bg-white shadow-sm md:min-h-0 md:flex-1 md:overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-sagra-border px-3 py-2">
        <h2 className="text-sm font-semibold text-secondary-blue">
          Configuração de Colunas do Relatório
        </h2>
        <div className="text-xs text-secondary-blue">
          <button
            type="button"
            className="underline hover:no-underline"
            onClick={() => onToggleAll(true)}
          >
            Marcar Todos
          </button>
          <span className="mx-1">|</span>
          <button
            type="button"
            className="underline hover:no-underline"
            onClick={() => onToggleAll(false)}
          >
            Desmarcar Todos
          </button>
        </div>
      </div>

      <div className="p-2 md:min-h-0 md:flex-1 md:overflow-y-auto">
        <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,140px),1fr))] gap-2 sm:grid-cols-[repeat(auto-fill,minmax(180px,1fr))] md:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
          {AVAILABLE_FIELDS.map((group) => (
            <div key={group.category} className="contents">
              <div
                className="col-span-full border-b border-slate-200 pb-1 pt-2 text-sm font-bold text-primary-green"
              >
                {group.category}
              </div>
              {group.fields.map((field) => (
                <label
                  key={field.id}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded border border-slate-100 px-2 py-1.5 text-sm hover:bg-slate-50",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={Boolean(fieldSelection[field.id])}
                    onChange={(e) => onToggleField(field.id, e.target.checked)}
                    className="accent-primary-green"
                  />
                  <span>{field.label}</span>
                </label>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 flex-col gap-3 border-t border-sagra-border bg-slate-50 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
        <span
          className={cn(
            "flex min-w-0 items-center gap-2 text-sm font-semibold",
            previewError ? "text-red-700" : "text-neutral-600",
          )}
        >
          {previewLoading && previewCount != null ? (
            <Loader2 className="size-3.5 shrink-0 animate-spin text-neutral-500" aria-hidden />
          ) : null}
          <span className="min-w-0 break-words">{previewText}</span>
        </span>
        <div className="flex w-full shrink-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:justify-end">
          <button
            type="button"
            disabled={generatingFormat != null}
            onClick={onExportExcel}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold text-white shadow-sm sm:w-auto sm:py-1.5",
              "bg-[#217346] hover:bg-[#1e6b41] disabled:opacity-60",
            )}
          >
            {generatingFormat === "xlsx" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileSpreadsheet className="size-3.5" />
            )}
            Exportar Excel
          </button>
          <button
            type="button"
            disabled={generatingFormat != null}
            onClick={onGeneratePdf}
            className={cn(
              "flex w-full items-center justify-center gap-1.5 rounded-lg bg-secondary-blue px-3 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-90 disabled:opacity-60 sm:w-auto sm:py-1.5",
            )}
          >
            {generatingFormat === "html" ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <FileText className="size-3.5" />
            )}
            Gerar PDF
          </button>
        </div>
      </div>
    </section>
  );
}
