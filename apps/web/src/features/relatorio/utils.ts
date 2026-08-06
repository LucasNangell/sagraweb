import { AVAILABLE_FIELDS, DEFAULT_SORT_BY } from "./constants";
import type { RelatorioFilters, ReportColumn } from "./types";
import type { OsSearchFilters } from "@/features/os/types";

export function defaultRelatorioFilters(): RelatorioFilters {
  return {
    nrOs: "",
    ano: "",
    produto: "",
    titulo: "",
    solicitante: "",
    situacao: [],
    setor: [],
    prioridade: [],
    includeFinished: false,
    sortBy: DEFAULT_SORT_BY,
    sortOrder: "DESC",
  };
}

export function getDefaultFieldSelection(): Record<string, boolean> {
  const selection: Record<string, boolean> = {};
  for (const group of AVAILABLE_FIELDS) {
    for (const field of group.fields) {
      selection[field.id] = Boolean(field.default);
    }
  }
  return selection;
}

export function getSortOptions(): { value: string; label: string }[] {
  const seen = new Set<string>();
  const options: { value: string; label: string }[] = [];
  for (const group of AVAILABLE_FIELDS) {
    for (const field of group.fields) {
      if (!seen.has(field.db)) {
        seen.add(field.db);
        options.push({ value: field.db, label: field.label });
      }
    }
  }
  return options;
}

export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string" && v.length > 0);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (Array.isArray(parsed)) {
        return parsed.filter((v): v is string => typeof v === "string" && v.length > 0);
      }
    } catch {
      return value.trim() ? [value] : [];
    }
  }
  return [];
}

/** Monta o objeto de filtros enviado ao POST /reports/custom (espelha getFilters legado). */
export function buildReportFilters(filters: RelatorioFilters): Record<string, unknown> {
  const out: Record<string, unknown> = { include_finished: filters.includeFinished };

  const nrOs = filters.nrOs.trim();
  if (nrOs) out.nr_os = nrOs;

  const ano = filters.ano.trim();
  if (ano) out.ano = ano;

  if (filters.produto.trim()) out.produto = filters.produto.trim();
  if (filters.titulo.trim()) out.titulo = filters.titulo.trim();
  if (filters.solicitante.trim()) out.solicitante = filters.solicitante.trim();

  if (filters.situacao.length > 0) out.situacao = filters.situacao;
  if (filters.setor.length > 0) out.setor = filters.setor;
  if (filters.prioridade.length > 0) out.prioridade = filters.prioridade;

  return out;
}

/** Converte filtros do relatório para busca OS (contagem de preview). */
export function toOsSearchFiltersForPreview(filters: RelatorioFilters): OsSearchFilters {
  const parseOptionalInt = (raw: string): number | undefined => {
    const trimmed = raw.trim();
    if (!trimmed) return undefined;
    const n = Number.parseInt(trimmed, 10);
    return Number.isNaN(n) ? undefined : n;
  };

  return {
    nrOs: parseOptionalInt(filters.nrOs),
    ano: parseOptionalInt(filters.ano),
    anoMode: "specific",
    anos: [],
    produto: filters.produto.trim(),
    produtos: [],
    titulo: filters.titulo.trim(),
    processo: "",
    solicitante: filters.solicitante.trim(),
    solicitantes: [],
    categorias: [],
    maquinas: [],
    situacao: filters.situacao,
    setor: filters.setor,
    prioridade: filters.prioridade,
    includeFinished: filters.includeFinished,
    includeOs: true,
    includeSp: true,
    page: 1,
    limit: 1,
  };
}

export function buildSelectedColumns(
  fieldSelection: Record<string, boolean>,
): ReportColumn[] {
  const columns: ReportColumn[] = [];
  for (const group of AVAILABLE_FIELDS) {
    for (const field of group.fields) {
      if (fieldSelection[field.id]) {
        columns.push({
          id: field.id,
          label: field.label,
          db_field: field.db,
        });
      }
    }
  }
  return columns;
}
