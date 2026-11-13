import {
  DEFAULT_IMPOSICAO_CONFIG,
  type PapelariaImposicaoConfig,
} from "./types";

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function requirePositive(
  obj: Record<string, unknown>,
  key: string,
  allowZero = false,
): number {
  const value = obj[key];
  if (!isNumber(value)) {
    throw new Error(`${key} deve ser numérico.`);
  }
  if (allowZero) {
    if (value < 0) throw new Error(`${key} deve ser >= 0.`);
  } else if (value <= 0) {
    throw new Error(`${key} deve ser > 0.`);
  }
  return value;
}

function requirePositiveInt(obj: Record<string, unknown>, key: string): number {
  const value = obj[key];
  if (!isNumber(value) || !Number.isInteger(value) || value < 1) {
    throw new Error(`${key} deve ser inteiro >= 1.`);
  }
  return value;
}

function requireBool(obj: Record<string, unknown>, key: string): boolean {
  const value = obj[key];
  if (typeof value !== "boolean") {
    throw new Error(`${key} deve ser booleano.`);
  }
  return value;
}

export function validateImposicaoConfigObject(
  data: unknown,
): PapelariaImposicaoConfig {
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Configuração de imposição deve ser um objeto JSON.");
  }
  const raw = data as Record<string, unknown>;

  const folhaRaw = raw.folha;
  if (!folhaRaw || typeof folhaRaw !== "object" || Array.isArray(folhaRaw)) {
    throw new Error("Campo obrigatório ausente: folha.");
  }
  const folha = folhaRaw as Record<string, unknown>;

  const paginaRaw = raw.pagina;
  if (!paginaRaw || typeof paginaRaw !== "object" || Array.isArray(paginaRaw)) {
    throw new Error("Campo obrigatório ausente: pagina.");
  }
  const pagina = paginaRaw as Record<string, unknown>;
  if (pagina.origem !== "borda") {
    throw new Error("pagina.origem inválido. Valores: borda.");
  }
  const rotacao = pagina.rotacao_graus ?? 0;
  if (!isNumber(rotacao)) {
    throw new Error("pagina.rotacao_graus deve ser numérico.");
  }

  const gridRaw = raw.grid;
  if (!gridRaw || typeof gridRaw !== "object" || Array.isArray(gridRaw)) {
    throw new Error("Campo obrigatório ausente: grid.");
  }
  const grid = gridRaw as Record<string, unknown>;

  const espRaw = raw.espacamento_mm;
  if (!espRaw || typeof espRaw !== "object" || Array.isArray(espRaw)) {
    throw new Error("Campo obrigatório ausente: espacamento_mm.");
  }
  const esp = espRaw as Record<string, unknown>;

  const margRaw = raw.margens_mm;
  if (!margRaw || typeof margRaw !== "object" || Array.isArray(margRaw)) {
    throw new Error("Campo obrigatório ausente: margens_mm.");
  }
  const marg = margRaw as Record<string, unknown>;

  return {
    folha: {
      largura_mm: requirePositive(folha, "largura_mm"),
      altura_mm: requirePositive(folha, "altura_mm"),
    },
    pagina: {
      origem: "borda",
      rotacao_graus: rotacao,
    },
    grid: {
      colunas: requirePositiveInt(grid, "colunas"),
      linhas: requirePositiveInt(grid, "linhas"),
      repeticoes: requirePositiveInt(grid, "repeticoes"),
    },
    espacamento_mm: {
      horizontal: requirePositive(esp, "horizontal", true),
      vertical: requirePositive(esp, "vertical", true),
    },
    margens_mm: {
      esquerda: requirePositive(marg, "esquerda", true),
      direita: requirePositive(marg, "direita", true),
      superior: requirePositive(marg, "superior", true),
      inferior: requirePositive(marg, "inferior", true),
    },
    marcas_corte: requireBool(raw, "marcas_corte"),
    separacao_paginas: requireBool(raw, "separacao_paginas"),
    incluir_verso: requireBool(raw, "incluir_verso"),
  };
}

export function parseImposicaoConfigJson(
  raw: string | null | undefined,
): PapelariaImposicaoConfig | null {
  if (!raw?.trim()) return null;
  const parsed = JSON.parse(raw) as unknown;
  return validateImposicaoConfigObject(parsed);
}

export function formatImposicaoConfigJson(config: PapelariaImposicaoConfig): string {
  return JSON.stringify(config, null, 2);
}

export function cloneDefaultImposicaoConfig(): PapelariaImposicaoConfig {
  return structuredClone(DEFAULT_IMPOSICAO_CONFIG);
}

export function configFromModeloOrDefault(
  raw: string | null | undefined,
): PapelariaImposicaoConfig {
  try {
    return parseImposicaoConfigJson(raw) ?? cloneDefaultImposicaoConfig();
  } catch {
    return cloneDefaultImposicaoConfig();
  }
}
