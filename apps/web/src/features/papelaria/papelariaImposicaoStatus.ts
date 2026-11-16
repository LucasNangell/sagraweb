import type { PapelariaJob } from "./types";

type JobLike = Pick<
  PapelariaJob,
  "tipo_job" | "status" | "arquivo_pdf" | "tem_arquivo_pdf" | "dados"
>;

/** Job de imposição concluído ainda sem PDF Digital (Apogee processando). */
export function isWaitingImposicaoApogee(
  job: JobLike | null | undefined,
): boolean {
  if (!job || job.tipo_job !== "imposicao" || job.status !== "completed") {
    return false;
  }
  const dados = job.dados ?? {};
  if (dados.aguardando_apogee === true) {
    return true;
  }
  const pdf = (job.arquivo_pdf || "").trim();
  return !pdf || pdf.toLowerCase().endsWith(".jdf");
}

/** Job de imposição com PDF Digital pronto para visualização. */
export function isReadyImposicaoPdf(
  job: JobLike | null | undefined,
): boolean {
  if (!job || job.tipo_job !== "imposicao" || job.status !== "completed") {
    return false;
  }
  if (isWaitingImposicaoApogee(job)) {
    return false;
  }
  const pdf = (job.arquivo_pdf || "").trim();
  return Boolean(job.tem_arquivo_pdf || pdf);
}
