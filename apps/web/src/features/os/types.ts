/** Linha retornada por GET /api/os/search */
export interface OsSearchRow {
  nr_os: number;
  ano: number;
  titulo?: string | null;
  solicitante?: string | null;
  situacao?: string | null;
  prioridade?: string | null;
  produto?: string | null;
  formato?: string | null;
  setor?: string | null;
  data_entrega?: string | null;
  entreg_periodo?: string | null;
  last_update?: string | null;
  observacao?: string | null;
  /** Preenchido por GET /api/os/search (opcional, retrocompatível). */
  has_sub_os?: boolean;
  sub_os_count?: number;
  /** Preenchido por GET /api/os/search quando filtro bate no status da Sub OS. */
  matched_via_sub_os?: boolean;
  /** Sub OS lógica (não é linha de busca server-side). */
  kind?: "main_os" | "sub_os";
  is_sub_os?: boolean;
  sub_os_id?: number;
  componente_id?: number;
  componente_nome?: string;
  display_label?: string;
  parent_nr_os?: number;
  parent_ano?: number;
  congelada?: boolean;
}

export interface OsSearchMeta {
  page: number;
  limit: number;
  has_next?: boolean;
  simple_pagination?: boolean;
  total_records?: number;
  total_pages?: number;
}

export interface OsSearchResponse {
  data: OsSearchRow[];
  meta: OsSearchMeta;
}

export type OsSortDir = "asc" | "desc";

/** Colunas ordenáveis na busca (espelha OS_SEARCH_SORT_COLUMNS no backend). */
export type OsSortColumn =
  | "nr_os"
  | "ano"
  | "produto"
  | "titulo"
  | "solicitante"
  | "situacao"
  | "setor"
  | "prioridade"
  | "data_entrega";

export type YearFilterMode = "from" | "specific";

export interface OsSearchFilters {
  nrOs?: number;
  /** @deprecated Preferir `anos` (home). Mantido para compatibilidade legado. */
  ano?: number;
  /** @deprecated Home usa anos específicos via `anos`. */
  anoMode?: YearFilterMode;
  /** Anos específicos (multiselect). Vazio = todos. */
  anos: number[];
  /** Legado — texto livre; ignorado quando `produtos` tem itens. */
  produto?: string;
  produtos: string[];
  titulo?: string;
  /** Processo solicitação — máscara 00.000.000/0000. */
  processo?: string;
  /** Legado — texto livre; ignorado quando `solicitantes` tem itens. */
  solicitante?: string;
  solicitantes: string[];
  categorias: string[];
  maquinas: string[];
  situacao: string[];
  setor: string[];
  prioridade: string[];
  includeFinished: boolean;
  includeOs: boolean;
  includeSp: boolean;
  page: number;
  limit: number;
  sortBy?: OsSortColumn;
  sortDir?: OsSortDir;
  /** Busca por Nr OS: fast path SQL; situação/setor/prioridade/OS/SP aplicados após enrich. */
  exactOsLookup?: boolean;
}

export interface AuxOption {
  value: string;
  label: string;
}

export const PRIORIDADE_OPTIONS: AuxOption[] = [
  { value: "Normal", label: "Normal" },
  { value: "Solicitado p/", label: "Solicitado p/" },
  { value: "Prometido p/", label: "Prometido p/" },
];

/** Tamanho padrão de página da listagem de OS. */
export const DEFAULT_PAGE_SIZE = 20;

/** Opções do seletor de registros por página na listagem de OS. */
export const OS_PAGE_SIZE_OPTIONS = [20, 50, 100, 500] as const;

/** GET /api/os/{ano}/{id}/details */
export interface OsDetails {
  MaquinaLink?: string | null;
  Tiragem?: string | number | null;
  EntregPrazoLink?: string | null;
  FormatoLink?: string | null;
  ModelosArq?: string | null;
  Pags?: string | number | null;
  EntregData?: string | null;
  DescAcabamento?: string | null;
  PapelLink?: string | null;
  PapelDescricao?: string | null;
  Cores?: string | null;
  CoresDescricao?: string | null;
  Observ?: string | null;
  ContatoTrab?: string | null;
  FrenteVerso?: boolean | number | null;
}

export interface OsComponenteRow {
  id: number;
  nome: string;
  nome_normalizado: string;
  tipo?: string | null;
  ordem: number;
  ativo: boolean;
  lotes: unknown[];
}

export interface SubOsRow {
  id: number;
  display_name: string;
  componente_id: number;
  componente_nome: string;
  componente_tipo?: string | null;
  situacao?: string | null;
  setor?: string | null;
  data?: string | null;
  situacao_atual?: string | null;
  setor_atual?: string | null;
  observacao_atual?: string | null;
  data_atual?: string | null;
  ultimo_status_id?: number | null;
  has_history?: boolean;
  row_kind?: "sub_os";
  congelada: boolean;
  ativo: boolean;
}

export interface SubOsHistoryRow {
  id: number;
  situacao: string;
  setor: string;
  observacao?: string | null;
  data?: string | null;
  ultimo_status: boolean;
  ponto?: string | null;
  cod_status_espelho?: string | null;
  source_type?: string | null;
  source_cod_status?: string | null;
  herdado_da_os_principal?: boolean;
}

export interface SubOsHistoryPayload {
  situacao: string;
  setor: string;
  obs: string;
  usuario: string;
}

/** GET /api/os/{ano}/{id}/history */
export interface OsHistoryRow {
  CodStatus: string;
  SituacaoLink?: string | null;
  SetorLink?: string | null;
  Data?: string | null;
  Ponto?: string | null;
  Observaçao?: string | null;
}

/** Dados de entrega gravados em tabProtocolos ao lançar andamento Entregue. */
export interface ProtocoloEntregaPayload {
  data?: string;
  armazenado_em?: string;
  recado_com?: string;
  entregue_para?: string;
  nr_ponto?: string;
  data_entrega?: string;
  entregue_por?: string;
  setor?: string;
}

export interface GravacaoPendenteArquivoInput {
  absolute_path: string;
  nome: string;
  maquina?: string | null;
}

export interface GravacaoPendenteChapaInput {
  maquina: string;
  quantidade: number;
}

export interface HistoryPayload {
  situacao: string;
  setor: string;
  obs: string;
  usuario: string;
  cod_status?: string;
  /** Obrigatório quando a OS possui Sub OSs ativas e o destino é a OS principal. */
  confirm_main_os_target?: boolean;
  protocolo_entrega?: ProtocoloEntregaPayload;
  gravacao_pendente_arquivos?: GravacaoPendenteArquivoInput[];
  gravacao_pendente_chapas?: GravacaoPendenteChapaInput[];
  gravacao_pendente_juntadas?: { numero: number; ano: number }[];
  /** Painel tablet: token do reconhecimento facial (sobrescreve usuario no backend). */
  face_token?: string;
  from_tablet?: boolean;
}

/** GET /api/os/{ano}/{id}/audit-log */
export interface OsAuditLogRow {
  id: number;
  evento_em?: string | null;
  acao: string;
  entidade: string;
  campo?: string | null;
  valor_anterior?: string | null;
  valor_novo?: string | null;
  ponto?: string | null;
  client_ip?: string | null;
  origem?: string | null;
  descricao?: string | null;
}

export interface OsVinculo {
  numero: number;
  ano: number;
  data_vinculo?: string | null;
}

export interface OsVinculoGrupoMembro {
  numero: number;
  ano: number;
}

export interface OsVinculoGrupoConfig {
  grupo_id?: number | null;
  situacao?: string | null;
  setor?: string | null;
  criado_por_ponto?: string | null;
  membros: OsVinculoGrupoMembro[];
}

export interface OsVinculoReplicacaoCheck {
  requires_confirmation: boolean;
  legacy?: boolean;
  grupo_id?: number | null;
  situacao_grupo?: string | null;
  setor_grupo?: string | null;
  criado_por_ponto?: string | null;
  membros: OsVinculoGrupoMembro[];
}

export interface SavedFilterCriterios {
  nr_os?: number | null;
  anos: number[];
  processo: string;
  categorias: string[];
  solicitantes: string[];
  titulo: string;
  produtos: string[];
  maquinas: string[];
  prioridade: string[];
}

export function emptySavedFilterCriterios(): SavedFilterCriterios {
  return {
    nr_os: null,
    anos: [],
    processo: "",
    categorias: [],
    solicitantes: [],
    titulo: "",
    produtos: [],
    maquinas: [],
    prioridade: [],
  };
}

export interface SavedFilter {
  id: number;
  nome: string;
  situacoes: string[];
  setores: string[];
  /** Critérios extras; ausente/legado = vazio. */
  criterios?: SavedFilterCriterios;
  is_default: boolean;
}

export interface UserFiltersDefault {
  usuario?: string;
  ponto: string;
  situacoes: string[];
  setores: string[];
  criterios?: SavedFilterCriterios;
  nome_filtro?: string;
}

export interface AppNotification {
  Id: number;
  NroProtocolo?: number | null;
  AnoProtocolo?: number | null;
  Mensagem?: string | null;
  DetalhesJson?: string | null;
  DataCriacao?: string | null;
}
