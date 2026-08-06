import type { YearFilterMode } from "@/features/os/types";

export const SITUACAO_COTAS_OPTIONS = [
  { value: "Atualizado", label: "Atualizado" },
  { value: "Pendente", label: "Pendente" },
] as const;

export const DEFAULT_COTAS_GRAF_PAGE_SIZE = 200;
export const COTAS_GRAF_MOBILE_PAGE_SIZE = 20;

export interface CotasGrafSearchFilters {
  nrOs?: number;
  ano?: number;
  anoMode: YearFilterMode;
  produto?: string;
  produtos: string[];
  titulo?: string;
  solicitante?: string;
  solicitantes: string[];
  situacaoCotas: string[];
  includeFinished: boolean;
  includeOs: boolean;
  includeSp: boolean;
  page: number;
  limit: number;
}

export interface CotasGrafSavedFilter {
  id: number;
  nome: string;
  situacoes_cotas: string[];
  is_default: boolean;
}

export interface CotasGrafFiltersDefault {
  ponto: string;
  situacoes_cotas: string[];
  nome_filtro?: string;
}
