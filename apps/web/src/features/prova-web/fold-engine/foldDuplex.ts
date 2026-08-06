/**
 * Duplex long-edge (“turn”): ao virar a folha na vertical, a marca a `pos`
 * mm da esquerda na frente corresponde a `span - pos` mm da esquerda no verso
 * (ou `pos` mm da direita).
 */
export function duplexMirrorPositionMm(positionMm: number, spanMm: number): number {
  return Math.round((spanMm - positionMm) * 10) / 10;
}

/**
 * Faixa do PDF de verso amostrada pelo verso de um painel da frente.
 * Com duplex turn: painel [x, x+w] amostra [W-(x+w), W-x] (mesma largura).
 */
export function duplexBackBandMm(
  panelXMm: number,
  panelWidthMm: number,
  pageWidthMm: number,
  duplexTurn: boolean,
): { u0: number; u1: number; bandWidthMm: number } {
  const x0 = panelXMm;
  const x1 = panelXMm + panelWidthMm;
  if (!duplexTurn) {
    return {
      u0: x0 / pageWidthMm,
      u1: x1 / pageWidthMm,
      bandWidthMm: panelWidthMm,
    };
  }
  const b0 = pageWidthMm - x1;
  const b1 = pageWidthMm - x0;
  return {
    u0: b0 / pageWidthMm,
    u1: b1 / pageWidthMm,
    bandWidthMm: b1 - b0,
  };
}
