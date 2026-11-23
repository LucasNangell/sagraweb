/** Mockup 3D por produto: variação «frente» (só frente) e «frente_verso». */
export type MockupProduto = {
  frente?: string | null;
  frente_verso?: string | null;
};

export type ModeloComMockup = {
  mockup_config_json?: string | null;
  /** MockupConfigJson próprio do modelo (reserva enquanto o produto não tem o seu). */
  mockup_config_json_modelo?: string | null;
  mockup_produto?: MockupProduto | null;
};

/**
 * JSON de mockup que vale para a prova: o do produto, escolhido pelas páginas
 * da prova (2+ páginas = frente e verso); sem configuração do produto para
 * essa variação, o do próprio modelo; sem nenhum, `null` (preset automático).
 */
export function mockupJsonEfetivo(
  modelo: ModeloComMockup | null | undefined,
  pageCount: number,
): string | null | undefined {
  if (!modelo) return undefined;
  const doProduto = modelo.mockup_produto;
  if (!doProduto) return modelo.mockup_config_json;
  const variante = pageCount >= 2 ? doProduto.frente_verso : doProduto.frente;
  if (variante?.trim()) return variante;
  return modelo.mockup_config_json_modelo ?? null;
}
