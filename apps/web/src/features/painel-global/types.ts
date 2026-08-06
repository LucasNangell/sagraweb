export interface PainelColumnConfig {
  id: string;
  title: string;
  muted?: boolean;
  sectors: string[];
  statuses: string[];
  sector?: string;
}

export interface PainelConfig {
  columnCount: number;
  columns: PainelColumnConfig[];
}

export type PainelPriorityType = "priority-high" | "priority-medium" | null;

export interface PainelRawOp {
  nr_os: number;
  ano: number;
  titulo?: string | null;
  Titulo?: string | null;
  produto?: string | null;
  Produto?: string | null;
  prod_nome?: string | null;
  situacao?: string | null;
  setor?: string | null;
  prioridade?: string | null;
  last_update?: string | null;
  observacao?: string | null;
  Observacao?: string | null;
  Observaçao?: string | null;
  nome_usuario?: string | null;
  NomeUsuario?: string | null;
  NOMEUSUARIO?: string | null;
  Nomeusuario?: string | null;
  usuario?: string | null;
  Usuario?: string | null;
  USUARIO?: string | null;
  solicitante?: string | null;
  Solicitante?: string | null;
  EntregData?: string | null;
  ENTREGDATA?: string | null;
  entregData?: string | null;
  DataEntrega?: string | null;
  data_entrega?: string | null;
  dt_entrega?: string | null;
  PrevisaoEntrega?: string | null;
  dt_entrega_prevista?: string | null;
  EntregPeriodo?: string | null;
  ENTREGPERIODO?: string | null;
  entreg_periodo?: string | null;
  periodo?: string | null;
  Periodo?: string | null;
  pcp_ordem?: number | null;
  TipoPublicacaoLink?: string | null;
  EntregPrazoLink?: string | null;
  DataEntrada?: string | null;
  DATAENTRADA?: string | null;
  dataentrada?: string | null;
  data_entrada?: string | null;
  data_emissao?: string | null;
  dt_emissao?: string | null;
  SituacaoLink?: string | null;
  fetchedSector?: string;
  row_kind?: "main_os" | "sub_os";
  sub_os_id?: number;
  display_label?: string | null;
  display_nr_os?: string | null;
  componente_nome?: string | null;
  parent_nr_os?: number;
  parent_ano?: number;
  [key: string]: unknown;
}

export interface PainelOpItem extends PainelRawOp {
  uniqueKey: string;
  priorityType: PainelPriorityType;
  isNew: boolean;
  lastColumnId: string | null;
  sourceOrder: number;
  displaySituacao: string;
  normalizedEntrega: string | null;
  normalizedSolicitante: string;
  normalizedTurno: string | null;
}

export interface PainelColumnDisplay extends PainelColumnConfig {
  items: PainelOpItem[];
}

export interface PainelColumnDetail {
  title: string;
  items: PainelOpItem[];
}

export interface PainelDrillDownParams {
  month: number | null;
  category: number | null;
  sector: string | null;
}

export type PainelTheme = "dark" | "light";
