export interface PapelariaModel {
  id: string;
  nome: string;
}

export interface PapelariaField {
  key: string;
  label: string;
  type: string;
  placeholder?: string;
  default?: string;
  required?: boolean;
  rows?: number;
}

export interface PapelariaPreviewPayload {
  id_produto: string;
  dados: Record<string, string>;
}

export interface PapelariaCorelModelSummary {
  id: number;
  produto: string;
  frente_versao: string;
  cores: string;
  arquivo_modelo: string;
  variaveis: string[];
  nome_exibicao: string;
  ordem?: number;
  mockup_config_json?: string | null;
  tem_mockup_config?: boolean;
  preview_config_json?: string | null;
  tem_preview_config?: boolean;
  preview_faces?: PapelariaPreviewFaceMeta[];
}

export interface PapelariaPreviewFaceMeta {
  id: string;
  nome?: string;
  baseImage?: string;
  hasBaseImage?: boolean;
  url: string;
}

export interface PapelariaCorelModelDetail extends PapelariaCorelModelSummary {
  campos: Record<string, string>;
  campos_formulario: PapelariaField[];
  mockup_config_json?: string | null;
  preview_config_json?: string | null;
  tem_preview_config?: boolean;
  preview_faces?: PapelariaPreviewFaceMeta[];
}

export interface PapelariaOsContextOs {
  nro: number;
  ano: number;
  produto: string;
  titulo: string;
  solicitante: string;
  titular: string;
  partido: string;
  uf: string;
  gabinete: string;
  cores: string;
  frente_verso: string;
  /** Mesmo conteúdo de tabDetalhesServico.Observ (Detalhes da OS). */
  observ?: string;
}

export interface PapelariaClienteCampoAlterado {
  key: string;
  antes: string;
  depois: string;
}

export interface PapelariaClienteAlteracao {
  observacao: string;
  versao: string;
  modelo_id?: number | null;
  job_id?: number | null;
  campos?: Record<string, string> | null;
  campos_alterados?: PapelariaClienteCampoAlterado[] | null;
}

export interface PapelariaCreateJobPayload {
  ano: number;
  nro: number;
  modelo_id: number;
  dados: Record<string, string>;
  lancar_andamento?: boolean;
}

export interface PapelariaOsContext {
  os: PapelariaOsContextOs;
  prefill: Record<string, string>;
  modelos: PapelariaCorelModelSummary[];
  autoSelectedModelId: number | null;
  warnings: string[];
  cliente_alteracao?: PapelariaClienteAlteracao | null;
}

export type PapelariaJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type PapelariaProvaRevisao = "pending" | "approved" | "discarded";

export interface PapelariaOsCdrFile {
  filename: string;
  relative_path: string;
  mtime: number;
}

export interface PapelariaOsCdrPath {
  path: string;
  filename: string;
  files?: PapelariaOsCdrFile[];
}

export interface PapelariaJobLogEntry {
  id: number;
  nivel: string;
  mensagem: string;
  criado_em: string | null;
}

export interface PapelariaJob {
  id: number;
  nro_protocolo: number;
  ano_protocolo: number;
  tipo_job: string;
  produto: string;
  modelo_id: number | null;
  arquivo_modelo: string;
  dados: Record<string, string>;
  status: PapelariaJobStatus;
  prioridade: number;
  ordem_fila: number | null;
  solicitado_por: string;
  solicitado_em: string | null;
  iniciado_em: string | null;
  concluido_em: string | null;
  worker_id: string | null;
  arquivo_cdr: string | null;
  arquivo_pdf: string | null;
  erro: string | null;
  tentativas: number;
  versao: number;
  job_pai_id: number | null;
  tem_arquivo_pdf: boolean;
  tem_arquivo_cdr: boolean;
  /** pending = aguarda OK do técnico após geração; approved / discarded após revisão. */
  prova_revisao?: PapelariaProvaRevisao | null;
  warnings?: string[];
  logs?: PapelariaJobLogEntry[];
}

export interface PapelariaApproveProvaResponse {
  job: PapelariaJob;
  cod_status: string;
  prova_versao: number;
  proof_token: string;
}

export interface PapelariaPreviewPageItem {
  page: number;
  url: string;
}

export interface PapelariaPreviewPagesResponse {
  pages: PapelariaPreviewPageItem[];
  total_pages?: number;
  truncated?: boolean;
}
