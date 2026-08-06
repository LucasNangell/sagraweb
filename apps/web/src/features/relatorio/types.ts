export type RelatorioSortOrder = "ASC" | "DESC";

export interface RelatorioFilters {
  nrOs: string;
  ano: string;
  produto: string;
  titulo: string;
  solicitante: string;
  situacao: string[];
  setor: string[];
  prioridade: string[];
  includeFinished: boolean;
  sortBy: string;
  sortOrder: RelatorioSortOrder;
}

export interface ReportColumn {
  id: string;
  label: string;
  db_field: string;
}

export interface ReportRequest {
  filters: Record<string, unknown>;
  columns: ReportColumn[];
  generated_by: string;
  sort_by: string;
  sort_order: RelatorioSortOrder;
}

export type ReportFormat = "html" | "xlsx";
