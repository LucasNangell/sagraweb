export type PreAnaliseSeveridade = "ok" | "info" | "warning" | "error";

export interface PreAnaliseAchado {
  codigo: string;
  titulo: string;
  mensagem: string;
  severidade: PreAnaliseSeveridade;
  detalhes?: Record<string, unknown>;
}

export interface PreAnaliseFormatoPage {
  page: number;
  marcas_de_corte?: boolean;
  formato_label?: string;
  mensagem?: string;
  lombada_alerta?: boolean;
  lombada_mensagem?: string;
  lombada_pdf_mm?: number;
  lombada_os_mm?: number;
}

export interface PreAnaliseFormatoFile {
  name: string;
  error?: string;
  pages: PreAnaliseFormatoPage[];
}

export interface PreAnaliseCheckResult {
  check_id: string;
  check_nome: string;
  status: PreAnaliseSeveridade;
  mensagem: string;
  achados?: PreAnaliseAchado[];
  pdf_count?: number;
  files?: PreAnaliseFormatoFile[];
}

export interface PreAnaliseTimingFields {
  estimate_total_sec?: number;
  elapsed_sec?: number;
  remaining_sec?: number;
  has_timing_history?: boolean;
  timing_sample_count?: number;
}

export type PreAnaliseStreamEvent =
  | ({ type: "start"; total: number } & PreAnaliseTimingFields)
  | ({
      type: "running";
      index: number;
      total: number;
      check_id?: string | null;
      check_nome?: string;
    } & PreAnaliseTimingFields)
  | ({
      type: "progress";
      index: number;
      total: number;
      check_id: string;
      check_nome: string;
      result: PreAnaliseCheckResult;
    } & PreAnaliseTimingFields)
  | ({ type: "done"; total: number } & PreAnaliseTimingFields)
  | ({
      type: "heartbeat";
      index: number;
      total: number;
      check_id: string;
      check_nome?: string;
    } & PreAnaliseTimingFields)
  | { type: "error"; message: string };

export type PreAnaliseLivePhase =
  | "loading"
  | "running"
  | "complete"
  | "failed"
  | "cancelled";

export interface PreAnaliseLiveState {
  phase: PreAnaliseLivePhase;
  currentCheckName: string | null;
  currentDetail: string | null;
  completedChecks: number;
  totalChecks: number;
  errorMessage?: string;
  /** Estimativa inicial (histórico de execuções). */
  estimatedTotalSec?: number | null;
  /** Tempo restante (atualizado pelo servidor a cada verificação). */
  remainingSec?: number | null;
  elapsedSec?: number | null;
  hasTimingHistory?: boolean;
  /** Amostras por-arquivo no histórico (checks × PDFs similares). */
  timingSampleCount?: number;
}

export interface PreAnaliseCheckMeta {
  id: string;
  nome: string;
  descricao: string;
}
