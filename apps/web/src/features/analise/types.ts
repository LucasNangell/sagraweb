/** Item da biblioteca (GET /api/analise/problemas-padrao). */
export interface ProblemaPadrao {
  ID: number;
  TituloPT: string;
  ProbTecHTML: string;
  Categoria: string;
}

/** Item instanciado na análise da OS. */
export interface AnaliseSelectedItem {
  uniqueId: number;
  originalId?: number;
  titulo: string;
  html: string;
  obs: string;
  componenteOrigem: string;
  /** Versão em que o item foi registrado (chave vN ou rótulo da pasta). */
  versaoOrigem?: string;
  resolucaoObrigatoria?: boolean;
  /** Corrigido internamente pela SEFOC — não enviado ao cliente. */
  corrigidoSefoc?: boolean;
  obsCorrecaoSefoc?: string;
}

export interface AnaliseFullResponse {
  exists: boolean;
  id?: number;
  versao?: string;
  componente?: string;
  items?: AnaliseSelectedItem[];
}

export interface OsVersionItem {
  version: number;
  label: string;
  path: string;
}

export interface OsVersionsResponse {
  versions: OsVersionItem[];
}

export interface UltimoAndamento {
  situacao?: string | null;
  setor?: string | null;
  ponto?: string | null;
  obs?: string | null;
}

export interface AnaliseFileEntry {
  name: string;
  path: string;
  type: string;
}

export type AnaliseSearchParams = {
  ano?: string;
  id?: string;
};

export const ANALISE_COMPONENTES = ["Capa", "Miolo", "Arq. Único"] as const;

export type AnaliseComponente = (typeof ANALISE_COMPONENTES)[number];
