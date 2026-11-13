export type PapelariaImposicaoPaginaOrigem = "borda";

export interface PapelariaImposicaoConfig {
  folha: {
    largura_mm: number;
    altura_mm: number;
  };
  pagina: {
    origem: PapelariaImposicaoPaginaOrigem;
    rotacao_graus: number;
  };
  grid: {
    colunas: number;
    linhas: number;
    repeticoes: number;
  };
  espacamento_mm: {
    horizontal: number;
    vertical: number;
  };
  margens_mm: {
    esquerda: number;
    direita: number;
    superior: number;
    inferior: number;
  };
  marcas_corte: boolean;
  separacao_paginas: boolean;
  incluir_verso: boolean;
}

export const DEFAULT_IMPOSICAO_CONFIG: PapelariaImposicaoConfig = {
  folha: { largura_mm: 320, altura_mm: 450 },
  pagina: { origem: "borda", rotacao_graus: 0 },
  grid: { colunas: 2, linhas: 5, repeticoes: 10 },
  espacamento_mm: { horizontal: 2, vertical: 2 },
  margens_mm: { esquerda: 5, direita: 5, superior: 5, inferior: 5 },
  marcas_corte: true,
  separacao_paginas: true,
  incluir_verso: true,
};
