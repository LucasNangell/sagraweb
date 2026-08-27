/** Estado do formulário — ids espelham gerencia.html */
export interface GerenciaFormState {
  req_categoria: string;
  req_codigo: string;
  req_solicitante: string;
  req_orgao_interessado: string;
  req_titular: string;
  req_sigla: string;
  req_gabinete: string;
  req_andar: string;
  req_local: string;
  req_ramal: string;

  op_os: string;
  op_ano: string;
  op_data_entrada: string;
  op_processo: string;
  op_cs: string;
  /** Saldo de cota do semestre (tabCotaCliente); somente leitura na UI. */
  op_cota_atual: string;
  op_tiragem_pret: string;
  op_tiragem_final: string;

  val_titulo: string;
  val_prioridade: string;
  val_data: string;
  val_turno: string;
  val_resp_grafica: string;
  val_forma_entrega: string;

  val_produto: string;
  val_maquina: string;
  val_tiragem: string;
  val_pgs: string;
  chk_fv: boolean;
  val_modelos: string;
  val_formato: string;

  val_pgs_capa1: string;
  val_papel_capa1: string;
  val_cores_capa1: string;
  val_pgs_capa2: string;
  val_papel_capa2: string;
  val_cores_capa2: string;
  val_pgs_mio: string;
  val_papel_mio: string;
  val_cores_mio: string;
  val_pgs_mio2: string;
  val_papel_mio2: string;
  val_cores_mio2: string;

  val_papel: string;
  txt_papel_desc: string;
  val_cores: string;
  txt_cores_desc: string;
  txt_acabamento: string;
  txt_obs: string;
  txt_contato: string;

  mat_amostra: boolean;
  mat_fotolito: boolean;
  mat_dobra: boolean;
  mat_original: boolean;
  mat_insumos: string;

  el_brasao: boolean;
  el_timbre: boolean;
  el_arte: boolean;
  el_assinatura: boolean;

  calc_capa_color: string;
  calc_capa_pb: string;
  calc_miolo_color: string;
  calc_miolo_pb: string;
  calc_encarte_color: string;
  calc_encarte_pb: string;
  calc_total_paginas: string;
  calc_tiragem: string;
  calc_altura: string;
  calc_largura: string;
  calc_coef_a4: string;
  calc_cota_total: string;
  /** DebitarCGRAF em tabProtocolos */
  chk_debitar_cgraf: boolean;
}

export interface GerenciaSearchParams {
  ano?: string;
  id?: string;
  action?: string;
  type?: string;
  modo?: string;
}

/** Resposta GET /api/os/{ano}/{id}/details */
export interface GerenciaOsDetails {
  CodigoRequisicao?: string | null;
  CategoriaLink?: string | null;
  NomeUsuario?: string | null;
  Titular?: string | null;
  OrgInteressado?: string | null;
  SiglaOrgao?: string | null;
  GabSalaUsuario?: string | null;
  Andar?: string | null;
  Localizacao?: string | null;
  RamalUsuario?: string | null;
  NroProtocolo?: number | null;
  AnoProtocolo?: number | null;
  DataEntrada?: string | null;
  ProcessoSolicit?: string | null;
  CSnro?: string | null;
  TiragemSolicitada?: string | null;
  TiragemFinal?: string | number | null;
  CotaRepro?: number | null;
  CotaCartao?: number | null;
  CotaAtualSaldo?: number | null;
  DebitarCGRAF?: boolean | number | string | null;
  Titulo?: string | null;
  TipoPublicacaoLink?: string | null;
  FormatoLink?: string | null;
  MaquinaLink?: string | null;
  Tiragem?: string | number | null;
  Pags?: string | number | null;
  FrenteVerso?: boolean | number | null;
  ModelosArq?: string | null;
  EntregPrazoLink?: string | null;
  EntregData?: string | null;
  EntregPeriodo?: string | null;
  EntregaFormaLink?: string | null;
  ResponsavelGrafLink?: string | null;
  PapelLink?: string | null;
  PapelDescricao?: string | null;
  Cores?: string | null;
  CoresDescricao?: string | null;
  DescAcabamento?: string | null;
  Observ?: string | null;
  ContatoTrab?: string | null;
  MaterialFornecido?: boolean | number | null;
  Fotolito?: boolean | number | null;
  ModeloDobra?: boolean | number | null;
  ProvaImpressa?: boolean | number | null;
  InsumosFornecidos?: string | null;
  ElemGrafBrasao?: boolean | number | null;
  ElemGrafTimbre?: boolean | number | null;
  ElemGrafArteGab?: boolean | number | null;
  ElemGrafAssinatura?: boolean | number | null;
  Calculos?: {
    capa_color?: number | string;
    capa_pb?: number | string;
    miolo_color?: number | string;
    miolo_pb?: number | string;
    encarte_color?: number | string;
    encarte_pb?: number | string;
    altura_mm?: number | string;
    largura_mm?: number | string;
    tiragem?: number | string;
    coef_a4?: number | string;
    total_paginas?: number | string;
    cota_total?: number | string;
  } | null;
}

export type GerenciaFormUpdater = (
  patch: Partial<GerenciaFormState> | ((prev: GerenciaFormState) => Partial<GerenciaFormState>),
) => void;
