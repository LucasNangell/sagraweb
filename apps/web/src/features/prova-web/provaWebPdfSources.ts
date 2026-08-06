import type { ProvaWebRecord } from "@/api/provaWeb";

/** Fonte de PDF original da Prova WEB (aba PDF). */
export interface ProvaWebPdfSource {
  /** unico | capa | miolo — id estável para seletor / portal. */
  id: "unico" | "capa" | "miolo";
  label: string;
  /** Caminho relativo na pasta da OS (só staff). Portal usa só `id`. */
  path?: string;
}

/** Monta lista de fontes a partir do registro tabProvaWeb. */
export function pdfSourcesFromRecord(
  record: ProvaWebRecord | null | undefined,
): ProvaWebPdfSource[] {
  if (!record) return [];
  const modo = record.modo;
  if (modo === "capa_miolo") {
    const out: ProvaWebPdfSource[] = [];
    if (record.arquivoCapa) {
      out.push({ id: "capa", label: "Capa", path: record.arquivoCapa });
    }
    if (record.arquivoMiolo) {
      out.push({ id: "miolo", label: "Miolo", path: record.arquivoMiolo });
    }
    return out;
  }
  if (modo === "espiral") {
    const kind = record.cropJson?.espiral?.sourceKind ?? "unico";
    if (kind === "capa_miolo") {
      const out: ProvaWebPdfSource[] = [];
      if (record.arquivoCapa) {
        out.push({ id: "capa", label: "Capa", path: record.arquivoCapa });
      }
      if (record.arquivoMiolo) {
        out.push({ id: "miolo", label: "Miolo", path: record.arquivoMiolo });
      }
      return out;
    }
    if (record.arquivoUnico) {
      return [
        { id: "unico", label: "Espiral", path: record.arquivoUnico },
      ];
    }
    return [];
  }
  if (record.arquivoUnico) {
    return [
      {
        id: "unico",
        label: modo === "folha_dobrada" ? "Folheto" : "PDF",
        path: record.arquivoUnico,
      },
    ];
  }
  return [];
}
