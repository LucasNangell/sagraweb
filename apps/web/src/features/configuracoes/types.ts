export interface PreAnaliseCheckConfig {
  id: string;
  nome: string;
  descricao: string;
  enabled: boolean;
}

export interface GerenciaSettings {
  os_arquivos_client_email_enabled: boolean;
}

export interface CotasGrafSemestreInfo {
  semestre_id: number;
  ano: number;
  numero_semestre: number;
  data_inicio?: string | null;
  data_fim?: string | null;
  status: string;
  limite_os_deputado: number;
  limite_sp_deputado: number;
  resetado_em?: string | null;
}

export interface CotasGrafProximoSemestreInfo {
  ano: number;
  numero_semestre: number;
  data_inicio: string;
  data_fim: string;
  limite_os_deputado: number;
  limite_sp_deputado: number;
}

export interface IniciarNovoSemestrePayload {
  ano: number;
  numero_semestre: number;
  data_inicio: string;
  data_fim: string;
  limite_os_deputado: number;
  limite_sp_deputado: number;
}

export interface ImportGraficaRapidaResult {
  ok: boolean;
  arquivo_nome: string;
  linhas_lidas: number;
  inseridos: number;
  duplicados: number;
  rejeitados: number;
  semestres_atualizados: number[];
  rejeicoes: Array<{ referencia: string; solicitante: string; motivo: string }>;
}

export interface RecalcularCotasResult {
  ok: boolean;
  semestre_id: number;
  movimentos_inseridos: number;
  clientes_atualizados: number;
  protocolos_lidos: number;
}

export interface PapelariaAdminModelRecord {
  id: number;
  produto: string;
  frente_versao: string;
  cores: string;
  arquivo_modelo: string;
  nome_exibicao: string;
  ordem?: number;
  mockup_config_json?: string | null;
  tem_mockup_config?: boolean;
  preview_config_json?: string | null;
  tem_preview_config?: boolean;
  preview_faces?: Array<{
    id: string;
    nome?: string;
    baseImage?: string;
    hasBaseImage?: boolean;
    url?: string;
  }>;
}

export type PapelariaAdminJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export interface PapelariaAdminQueueJob {
  id: number;
  nro_protocolo: number;
  ano_protocolo: number;
  produto: string;
  arquivo_modelo: string;
  status: PapelariaAdminJobStatus;
  ordem_fila: number | null;
  solicitado_por: string;
  solicitado_em: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
  worker_id: string | null;
  erro: string | null;
  tentativas: number;
}

export interface PapelariaAdminWorkerHeartbeat {
  worker_id: string;
  heartbeat_em: string;
  online: boolean;
  seconds_since_heartbeat: number;
  cpu_percent?: number;
  memory_percent?: number;
  load_score?: number;
}

export interface PapelariaAdminWorkerQueueSnapshot {
  atualizado_em: string;
  totais: Record<PapelariaAdminJobStatus, number>;
  workers: PapelariaAdminWorkerHeartbeat[];
  workers_online: number;
  fila: PapelariaAdminQueueJob[];
  recentes: PapelariaAdminQueueJob[];
}

export type EmailTemplateContentMode = "preset" | "custom" | "system";

export interface EmailTemplatePresetOption {
  id: string;
  label: string;
  uploaded?: boolean;
}

export interface EmailTemplateRecord {
  id: string;
  label: string;
  description: string;
  category: string;
  subject: string;
  html: string;
  default_subject: string;
  default_html: string;
  use_custom: boolean;
  content_mode?: EmailTemplateContentMode;
  preset_id?: string | null;
  available_presets?: EmailTemplatePresetOption[];
  subject_variables: string[];
  html_variables: string[];
  mailbox_key: string | null;
  updated_at?: string | null;
}

export interface EmailSendMailboxes {
  os_lt_5000: string;
  os_gte_5000: string;
  activation: string;
}

export interface GravacaoEmailNotificationEvent {
  enabled: boolean;
  mode: "usuario" | "personalizado";
  recipients: string[];
}

export interface GravacaoEmailNotificationSettings {
  encaminhada: GravacaoEmailNotificationEvent;
  iniciada: GravacaoEmailNotificationEvent;
  concluida: GravacaoEmailNotificationEvent;
}

export interface EmailTemplatesConfigResponse {
  templates: EmailTemplateRecord[];
  send_mailboxes: EmailSendMailboxes;
  gravacao_notifications: GravacaoEmailNotificationSettings;
  variable_hints: string[];
  sample_variables: Record<string, string>;
}

export type EmailTemplateModelGrupo =
  | "prova_os"
  | "prova_sp"
  | "problema_tecnico"
  | "timbrado_a4_digital";
export type EmailTemplateModelVariante = "portal" | "sem_portal";

export interface EmailTemplateModelRecord {
  id: number;
  grupo: EmailTemplateModelGrupo;
  variante: EmailTemplateModelVariante;
  nome: string;
  assunto: string;
  html: string;
  ativo: boolean;
  anexar_pdf: boolean;
  content_mode: "custom" | "preset";
  preset_id?: string | null;
  ordem: number;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by_ponto?: string | null;
  legacy_template_id?: string | null;
}

export interface EmailTemplateModelsListResponse {
  models: EmailTemplateModelRecord[];
  storage: string;
}

export type SystemCatalogCategoryKey =
  | "setor"
  | "situacao"
  | "cliente"
  | "produto"
  | "papel"
  | "maquina"
  | "categoria"
  | "cor"
  | "formato"
  | "acabamento";

export interface SystemCatalogCategoryMeta {
  key: SystemCatalogCategoryKey;
  label: string;
  description: string;
}

export interface SystemCatalogAdminItem {
  id: number | null;
  label: string;
  active: boolean;
  ordem: number;
  source: "catalog" | "usage";
  in_use: boolean;
}

export interface SystemCatalogVariacao {
  id: number;
  catalog_id: number;
  label: string;
  active: boolean;
  ordem: number;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by_ponto?: string | null;
}

export interface SystemCatalogListResponse {
  category: SystemCatalogCategoryKey;
  meta: SystemCatalogCategoryMeta;
  items: SystemCatalogAdminItem[];
}

export interface SystemCatalogItemRecord {
  id: number;
  category: SystemCatalogCategoryKey;
  label: string;
  active: boolean;
  ordem: number;
  source: string;
  created_at?: string | null;
  updated_at?: string | null;
  updated_by_ponto?: string | null;
}

export interface CustoFuncaoRecord {
  id: number;
  nome: string;
  codigo?: string | null;
  descricao?: string | null;
  custo_mensal: number;
  custo_hora: number;
  horas_mes: number;
  quantidade: number;
  alocacao: "etapa" | "overhead" | string;
  moeda: string;
  ativo: boolean;
  criado_em?: string | null;
  criado_por?: string | null;
  atualizado_em?: string | null;
  atualizado_por?: string | null;
}

export interface CustoFuncaoListResponse {
  items: CustoFuncaoRecord[];
  horas_mes_padrao: number;
}

export interface CustoFuncaoCreatePayload {
  nome: string;
  custo_mensal: number;
  codigo?: string | null;
  descricao?: string | null;
  quantidade?: number;
  alocacao?: string;
}

export interface CustoFuncaoUpdatePayload {
  nome?: string;
  custo_mensal?: number;
  codigo?: string | null;
  clear_codigo?: boolean;
  descricao?: string | null;
  quantidade?: number;
  alocacao?: string;
}

export interface OrcamentoInsumoRecord {
  id: number;
  codigo: string;
  categoria: string;
  especificacao: string;
  unidade?: string | null;
  qtd_embalagem: number;
  preco_bruto: number;
  preco_unitario: number;
  preco_cadastro?: number;
  preco_bruto_digital?: number;
  preco_unitario_digital?: number;
  rendimento_a4?: number | null;
  formato_folha?: string | null;
  aliases: string[];
  atualizado_em?: string | null;
  ativo: boolean;
  estoque_sku_id?: number | null;
  estoque_sku_codigo?: string | null;
  custo_estoque?: number | null;
}

export interface OrcamentoParametroRecord {
  chave: string;
  valor: string;
  tipo: string;
  descricao?: string | null;
  atualizado_em?: string | null;
  atualizado_por?: string | null;
}

export interface OrcamentoFormatoRecord {
  id: number;
  codigo: string;
  menor_mm: number;
  maior_mm: number;
  fator_a4: number;
  ordem: number;
  ativo: boolean;
}

export interface OrcamentoFaixaRecord {
  id: number;
  limite_inf: number;
  limite_sup: number | null;
  percentual: number;
  ordem: number;
  ativo: boolean;
}

export interface ProdutoPassoCrew {
  funcao_id: number;
  quantidade: number;
  nome?: string | null;
  codigo?: string | null;
}

export interface ProdutoPassoRecord {
  id?: number;
  ordem: number;
  nome: string;
  setor_link: string;
  tipo: "produtiva" | "espera_cliente" | "fim" | string;
  cobra_pessoal: boolean;
  tecnologia: string;
  setup_min: number;
  min_por_un: number;
  min_por_pag: number;
  min_por_folha: number;
  funcoes: ProdutoPassoCrew[];
  aprendido?: {
    n: number;
    mediana_horas?: number | null;
    ewma_horas?: number | null;
  };
}

export interface ProdutoPassosResponse {
  passos: ProdutoPassoRecord[];
  funcoes: CustoFuncaoRecord[];
  setores: string[];
  produtos: { id: number; label: string }[];
  acabamentos?: { id: number; label: string }[];
}
