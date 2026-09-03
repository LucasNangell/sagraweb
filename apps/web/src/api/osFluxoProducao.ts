import { apiFetch } from "@/api/client";

export type FluxoStatusGeral =
  | "nao_iniciada"
  | "no_prazo"
  | "adiantada"
  | "atrasada"
  | "pausada_cliente"
  | "concluida"
  | "cancelada"
  | "sem_roteiro";

export type FluxoEtapaStatus =
  | "concluido"
  | "concluido_antecipado"
  | "em_execucao"
  | "pausado"
  | "atrasado"
  | "adiantado"
  | "pendente";

export interface FluxoPausa {
  situacao?: string | null;
  inicio?: string | null;
  fim?: string | null;
  minutos?: number | null;
}

export interface FluxoEtapa {
  id: string;
  ordem: number;
  rotulo: string;
  rotulo_curto?: string;
  setor: string;
  passo_id?: number | null;
  tipo: string;
  previsto_inicio?: string | null;
  previsto_fim?: string | null;
  previsto_duracao_min?: number | null;
  fonte_duracao?: string | null;
  amostras?: number | null;
  real_inicio?: string | null;
  real_fim?: string | null;
  real_duracao_min?: number | null;
  pausas?: FluxoPausa[];
  medicao?: "medida" | "inferida" | "estimada" | string | null;
  cod_status_inicio?: string | null;
  cod_status_fim?: string | null;
  operador?: string | null;
  status?: FluxoEtapaStatus | string | null;
  progresso_pct?: number | null;
  progresso_estimado?: boolean;
  desvio_min?: number | null;
}

export interface FluxoResumo {
  os: {
    nr_os: number;
    ano: number;
    titulo?: string | null;
    produto?: string | null;
    tiragem?: number | null;
    pags?: number | null;
    prioridade?: string | null;
    entrega_prevista?: string | null;
  };
  status_geral: FluxoStatusGeral | string;
  agora: string;
  desvio_total_min: number;
  etapa_atual?: { id: string; rotulo: string; setor: string } | null;
  pausa_cliente?: {
    ativa: boolean;
    situacao?: string | null;
    desde?: string | null;
    minutos_pausados_acumulados?: number | null;
  };
  previsao_termino?: string | null;
  previsao_termino_baseline?: string | null;
  confianca?: string | null;
  amostras?: number | null;
  escala: "horas" | "dias" | string;
  janela: { inicio?: string | null; fim?: string | null };
  tick_min: number;
  expediente: { abertura_hora: number; fechamento_hora: number };
  inicio_producao_em?: string | null;
  avisos?: string[];
  baseline_versao?: number;
  baseline_replanejado?: boolean;
}

export interface FluxoProducaoResponse {
  resumo: FluxoResumo;
  etapas: FluxoEtapa[];
}

export async function fetchOsFluxoProducao(
  ano: number,
  id: number,
): Promise<FluxoProducaoResponse> {
  return apiFetch<FluxoProducaoResponse>(`/os/${ano}/${id}/fluxo-producao`);
}
