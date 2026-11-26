import { apiFetch } from "@/lib/api";

const JSON_HEADERS = { "Content-Type": "application/json" } as const;

export type ManutencaoPrioridade = "urgente" | "alta" | "normal" | "baixa";
export type ManutencaoStatus =
  | "fila"
  | "em_execucao"
  | "pausado"
  | "concluido"
  | "cancelado";
export type ManutencaoSituacaoRecorrente =
  | "em_dia"
  | "vence_em_breve"
  | "vencida"
  | "sem_historico"
  | "em_aberto";

export interface ManutencaoMaquina {
  id: number;
  codigo: string;
  nome: string;
  setor?: string | null;
  fabricante?: string | null;
  modelo?: string | null;
  numero_serie?: string | null;
  observacoes?: string | null;
  ativo: boolean;
  ordem: number;
  atualizado_em?: string | null;
  pedidos_abertos: number;
  em_execucao: number;
  parada: boolean;
  ultima_manutencao?: string | null;
  total_concluidas: number;
}

export interface ManutencaoRecorrente {
  id: number;
  titulo: string;
  descricao?: string | null;
  maquina_id?: number | null;
  maquina_nome?: string | null;
  maquina_codigo?: string | null;
  periodicidade_dias?: number | null;
  prioridade_padrao: ManutencaoPrioridade;
  ativo: boolean;
  ultima_execucao?: string | null;
  proxima_em?: string | null;
  dias_restantes?: number | null;
  situacao?: ManutencaoSituacaoRecorrente | null;
  total_execucoes: number;
}

export interface ManutencaoEvento {
  id: number;
  tipo: string;
  ponto?: string | null;
  ponto_nome?: string | null;
  texto?: string | null;
  criado_em?: string | null;
}

export interface ManutencaoVisualizacao {
  ponto: string;
  nome?: string | null;
  primeira_em: string | null;
  ultima_em: string | null;
  origem: "app" | "web";
  vezes: number;
}

export interface ManutencaoAparelho {
  id: number;
  ponto: string;
  nome?: string | null;
  modelo?: string | null;
  versao_app?: string | null;
  criado_em: string | null;
  ultimo_acesso_em: string | null;
  ultima_abertura_em: string | null;
  revogado_em: string | null;
  aberturas_7d: number;
}

export interface ManutencaoAppAbertura {
  id: number;
  ponto: string;
  nome?: string | null;
  modelo?: string | null;
  versao_app?: string | null;
  aberto_em: string | null;
}

export interface ManutencaoAppVersao {
  version_code: number;
  version_name: string;
  arquivo: string;
  sha256: string;
  tamanho: number;
  publicado_em?: string | null;
  notas?: string | null;
}

export interface ManutencaoPedido {
  id: number;
  maquina_id: number;
  maquina_nome?: string | null;
  maquina_codigo?: string | null;
  maquina_setor?: string | null;
  recorrente_id?: number | null;
  recorrente_titulo?: string | null;
  titulo: string;
  descricao?: string | null;
  prioridade: ManutencaoPrioridade;
  status: ManutencaoStatus;
  posicao_fila?: number | null;
  maquina_parada: boolean;
  solicitado_por?: string | null;
  solicitado_por_nome?: string | null;
  solicitado_em?: string | null;
  iniciado_por?: string | null;
  iniciado_por_nome?: string | null;
  iniciado_em?: string | null;
  diagnostico?: string | null;
  solucao_passos: string[];
  pausa_motivo?: string | null;
  /** Só com status "pausado": quem pausou e quando. */
  pausado_por?: string | null;
  pausado_por_nome?: string | null;
  pausado_em?: string | null;
  concluido_por?: string | null;
  concluido_por_nome?: string | null;
  concluido_em?: string | null;
  conclusao?: string | null;
  cancelado_por?: string | null;
  cancelado_por_nome?: string | null;
  cancelado_em?: string | null;
  motivo_cancelamento?: string | null;
  atualizado_em?: string | null;
  /** Só com `incluirSimilares`: soluções semelhantes já registradas no histórico. */
  similares_count?: number;
  /** Quem já viu o pedido (app ou web) e quando. */
  visualizacoes?: ManutencaoVisualizacao[];
  eventos?: ManutencaoEvento[];
}

/** Manutenção concluída resumida (busca no histórico / semelhantes). */
export interface ManutencaoHistoricoItem {
  id: number;
  maquina_id: number;
  maquina_nome?: string | null;
  maquina_codigo?: string | null;
  titulo: string;
  descricao?: string | null;
  diagnostico?: string | null;
  solucao_passos: string[];
  conclusao?: string | null;
  concluido_em?: string | null;
  concluido_por?: string | null;
  concluido_por_nome?: string | null;
  mesma_maquina: boolean;
  score: number;
  termos: string[];
}

export interface ManutencaoResumo {
  fila: number;
  em_execucao: number;
  pausado: number;
  urgentes: number;
  maquinas_paradas: number;
  concluidos_30d: number;
  tempo_medio_execucao_min: number | null;
  tempo_medio_espera_min: number | null;
  preventivas_vencidas: number;
  preventivas_em_breve: number;
}

export type MaquinaInput = Partial<
  Pick<
    ManutencaoMaquina,
    | "nome"
    | "codigo"
    | "setor"
    | "fabricante"
    | "modelo"
    | "numero_serie"
    | "observacoes"
    | "ativo"
    | "ordem"
  >
>;

export interface RecorrenteInput {
  titulo?: string;
  descricao?: string | null;
  maquina_id?: number | null;
  clear_maquina?: boolean;
  periodicidade_dias?: number | null;
  clear_periodicidade?: boolean;
  prioridade_padrao?: ManutencaoPrioridade;
  ativo?: boolean;
}

export interface PedidoInput {
  maquina_id: number;
  titulo?: string;
  descricao?: string | null;
  prioridade?: ManutencaoPrioridade;
  recorrente_id?: number | null;
  maquina_parada?: boolean;
}

export const manutencaoKeys = {
  all: ["manutencao"] as const,
  resumo: ["manutencao", "resumo"] as const,
  maquinas: (includeInactive: boolean) =>
    ["manutencao", "maquinas", includeInactive] as const,
  recorrentes: (includeInactive: boolean) =>
    ["manutencao", "recorrentes", includeInactive] as const,
  pedidos: (filter: string) => ["manutencao", "pedidos", filter] as const,
  pedido: (id: number) => ["manutencao", "pedido", id] as const,
  similares: (id: number) => ["manutencao", "similares", id] as const,
  historico: (q: string, maquinaId: number | null) =>
    ["manutencao", "historico", q, maquinaId] as const,
  aparelhos: ["manutencao", "aparelhos"] as const,
  appVersao: ["manutencao", "app-versao"] as const,
  horario: ["manutencao", "horario"] as const,
};

function json(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: JSON_HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export function fetchManutencaoResumo() {
  return apiFetch<ManutencaoResumo>("/manutencao/resumo");
}

export function fetchManutencaoMaquinas(includeInactive = false) {
  return apiFetch<{ items: ManutencaoMaquina[] }>(
    `/manutencao/maquinas${includeInactive ? "?include_inactive=true" : ""}`,
  );
}

export function createManutencaoMaquina(body: MaquinaInput) {
  return apiFetch<ManutencaoMaquina>("/manutencao/maquinas", json("POST", body));
}

export function updateManutencaoMaquina(id: number, body: MaquinaInput) {
  return apiFetch<ManutencaoMaquina>(`/manutencao/maquinas/${id}`, json("POST", body));
}

export function fetchManutencaoRecorrentes(includeInactive = false) {
  return apiFetch<{ items: ManutencaoRecorrente[] }>(
    `/manutencao/recorrentes${includeInactive ? "?include_inactive=true" : ""}`,
  );
}

export function createManutencaoRecorrente(body: RecorrenteInput) {
  return apiFetch<ManutencaoRecorrente>("/manutencao/recorrentes", json("POST", body));
}

export function updateManutencaoRecorrente(id: number, body: RecorrenteInput) {
  return apiFetch<ManutencaoRecorrente>(
    `/manutencao/recorrentes/${id}`,
    json("POST", body),
  );
}

export function fetchManutencaoPedidos(params: {
  status?: ManutencaoStatus[];
  maquinaId?: number;
  finalizadosDias?: number;
  incluirSimilares?: boolean;
} = {}) {
  const q = new URLSearchParams();
  if (params.incluirSimilares) q.set("incluir_similares", "true");
  if (params.status?.length) q.set("status", params.status.join(","));
  if (params.maquinaId) q.set("maquina_id", String(params.maquinaId));
  if (params.finalizadosDias) q.set("finalizados_dias", String(params.finalizadosDias));
  const qs = q.toString();
  return apiFetch<{ items: ManutencaoPedido[] }>(
    `/manutencao/pedidos${qs ? `?${qs}` : ""}`,
  );
}

export function fetchManutencaoPedido(id: number) {
  return apiFetch<ManutencaoPedido>(`/manutencao/pedidos/${id}`);
}

export function createManutencaoPedido(body: PedidoInput) {
  return apiFetch<ManutencaoPedido>("/manutencao/pedidos", json("POST", body));
}

export function updateManutencaoPedido(
  id: number,
  body: Partial<Pick<PedidoInput, "titulo" | "descricao" | "prioridade" | "maquina_parada">>,
) {
  return apiFetch<ManutencaoPedido>(`/manutencao/pedidos/${id}`, json("POST", body));
}

export function reorderManutencaoFila(ids: number[]) {
  return apiFetch<{ items: ManutencaoPedido[] }>("/manutencao/fila/ordem", json("POST", { ids }));
}

export function cancelarManutencaoPedido(id: number, motivo: string) {
  return apiFetch<ManutencaoPedido>(
    `/manutencao/pedidos/${id}/cancelar`,
    json("POST", { motivo }),
  );
}

export function iniciarManutencaoPedido(id: number) {
  return apiFetch<ManutencaoPedido>(`/manutencao/pedidos/${id}/iniciar`, json("POST"));
}

export function salvarProgressoManutencao(
  id: number,
  body: { diagnostico?: string | null; passos?: string[] },
) {
  return apiFetch<ManutencaoPedido>(
    `/manutencao/pedidos/${id}/progresso`,
    json("POST", body),
  );
}

export function pausarManutencaoPedido(id: number, motivo: string) {
  return apiFetch<ManutencaoPedido>(
    `/manutencao/pedidos/${id}/pausar`,
    json("POST", { motivo }),
  );
}

export function devolverManutencaoPedido(id: number, motivo?: string) {
  return apiFetch<ManutencaoPedido>(
    `/manutencao/pedidos/${id}/devolver`,
    json("POST", { motivo: motivo ?? null }),
  );
}

export function concluirManutencaoPedido(
  id: number,
  body: { conclusao: string; diagnostico?: string | null; passos?: string[] },
) {
  return apiFetch<ManutencaoPedido>(
    `/manutencao/pedidos/${id}/concluir`,
    json("POST", body),
  );
}

export function comentarManutencaoPedido(id: number, texto: string) {
  return apiFetch<ManutencaoPedido>(
    `/manutencao/pedidos/${id}/comentarios`,
    json("POST", { texto }),
  );
}

export function fetchManutencaoSimilares(id: number) {
  return apiFetch<{ items: ManutencaoHistoricoItem[] }>(`/manutencao/pedidos/${id}/similares`);
}

export function buscarManutencaoHistorico(params: { q: string; maquinaId?: number | null }) {
  const q = new URLSearchParams();
  q.set("q", params.q);
  if (params.maquinaId) q.set("maquina_id", String(params.maquinaId));
  return apiFetch<{ items: ManutencaoHistoricoItem[] }>(`/manutencao/historico/busca?${q}`);
}

// ---------------------------------------------------------------- público (QR Code)

export interface ManutencaoMaquinaPublica {
  codigo: string;
  nome: string;
  setor?: string | null;
  parada: boolean;
  pedidos_abertos: Array<{
    id: number;
    titulo: string;
    status: ManutencaoStatus;
    prioridade: ManutencaoPrioridade;
    solicitado_em?: string | null;
  }>;
}

export interface ChamadoPublicoInput {
  codigo: string;
  titulo: string;
  descricao?: string | null;
  prioridade: ManutencaoPrioridade;
  maquina_parada: boolean;
  ponto: string;
  nome?: string | null;
}

export function fetchMaquinaPublica(codigo: string) {
  return apiFetch<ManutencaoMaquinaPublica>(
    `/manutencao/publico/maquinas/${encodeURIComponent(codigo)}`,
  );
}

export function fetchNomePublicoPorPonto(ponto: string) {
  return apiFetch<{ ponto: string; nome: string | null }>(
    `/manutencao/publico/ponto/${encodeURIComponent(ponto)}`,
  );
}

export function abrirChamadoPublico(body: ChamadoPublicoInput) {
  return apiFetch<{
    id: number;
    posicao_fila?: number | null;
    maquina_nome?: string | null;
    solicitante_nome: string;
  }>("/manutencao/publico/chamados", json("POST", body));
}

/** Dispara uma notificação push de teste da Manutenção para os aparelhos do usuário. */
export function testarManutencaoPush() {
  return apiFetch<{ enviados: number; inscricoes: number }>(
    "/manutencao/push/teste",
    { method: "POST" },
  );
}

export function registrarManutencaoVisualizacoes(ids: number[], origem: "app" | "web") {
  return apiFetch<{ registrados: number }>(
    "/manutencao/visualizacoes",
    json("POST", { ids, origem }),
  );
}

export function fetchManutencaoAparelhos() {
  return apiFetch<{
    items: ManutencaoAparelho[];
    aberturas: ManutencaoAppAbertura[];
    versao: ManutencaoAppVersao | null;
  }>("/manutencao/aparelhos");
}

export function revogarManutencaoAparelho(id: number) {
  return apiFetch<{ ok: boolean }>(`/manutencao/aparelhos/${id}/revogar`, { method: "POST" });
}

export function fetchManutencaoAppVersao() {
  return apiFetch<ManutencaoAppVersao>("/manutencao/app/versao");
}

/** Horário de trabalho: fora dele o celular não recebe avisos (dias ISO: 1 = seg … 7 = dom). */
export interface ManutencaoHorario {
  ativo: boolean;
  dias: number[];
  inicio: string;
  fim: string;
  urgentes_fora: boolean;
  atualizado_em?: string | null;
  /** Calculado no servidor: o usuário está dentro do horário agora. */
  avisando_agora?: boolean;
}

export function fetchManutencaoHorario() {
  return apiFetch<ManutencaoHorario>("/manutencao/horario");
}

export function salvarManutencaoHorario(body: Omit<ManutencaoHorario, "atualizado_em" | "avisando_agora">) {
  return apiFetch<ManutencaoHorario>("/manutencao/horario", json("POST", body));
}
