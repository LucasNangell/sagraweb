/** Config salva no modelo — campos suficientes para gerar JDF Apogee no futuro. */
export type PapelariaImposicaoPaginaOrigem = "borda" | "fixixa";
export type PapelariaImposicaoWorkStyle = "Simplex";

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
  };
  /** Gap entre páginas (mm). 0 = corte seco. */
  espacamento_mm: {
    horizontal: number;
    vertical: number;
  };
  /** Sangria / bleed (mm). 0 = sem sangria. */
  sangria_mm: number;
  /** true = MarkObject + CutMark (4 cantos) no Layout JDF. */
  marcas_corte: boolean;
  /** Distribui sobra da folha igualmente (margens). */
  centralizar_na_folha: boolean;
  /** SourceWorkStyle do Sheet. */
  work_style: PapelariaImposicaoWorkStyle;
}

/** Default alinhado ao exemplo JDF A5 2×1 em A4 paisagem, corte seco, sem marcas. */
export const DEFAULT_IMPOSICAO_CONFIG: PapelariaImposicaoConfig = {
  folha_mm: { largura: 297, altura: 210 },
  pagina: { origem: "fixixa", largura_mm: 148, altura_mm: 210 },
  grid: { colunas: 2, linhas: 1 },
  espacamento_mm: { horizontal: 0, vertical: 0 },
  sangria_mm: 0,
  marcas_corte: false,
  centralizar_na_folha: true,
  work_style: "Simplex",
};
