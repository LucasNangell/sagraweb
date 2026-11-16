/** Config salva no modelo — campos suficientes para gerar JDF Apogee no futuro. */
export type PapelariaImposicaoPaginaOrigem = "borda" | "fixixa";
export type PapelariaImposicaoWorkStyle = "Simplex" | "Duplex";

/** Rotação da página na célula (graus, sentido anti-horário). */
export type PapelariaImposicaoRotacao = 0 | 90 | 180 | 270;

export type PapelariaImposicaoOcupada = {
  col: number;
  row: number;
  /** Número da página do PDF (1-based). Pode repetir em várias células. */
  pagina: number;
  /** Rotação na célula; omitido = 0. */
  rotacao?: PapelariaImposicaoRotacao;
};

export interface PapelariaImposicaoConfig {
  /** Media Dimension da folha (mm). Ex.: A4 paisagem 297×210. */
  folha_mm: {
    largura: number;
    altura: number;
  };
  /** TrimSize da página: BordaF/V ou tamanho fixo (mm). */
  pagina: {
    origem: PapelariaImposicaoPaginaOrigem;
    largura_mm?: number;
    altura_mm?: number;
  };
  /** Step & repeat: colunas × linhas (ex.: 2×1). */
  grid: {
    colunas: number;
    linhas: number;
    /**
     * Células da frente com página (0-based). Omitido = grade cheia na ordem linha-major.
     * `pagina` = número 1..N do PDF; pode repetir (ex.: todas as células = página 1).
     */
    ocupadas?: PapelariaImposicaoOcupada[];
    /**
     * Células do verso (só com work_style Duplex). Omitido = grade cheia sequencial.
     */
    ocupadas_verso?: PapelariaImposicaoOcupada[];
  };
  /** Gap entre páginas (mm). 0 = corte seco. */
  espacamento_mm: {
    horizontal: number;
    vertical: number;
  };
  /** Sangria / bleed (mm). 0 = sem sangria. */
  sangria_mm: number;
  /**
   * true = inclui PDF de marcas no JDF (RL_Marcas + MarkObject).
   * NamedFeatures sempre usa JDFNoMarks (marcas vêm do PDF).
   */
  marcas_corte: boolean;
  /** Caminho UNC/local do PDF de marcas (obrigatório se marcas_corte). */
  marcas_pdf_path: string | null;
  /**
   * PDF template da folha de imposição (Pasta Avulso pré-impresso).
   * Se vazio, usa marcas_pdf_path quando disponível.
   */
  imposicao_pdf_path: string | null;
  /** Distribui sobra da folha igualmente (margens). */
  centralizar_na_folha: boolean;
  /** SourceWorkStyle do Sheet. */
  work_style: PapelariaImposicaoWorkStyle;
  /**
   * Timbrado A4 / Pasta Avulso: PDF de imposição sem brasão (pré-impresso).
   * Default false no schema genérico; produtos elegíveis usam true no seed.
   */
  usar_pre_impresso: boolean;
  /**
   * Hotfolder Apogee (UNC). Null/vazio = resolver por família de produto.
   */
  jdf_import_root: string | null;
}

/** Default alinhado ao exemplo JDF A5 2×1 em A4 paisagem, corte seco, sem marcas. */
export const DEFAULT_IMPOSICAO_CONFIG: PapelariaImposicaoConfig = {
  folha_mm: { largura: 297, altura: 210 },
  pagina: { origem: "fixixa", largura_mm: 148, altura_mm: 210 },
  grid: { colunas: 2, linhas: 1 },
  espacamento_mm: { horizontal: 0, vertical: 0 },
  sangria_mm: 0,
  marcas_corte: false,
  marcas_pdf_path: null,
  imposicao_pdf_path: null,
  centralizar_na_folha: true,
  work_style: "Simplex",
  usar_pre_impresso: false,
  jdf_import_root: null,
};

/** Defaults de hotfolder Apogee por família (quando jdf_import_root vazio). */
export const DEFAULT_JDF_IMPORT_ROOT_PAPELARIA =
  "\\\\apogee\\JDFImportRoot\\Papelaria";
export const DEFAULT_JDF_IMPORT_ROOT_PASTA =
  "\\\\apogee\\JDFImportRoot\\Papelaria_Pasta";
export const DEFAULT_JDF_IMPORT_ROOT_TIMBRADO =
  "\\\\apogee\\JDFImportRoot\\Papelaria_Timbrado";
