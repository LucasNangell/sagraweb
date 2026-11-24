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
  tem_imposicao_config?: boolean;
  imposicao_config_json?: string | null;
  padrao_frente?: boolean;
  padrao_verso?: boolean;
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
  /** Modelo com PDF + textos ligados: a prévia ao vivo é o próprio PDF renderizado. */
  tem_prova_pdf?: boolean;
  /** Mockup 3D do produto (só frente / frente e verso) — vale para todos os modelos. */
  mockup_produto?: { frente?: string | null; frente_verso?: string | null } | null;
  mockup_config_json_modelo?: string | null;
  /** Bloco de redes sociais do PDF do modelo: redes que o usuário pode incluir. */
  redes_bloco?: PapelariaRedesBloco | null;
}

export type PapelariaRedeEstilo = "quadrado_policromia" | "quadrado_pb" | "policromia" | "pb";

export interface PapelariaRedeOpcao {
  chave: string;
  nome: string;
  exemplo: string;
  logo_url: string | null;
  /** PNG do logo em cada estilo disponível para a rede. */
  logos_url?: Partial<Record<PapelariaRedeEstilo, string>>;
}

export interface PapelariaRedesBloco {
  max: number;
  /** Estilo de logo pré-selecionado (definido no bloco do modelo). */
  estilo_padrao?: PapelariaRedeEstilo;
  /** Estilos com logo em pelo menos uma das redes do bloco. */
  estilos?: Array<{ id: PapelariaRedeEstilo; rotulo: string }>;
  redes: PapelariaRedeOpcao[];
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
  /** Textos que o cliente editou na prévia do portal. */
  textos_alterados?: PapelariaClienteTextoAlterado[] | null;
  /** Redes sociais incluídas, alteradas ou retiradas pelo cliente. */
  redes_alteradas?: PapelariaClienteRedeAlterada[] | null;
  /** `__textos` / `__redes` / `__redes_estilo` da prova com o pedido do cliente por cima. */
  internos?: Record<string, string> | null;
}

export interface PapelariaClienteTextoAlterado {
  chave: string;
  marcador: string;
  antes: string;
  depois: string;
}

export interface PapelariaClienteRedeAlterada {
  chave: string;
  rede: string;
  antes: string;
  depois: string;
}

export interface PapelariaCreateJobPayload {
  ano: number;
  nro: number;
  modelo_id: number;
  dados: Record<string, string>;
  lancar_andamento?: boolean;
  /** Corel já na pasta: true mantém os textos dele (não aplica o formulário). */
  manter_dados_corel?: boolean;
  /** Exceção: gerar o arquivo CorelDRAW pelo worker em vez da Prova PDF. */
  gerar_corel?: boolean;
}

/** Ocorrência de um objeto no Corel da pasta (face + centro em mm no arquivo final). */
export interface PapelariaCorelOcorrencia {
  face: string;
  x: number | null;
  y: number | null;
  /** Ex.: «Frente», «Verso», «Frente (esquerda)». */
  rotulo: string;
  original: string;
  novo: string;
  /** Campo do produto já existente para esta ocorrência. */
  key?: string | null;
}

/** Objeto do Corel da pasta cujo texto difere do que o formulário aplicaria. */
export interface PapelariaCorelDiferenca {
  campo: string;
  rotulo: string;
  original: string[];
  novo: string[];
  /** false: worker antigo, sem face/posição — não dá para criar campos por ocorrência. */
  editavel?: boolean;
  ocorrencias?: PapelariaCorelOcorrencia[];
}

/** Campos do produto real (Corel da pasta): um campo por ocorrência de objeto. */
export interface PapelariaCamposProdutoEntrada {
  face: string;
  x: number;
  y: number;
  key: string;
}

export interface PapelariaCamposProduto {
  arquivo?: string;
  objetos: Record<string, PapelariaCamposProdutoEntrada[]>;
  campos: PapelariaField[];
}

export type PapelariaCompararCorelStatus =
  | "sem_corel"
  | "pending"
  | "processing"
  | "completed"
  | "failed";

export interface PapelariaCompararCorelResponse {
  status: PapelariaCompararCorelStatus;
  inspect_id?: string;
  arquivo?: string;
  erro?: string | null;
  diferencas?: PapelariaCorelDiferenca[];
}

/** Última prova da OS (job) — restaura modelo e composição frente/verso. */
export interface PapelariaUltimaProva {
  job_id: number | null;
  modelo_id: number;
  composicao: PapelariaComposicao | null;
}

export interface PapelariaOsContext {
  os: PapelariaOsContextOs;
  prefill: Record<string, string>;
  modelos: PapelariaCorelModelSummary[];
  autoSelectedModelId: number | null;
  /** Detalhe do modelo auto-selecionado (evita round-trip extra ao abrir a SP). */
  autoSelectedModel?: PapelariaCorelModelDetail | null;
  warnings: string[];
  cliente_alteracao?: PapelariaClienteAlteracao | null;
  /** Modelo + composição da última prova (ou do job da alteração pendente). */
  ultima_prova?: PapelariaUltimaProva | null;
  prova_modo?: "prova_web" | "prova_email" | "prova_pdf";
  /** Variável → fonte de preenchimento (Configurações → Variáveis). */
  variaveis_fonte?: Record<string, string>;
  /** Modo Prova PDF: modelos com PDF configurado (prova gerada no servidor, sem Corel). */
  prova_pdf_modelos?: number[];
  /** Campos do produto real da última prova (Corel da pasta), se houver. */
  campos_produto?: PapelariaCamposProduto | null;
  /** Andamento atual da SP (situação decide a visualização inicial). */
  andamento?: PapelariaAndamentoAtual | null;
  /** Fase da prova (mesma regra dos ícones da lista de SPs). */
  prova_status?: PapelariaProvaStatus | null;
}

export interface PapelariaAndamentoAtual {
  situacao: string;
  observacao: string;
  data: string | null;
}

/** Fase da prova — `approved` = aprovada pelo cliente. */
export interface PapelariaProvaStatus {
  phase: string | null;
  versao: number | null;
}

export type PapelariaJobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled";

export type PapelariaProvaRevisao =
  | "pending"
  | "approved"
  | "discarded"
  | "n_a";

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
  dados: Record<string, unknown>;
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
  /** Artefatos gerados (ex.: Timbrado A4 Digital — SVG/DOCX). */
  artefatos?: string[];
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


/** Frente e verso independentes: uma página (face) de um modelo. */
export interface PapelariaFaceRef {
  modelo_id: number;
  pagina: number;
}

export interface PapelariaComposicao {
  frente: PapelariaFaceRef;
  verso: PapelariaFaceRef;
}

export interface PapelariaFaceFonte extends PapelariaFaceRef {
  rotulo: string;
  arquivo_modelo: string;
  /** PDF do modelo configurado com essa página (obrigatório para compor). */
  tem_pdf: boolean;
  padrao: boolean;
}

export interface PapelariaFacesResponse {
  produto: string;
  cores: string;
  /** Pode escolher frente e verso (modo Prova PDF + produto frente e verso + opções com PDF). */
  disponivel: boolean;
  modo_prova_pdf: boolean;
  papel_modelo: "frente_verso" | "frente" | "verso";
  frente: PapelariaFaceFonte[];
  verso: PapelariaFaceFonte[];
  padrao: { frente: PapelariaFaceRef | null; verso: PapelariaFaceRef | null };
}
