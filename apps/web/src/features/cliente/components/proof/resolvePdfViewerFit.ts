import type { PdfViewerFit } from "./ClienteProofViewer";
import type { PapelariaMockupOrientacao } from "@/features/papelaria/mockup";

/** Retrato → ajuste pela altura; paisagem → pela largura. */
export function resolvePdfViewerFit(
  orientacao?: PapelariaMockupOrientacao | null,
  widthMm?: number,
  heightMm?: number,
): PdfViewerFit {
  if (orientacao === "retrato") {
    return "height";
  }
  if (orientacao === "paisagem") {
    return "width";
  }
  if (widthMm && heightMm && widthMm > 0 && heightMm > 0) {
    return heightMm > widthMm ? "height" : "width";
  }
  return "page-fit";
}
