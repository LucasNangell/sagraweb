/** Chaves de sessionStorage — compatíveis com o legado (script.js / papelaria.js). */
export const PAPELARIA_SESSION_KEYS = {
  osId: "sagra_current_os_id",
  osAno: "sagra_current_os_ano",
  targetProduct: "sagra_target_product",
} as const;

export interface PapelariaSessionContext {
  osId: string | null;
  osAno: string | null;
  targetProduct: string | null;
}

export function readPapelariaSession(): PapelariaSessionContext {
  return {
    osId: sessionStorage.getItem(PAPELARIA_SESSION_KEYS.osId),
    osAno: sessionStorage.getItem(PAPELARIA_SESSION_KEYS.osAno),
    targetProduct: sessionStorage.getItem(PAPELARIA_SESSION_KEYS.targetProduct),
  };
}

export function setPapelariaNavigationContext(os: {
  nr_os: number;
  ano: number;
  produto?: string | null;
}): void {
  sessionStorage.setItem(PAPELARIA_SESSION_KEYS.osId, String(os.nr_os));
  sessionStorage.setItem(PAPELARIA_SESSION_KEYS.osAno, String(os.ano));
  if (os.produto?.trim()) {
    sessionStorage.setItem(PAPELARIA_SESSION_KEYS.targetProduct, os.produto.trim());
  }
}

export function clearPapelariaTargetProduct(): void {
  sessionStorage.removeItem(PAPELARIA_SESSION_KEYS.targetProduct);
}

/** OS >= 5000 usam o fluxo Corel (modelos + fila de jobs). */
export function isPapelariaCorelOs(osId: string | null | undefined): boolean {
  if (!osId) return false;
  const nro = parseInt(osId, 10);
  return Number.isFinite(nro) && nro >= 5000;
}

/** Produtos de papelaria com modelos Corel configurados no banco de dados. */
export const PAPELARIA_PRODUCTS = [
  "Bloco A5",
  "Ct de Cumprimento",
  "Ct Duplo Paisagem Lateral",
  "Ct Duplo Paisagem Topo",
  "Ct Duplo Retrato Lateral",
  "Ct Gab Simples (Cor)",
  "Ct Visita",
  "Pasta Avulso c/ Bolso",
  "Pasta Avulso s/ Bolso",
  "Timbrado A4",
  "Timbrado A4 (Digital)",
];

export function isPapelariaProduct(product: string | null | undefined): boolean {
  if (!product) return false;
  const pNorm = product.trim().toLowerCase();
  return PAPELARIA_PRODUCTS.some((p) => p.toLowerCase() === pNorm);
}

/** Match exato do produto OS "Timbrado A4 (Digital)" (não confunde com Timbrado A4). */
export function isTimbradoA4DigitalProduct(
  product: string | null | undefined,
): boolean {
  if (!product) return false;
  return product.trim().toLowerCase() === "timbrado a4 (digital)";
}

export type PapelariaTabId = "cartao" | "corel";

/**
 * Aba inicial: Corel quando há OS de papelaria no sessionStorage;
 * SVG quando não há OS ou número < 5000 (cartão de visita legado).
 */
export function resolveInitialPapelariaTab(
  session: PapelariaSessionContext = readPapelariaSession(),
): PapelariaTabId {
  return isPapelariaCorelOs(session.osId) || isPapelariaProduct(session.targetProduct)
    ? "corel"
    : "cartao";
}
