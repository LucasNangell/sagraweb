import type { ReactNode } from "react";

import type { ProvaWebManifestBase, ProvaWebPageMeta } from "@/api/provaWeb";

/** Contrato tipado espelhando props públicas do flipbook (sem importar o componente). */
export interface ProvaWebFlipbookPropsLike {
  ano: number;
  osId: number;
  manifest: ProvaWebManifestBase;
  buildPageUrl?: (page: number) => string;
  renderPageOverlay?: (
    page: ProvaWebPageMeta,
    size: { width: number; height: number },
  ) => ReactNode;
}
