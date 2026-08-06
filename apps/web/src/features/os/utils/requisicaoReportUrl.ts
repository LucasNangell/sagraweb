import { apiUrl } from "@/lib/api";

export type RequisicaoPrintMode = "normal" | "prova" | "prova_ficha";

export type ProvaFichaCorTipo = "policromia" | "pb";

export interface ProvaFichaCorOptions {
  capa: ProvaFichaCorTipo;
  miolo: ProvaFichaCorTipo;
}

export const DEFAULT_PROVA_FICHA_COR: ProvaFichaCorOptions = {
  capa: "pb",
  miolo: "pb",
};

export interface RequisicaoReportParams {
  ano: number;
  id: number;
  ponto?: string | number | null;
  mode?: RequisicaoPrintMode;
  provaCor?: ProvaFichaCorOptions;
}

/** Monta a URL do relatório A5 (GET /api/reports/requisicao/{ano}/{id}). */
export function buildRequisicaoReportUrl({
  ano,
  id,
  ponto,
  mode = "normal",
  provaCor,
}: RequisicaoReportParams): string {
  const params = new URLSearchParams();
  if (ponto != null && String(ponto).trim()) {
    params.set("ponto", String(ponto).trim());
  }
  if (mode === "prova" || mode === "prova_ficha") {
    params.set("mode", mode);
  }
  if (mode === "prova_ficha" && provaCor) {
    params.set("prova_capa", provaCor.capa);
    params.set("prova_miolo", provaCor.miolo);
  }
  const qs = params.toString();
  return apiUrl(
    `/reports/requisicao/${ano}/${id}${qs ? `?${qs}` : ""}`,
  );
}
