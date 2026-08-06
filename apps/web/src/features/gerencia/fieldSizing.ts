/**
 * Larguras/alturas de campos calibradas por CHAR_LENGTH no MySQL
 * (tools/audit_os_field_lengths.py --year 2024).
 *
 * No modal usa-se grade 12 colunas (col-span), não max-width solto —
 * assim os campos ficam alinhados sem vãos.
 *
 * Regras (p90 → colunas):
 * - ≤ 8   → 2 cols (xs)
 * - ≤ 25  → 3 cols (sm)
 * - ≤ 60  → 4 cols (md)
 * - ≤ 100 → 6 cols (lg)
 * - > 100 → 12 cols (full)
 * textareas: rows ≈ ceil(p90 / 50), min 2, max 6
 */

export type FieldSizeTier = "xs" | "sm" | "md" | "lg" | "full";

export interface FieldLengthStats {
  avg: number;
  p50: number;
  p90: number;
  max: number;
  n: number;
}

/** Snapshot gerado de audit_os_field_lengths.py (Ano >= 2024). */
export const FIELD_LENGTH_STATS: Record<string, FieldLengthStats> = {
  req_solicitante: { n: 10043, avg: 20.2, p50: 16, p90: 35, max: 72 },
  req_orgao_interessado: { n: 838, avg: 29.8, p50: 33, p90: 39, max: 72 },
  req_titular: { n: 206, avg: 13.1, p50: 12, p90: 17, max: 24 },
  req_sigla: { n: 3012, avg: 5.2, p50: 5, p90: 6, max: 9 },
  req_gabinete: { n: 5923, avg: 3.0, p50: 3, p90: 3, max: 3 },
  req_andar: { n: 3741, avg: 1.1, p50: 1, p90: 1, max: 7 },
  req_local: { n: 4234, avg: 7.3, p50: 8, p90: 9, max: 20 },
  req_codigo: { n: 6945, avg: 5.0, p50: 5, p90: 5, max: 5 },
  req_categoria: { n: 10043, avg: 6.7, p50: 8, p90: 8, max: 8 },
  op_processo: { n: 1256, avg: 12.0, p50: 12, p90: 12, max: 12 },
  op_cs: { n: 210, avg: 9.0, p50: 9, p90: 9, max: 9 },
  txt_contato: { n: 5884, avg: 64.8, p50: 56, p90: 118, max: 389 },
  val_prioridade: { n: 10043, avg: 7.7, p50: 6, p90: 13, max: 13 },
  val_titulo: { n: 10042, avg: 23.0, p50: 19, p90: 40, max: 50 },
  val_produto: { n: 10043, avg: 11.4, p50: 9, p90: 21, max: 25 },
  val_formato: { n: 10032, avg: 9.9, p50: 9, p90: 24, max: 25 },
  val_maquina: { n: 10043, avg: 10.1, p50: 11, p90: 14, max: 14 },
  val_papel: { n: 10025, avg: 11.7, p50: 8, p90: 18, max: 20 },
  txt_papel_desc: { n: 4611, avg: 24.8, p50: 28, p90: 30, max: 100 },
  val_cores: { n: 10040, avg: 9.6, p50: 10, p90: 10, max: 11 },
  txt_cores_desc: { n: 1613, avg: 33.5, p50: 31, p90: 53, max: 147 },
  txt_acabamento: { n: 9865, avg: 40.2, p50: 27, p90: 94, max: 360 },
  txt_obs: { n: 7278, avg: 89.8, p50: 105, p90: 146, max: 699 },
  mat_insumos: { n: 678, avg: 22.2, p50: 17, p90: 36, max: 119 },
};

function tierFromP90(p90: number): FieldSizeTier {
  if (p90 <= 8) return "xs";
  if (p90 <= 25) return "sm";
  if (p90 <= 60) return "md";
  if (p90 <= 100) return "lg";
  return "full";
}

function textareaRowsFromP90(p90: number): number {
  return Math.min(6, Math.max(2, Math.ceil(p90 / 50)));
}

/** Span CSS na grade 12 do modal. */
export const FIELD_COL_SPAN: Record<FieldSizeTier, string> = {
  xs: "col-span-2",
  sm: "col-span-3",
  md: "col-span-4",
  lg: "col-span-6",
  full: "col-span-12",
};

export function fieldTier(formKey: string): FieldSizeTier {
  const stats = FIELD_LENGTH_STATS[formKey];
  if (!stats) return "md";
  return tierFromP90(stats.p90);
}

/** @deprecated Prefer fieldColSpan for modal grids. */
export function fieldClass(formKey: string): string {
  return FIELD_COL_SPAN[fieldTier(formKey)];
}

export function fieldColSpan(formKey: string): string {
  return FIELD_COL_SPAN[fieldTier(formKey)];
}

export function textareaRows(formKey: string, fallback = 3): number {
  const stats = FIELD_LENGTH_STATS[formKey];
  if (!stats) return fallback;
  return textareaRowsFromP90(stats.p90);
}
