export const GRAVACAO_COLUMN_IDS = [
  "grav_pendente",
  "saida_grav_ext",
  "recebido_grav_ext",
  "grav_concluida",
] as const;

export type GravacaoColumnId = (typeof GRAVACAO_COLUMN_IDS)[number];

export interface GravacaoChapa {
  maquina: string;
  quantidade: number;
  quantidade_restante?: number;
}

export interface GravacaoSession {
  gravacao_externa_id?: number | null;
  gravacao_pendente_id?: number | null;
  fornecedor_ponto?: string | null;
  fornecedor_nome?: string | null;
  status?: string | null;
  componente?: string | null;
  chapas_por_maquina: GravacaoChapa[];
}

export interface GravacaoOsMembro {
  nr_os: number;
  ano: number;
}

export interface GravacaoBoardCard {
  nr_os: number;
  ano: number;
  situacao?: string | null;
  setor?: string | null;
  last_update?: string | null;
  prioridade?: string | null;
  juntada_grupo_id?: string | null;
  membros?: GravacaoOsMembro[];
  sessions: GravacaoSession[];
}

export interface GravacaoDisplayCard extends GravacaoBoardCard {
  uniqueKey: string;
  columnId: GravacaoColumnId;
}

export interface GravacaoDisplayColumn {
  id: GravacaoColumnId;
  title: string;
  items: GravacaoDisplayCard[];
}

export interface GravacaoBoardResponse {
  columns: Partial<Record<GravacaoColumnId, GravacaoBoardCard[]>>;
}

export interface GravacaoLancarChapa {
  gravacao_externa_id?: number | null;
  maquina: string;
  quantidade: number;
}

export interface GravacaoLancarPayload {
  situacao: string;
  setor: string;
  obs: string;
  usuario: string;
  column_id: GravacaoColumnId;
  gravacao_externa_ids: number[];
  chapas: GravacaoLancarChapa[];
}

export interface GravacaoLancarResponse {
  new_id: string;
  entrega_completa_ids?: number[];
}
