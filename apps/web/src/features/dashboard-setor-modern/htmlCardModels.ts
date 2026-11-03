const HTML_CARD_MODEL_IDS = new Set(["lab-vidro-fosco"]);

export function isHtmlCardModel(id: string | undefined): boolean {
  return Boolean(id && HTML_CARD_MODEL_IDS.has(id));
}
