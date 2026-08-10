import type { ProvaWebCropMetaResponse } from "@/api/provaWeb";

/** Fonte injetável para o assistente de crop (Prova WEB ou Análise Lab). */
export interface ProvaWebCropSource {
  pdfUrl: (relativePath: string) => string;
  fetchMeta: (
    relativePath: string,
    opts?: { detectMarks?: boolean },
  ) => Promise<ProvaWebCropMetaResponse>;
  /** Prefixo da queryKey do React Query (isola caches entre fontes). */
  keyPrefix: string;
}
