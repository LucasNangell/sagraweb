import { useCallback, useMemo, useState } from "react";

import { useReportPreviewCount } from "@/api/hooks/useRelatorioQueries";
import { useSavedFilters } from "@/api/hooks/useSavedFilters";
import {
  downloadReportXlsx,
  generateCustomReportHtml,
  generateCustomReportXlsx,
  openReportHtml,
} from "@/api/reports";
import { useAuthStore } from "@/features/auth/authStore";
import type { SavedFilter } from "@/features/os/types";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { DEFAULT_SORT_BY } from "../constants";
import type { RelatorioFilters, ReportFormat, ReportRequest } from "../types";
import {
  buildReportFilters,
  buildSelectedColumns,
  defaultRelatorioFilters,
  getDefaultFieldSelection,
  parseStringArray,
} from "../utils";
import { RelatorioColumnsPanel } from "./RelatorioColumnsPanel";
import { RelatorioFiltersPanel } from "./RelatorioFiltersPanel";

export function RelatorioPage() {
  const user = useAuthStore((s) => s.user);
  const ponto = user?.ponto != null ? String(user.ponto) : "";

  const [filters, setFilters] = useState<RelatorioFilters>(defaultRelatorioFilters);
  const [fieldSelection, setFieldSelection] = useState(getDefaultFieldSelection);
  const [savedFilterId, setSavedFilterId] = useState("");
  const [generatingFormat, setGeneratingFormat] = useState<ReportFormat | null>(
    null,
  );
  const [actionError, setActionError] = useState<string | null>(null);

  const savedFiltersQuery = useSavedFilters(ponto || null);

  const debouncedTextFilters = useDebouncedValue(
    {
      nrOs: filters.nrOs,
      ano: filters.ano,
      produto: filters.produto,
      titulo: filters.titulo,
      solicitante: filters.solicitante,
    },
    450,
  );
  const debouncedChoiceFilters = useDebouncedValue(
    {
      situacao: filters.situacao,
      setor: filters.setor,
      prioridade: filters.prioridade,
    },
    200,
  );
  const previewFilters = useMemo(
    (): RelatorioFilters => ({
      ...filters,
      ...debouncedTextFilters,
      ...debouncedChoiceFilters,
    }),
    [filters, debouncedTextFilters, debouncedChoiceFilters],
  );
  const previewQuery = useReportPreviewCount(previewFilters);

  const patchFilters = useCallback((patch: Partial<RelatorioFilters>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
    setSavedFilterId("");
  }, []);

  const clearFilters = useCallback(() => {
    setFilters((prev) => ({
      ...defaultRelatorioFilters(),
      ano: prev.ano,
    }));
    setSavedFilterId("");
  }, []);

  const applySavedFilter = useCallback((filter: SavedFilter) => {
    setFilters({
      ...defaultRelatorioFilters(),
      situacao: parseStringArray(filter.situacoes),
      setor: parseStringArray(filter.setores),
    });
    setSavedFilterId(String(filter.id));
  }, []);

  const handleSavedFilterChange = (id: string) => {
    setSavedFilterId(id);
    if (!id) return;
    const filter = savedFiltersQuery.data?.find((f) => String(f.id) === id);
    if (filter) {
      applySavedFilter(filter);
    }
  };

  const toggleField = (fieldId: string, checked: boolean) => {
    setFieldSelection((prev) => ({ ...prev, [fieldId]: checked }));
  };

  const toggleAllFields = (checked: boolean) => {
    setFieldSelection((prev) => {
      const next = { ...prev };
      for (const key of Object.keys(next)) {
        next[key] = checked;
      }
      return next;
    });
  };

  const buildPayload = (): ReportRequest | null => {
    const columns = buildSelectedColumns(fieldSelection);
    if (columns.length === 0) {
      setActionError("Selecione pelo menos um campo para o relatório.");
      return null;
    }
    setActionError(null);
    return {
      filters: buildReportFilters(filters),
      columns,
      generated_by: ponto || "Usuário",
      sort_by: filters.sortBy || DEFAULT_SORT_BY,
      sort_order: filters.sortOrder,
    };
  };

  const generateReport = async (format: ReportFormat) => {
    const payload = buildPayload();
    if (!payload) return;

    setGeneratingFormat(format);
    setActionError(null);

    try {
      if (format === "html") {
        const html = await generateCustomReportHtml(payload);
        const opened = openReportHtml(html);
        if (!opened) {
          setActionError(
            "Pop-up bloqueado. Permita pop-ups para visualizar o relatório.",
          );
        }
      } else {
        const blob = await generateCustomReportXlsx(payload);
        downloadReportXlsx(blob);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Falha ao gerar relatório.";
      setActionError(`Erro: ${message}`);
    } finally {
      setGeneratingFormat(null);
    }
  };

  const previewError =
    previewQuery.isError && !previewQuery.isFetching
      ? "Erro ao contar registros."
      : null;

  return (
    <div className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto md:h-full md:overflow-hidden">
      <RelatorioFiltersPanel
        filters={filters}
        onPatchFilters={patchFilters}
        onClearFilters={clearFilters}
        savedFilters={savedFiltersQuery.data ?? []}
        savedFilterId={savedFilterId}
        onSavedFilterChange={handleSavedFilterChange}
        savedFiltersLoading={savedFiltersQuery.isLoading && !savedFiltersQuery.data}
      />

      <RelatorioColumnsPanel
        fieldSelection={fieldSelection}
        onToggleField={toggleField}
        onToggleAll={toggleAllFields}
        previewCount={
          previewQuery.isSuccess ? (previewQuery.data ?? 0) : null
        }
        previewLoading={previewQuery.isFetching}
        previewError={previewError}
        generatingFormat={generatingFormat}
        onExportExcel={() => void generateReport("xlsx")}
        onGeneratePdf={() => void generateReport("html")}
      />

      {actionError ? (
        <div
          role="alert"
          className="shrink-0 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          {actionError}
        </div>
      ) : null}
    </div>
  );
}
