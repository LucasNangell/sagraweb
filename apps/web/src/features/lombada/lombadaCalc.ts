/** Lógica de lombada espelhando CalcularLombada2010.mdb (formLombada). */

export const LOMBADA_MINIMA_MM = 6;
export const LOMBADA_MAXIMA_MM = 35;
export const DIF_LOMBADA_DEFAULT = 1.4;

export type TipoAcabamentoLombada =
  | "grampo_canoa"
  | "lombada_quadrada"
  | "espiral";

/** F Cad (mm) a partir da diferença L−C. Retorna null se não houver regra. */
export function ajustarFcad(difLombada: number): number | null {
  if (difLombada > 0 && difLombada <= 1) {
    return 0.5;
  }
  if (difLombada > 1 && difLombada <= 2) {
    return 1;
  }
  return null;
}

/**
 * F Cola (mm) a partir de páginas e Δ.
 * Diferença grande: Δ > 1.4; pequena: Δ < 1.5 (inclui default 1.4).
 */
export function ajustarFcola(pgs: number, difLombada: number): number | null {
  if (difLombada > 1.4) {
    if (pgs >= 1 && pgs <= 200) return 1;
    if (pgs >= 201 && pgs <= 400) return 2;
    if (pgs >= 401 && pgs <= 600) return 3;
    if (pgs >= 601 && pgs <= 800) return 4;
    return null;
  }
  if (difLombada < 1.5) {
    if (pgs >= 1 && pgs <= 200) return 0.5;
    if (pgs >= 201 && pgs <= 400) return 1;
    if (pgs >= 401 && pgs <= 600) return 2;
    if (pgs >= 601 && pgs <= 800) return 3;
    return null;
  }
  return null;
}

export function calcularLombadaMm(input: {
  pgs: number;
  mioloEspUm: number;
  capaEspUm: number;
  fcola: number;
  fcad: number;
}): number {
  const espMiolo = (input.pgs / 2) * (input.mioloEspUm / 1000);
  const espCapa = input.capaEspUm / 500;
  return espMiolo + espCapa + input.fcola + input.fcad;
}

export function lombadaSugeridaMm(lombadaMm: number): number {
  return Math.round(lombadaMm);
}

export function tipoAcabamento(lombadaMm: number): TipoAcabamentoLombada {
  if (lombadaMm > LOMBADA_MAXIMA_MM) {
    return "espiral";
  }
  if (lombadaMm >= LOMBADA_MINIMA_MM) {
    return "lombada_quadrada";
  }
  return "grampo_canoa";
}

export function labelTipoAcabamento(tipo: TipoAcabamentoLombada): string {
  switch (tipo) {
    case "grampo_canoa":
      return "Grampo Canoa";
    case "lombada_quadrada":
      return "Lombada Quadrada";
    case "espiral":
      return "Espiral";
  }
}
