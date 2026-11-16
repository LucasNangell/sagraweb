/** Dimensões do produto exibido: fechado quando existir; senão aberto. */
export function resolveProductDimensionsMm(config: {
  larguraAbertaMm: number;
  alturaAbertaMm: number;
  larguraFechadaMm?: number;
  alturaFechadaMm?: number;
}): { widthMm: number; heightMm: number } {
  return {
    widthMm: config.larguraFechadaMm ?? config.larguraAbertaMm,
    heightMm: config.alturaFechadaMm ?? config.alturaAbertaMm,
  };
}

export function formatDimensionMm(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "—";
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}
