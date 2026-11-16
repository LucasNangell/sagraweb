import { emailProofFileUrl } from "@/api/email";
import { papelariaJobFileUrl } from "@/api/papelaria";
import { extractProvaVersionFromFilename } from "@/features/email/utils/proofFilePicker";

import type { PapelariaJob } from "./types";

const BASE_SEFOC_RE = /BaseSefoc\.pdf$/i;

export type PapelariaProvaDisplay = {
  /** URL do iframe / abrir PDF. */
  pdfUrl: string;
  /** Nome do arquivo exibido. */
  fileLabel: string;
  /** Número da prova (1, 2, …) quando identificável. */
  versao: number | null;
  /** Rótulo curto: "Prova 2". */
  provaLabel: string | null;
};

/**
 * PDF mostrado na visualização de prova.
 * Em prova web, preferir *-ProvaN.pdf (sem brancos) mesmo se o job ainda
 * apontar para BaseSefoc.pdf.
 */
export function resolvePapelariaProvaDisplay(
  job: Pick<
    PapelariaJob,
    | "id"
    | "ano_protocolo"
    | "nro_protocolo"
    | "arquivo_pdf"
    | "versao"
    | "dados"
  > | null | undefined,
): PapelariaProvaDisplay | null {
  if (!job) return null;
  const arquivo = (job.arquivo_pdf || "").trim();
  if (!arquivo) return null;

  const dados = job.dados ?? {};
  const provaWebName = String(dados.prova_web_pdf_name ?? "").trim();
  const provaEmailName = String(dados.prova_email_pdf_name ?? "").trim();
  const prefersProvaFile =
    BASE_SEFOC_RE.test(arquivo) && Boolean(provaWebName || provaEmailName);
  const displayFile = prefersProvaFile
    ? provaWebName || provaEmailName
    : arquivo;

  const pdfUrl = prefersProvaFile
    ? emailProofFileUrl(job.ano_protocolo, job.nro_protocolo, displayFile)
    : papelariaJobFileUrl(job.id, "pdf");

  const fromName = extractProvaVersionFromFilename(displayFile);
  const fromDados = Number(dados.prova_numero);
  const fromJob = Number(job.versao);
  const versao =
    fromName ??
    (Number.isFinite(fromDados) && fromDados > 0 ? fromDados : null) ??
    (Number.isFinite(fromJob) && fromJob > 0 && !BASE_SEFOC_RE.test(displayFile)
      ? fromJob
      : null) ??
    (Number.isFinite(fromJob) && fromJob > 0 ? fromJob : null);

  return {
    pdfUrl,
    fileLabel: displayFile,
    versao,
    provaLabel: versao != null ? `Prova ${versao}` : null,
  };
}
