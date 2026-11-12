import type { PapelariaJob, PapelariaJobStatus } from "./types";

export type PapelariaGenerationPhase =
  | "submitting"
  | "pending"
  | "processing"
  | "failed"
  | "cancelled"
  | null;

export function resolvePapelariaGenerationPhase(
  isGenerating: boolean,
  activeJob: Pick<PapelariaJob, "status"> | null,
): PapelariaGenerationPhase {
  if (
    activeJob &&
    (activeJob.status === "pending" || activeJob.status === "processing")
  ) {
    return activeJob.status;
  }
  if (isGenerating) return "submitting";
  if (activeJob?.status === "failed") return "failed";
  if (activeJob?.status === "cancelled") return "cancelled";
  return null;
}

export function papelariaGenerationStatusLabel(
  phase: PapelariaGenerationPhase,
  opts?: { ordemFila?: number | null; isTimbradoDigital?: boolean },
): { title: string; detail: string } {
  const digital = Boolean(opts?.isTimbradoDigital);
  switch (phase) {
    case "submitting":
      return {
        title: digital
          ? "Gerando Timbrado A4 Digital"
          : "Gerando arquivo Corel/PDF",
        detail: "Enviando solicitação para a fila...",
      };
    case "pending": {
      const ordem =
        opts?.ordemFila != null && opts.ordemFila > 0
          ? ` (posição ${opts.ordemFila})`
          : "";
      return {
        title: digital
          ? "Gerando Timbrado A4 Digital"
          : "Gerando arquivo Corel/PDF",
        detail: `Na fila${ordem} — aguardando o worker...`,
      };
    }
    case "processing":
      return {
        title: digital
          ? "Gerando Timbrado A4 Digital"
          : "Gerando arquivo Corel/PDF",
        detail: digital
          ? "Processando — CorelDRAW e Word em execução..."
          : "Processando — CorelDRAW em execução no worker...",
      };
    case "failed":
      return {
        title: "Erro na geração",
        detail: "A geração falhou. Veja os detalhes abaixo.",
      };
    case "cancelled":
      return {
        title: "Geração cancelada",
        detail: "A solicitação foi cancelada.",
      };
    default:
      return { title: "", detail: "" };
  }
}

export function isPapelariaJobInPipeline(
  status: PapelariaJobStatus | null | undefined,
): boolean {
  return status === "pending" || status === "processing";
}
