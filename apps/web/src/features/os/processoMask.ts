/** Máscara ProcessoSolicit: 00.000.000/0000 (12 dígitos). */
export const PROCESSO_FULL_DIGITS = 12;
export const PROCESSO_MIN_FILTER_DIGITS = 2;

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

/** Formata digitos (parciais ou completos) como 00.000.000/0000. */
export function formatProcessoMask(raw: string): string {
  const d = digitsOnly(raw).slice(0, PROCESSO_FULL_DIGITS);
  if (!d) return "";
  if (d.length <= 2) return d;
  const a = d.slice(0, 2);
  const rest1 = d.slice(2);
  if (rest1.length <= 3) return `${a}.${rest1}`;
  const b = rest1.slice(0, 3);
  const rest2 = rest1.slice(3);
  if (rest2.length <= 3) return `${a}.${b}.${rest2}`;
  const c = rest2.slice(0, 3);
  const rest3 = rest2.slice(3);
  return `${a}.${b}.${c}/${rest3}`;
}
