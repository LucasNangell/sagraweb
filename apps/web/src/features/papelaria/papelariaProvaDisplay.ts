import { emailProofFileUrl } from "@/api/email";
import { papelariaJobFileUrl } from "@/api/papelaria";
import {
  extractProvaVersionFromFilename,
  shouldAdoptSuggestedProof,
} from "@/features/email/utils/proofFilePicker";

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

function resolveVersao(
  displayFile: string,
  dados: Record<string, unknown>,
  jobVersao: number | null | undefined,
): number | null {
  const fromName = extractProvaVersionFromFilename(displayFile);
  const fromDados = Number(dados.prova_numero);
  const fromJob = Number(jobVersao);
  return (
    fromName ??
    (Number.isFinite(fromDados) && fromDados > 0 ? fromDados : null) ??
    (Number.isFinite(fromJob) && fromJob > 0 && !BASE_SEFOC_RE.test(displayFile)
      ? fromJob
      : null) ??
    (Number.isFinite(fromJob) && fromJob > 0 ? fromJob : null)
  );
}

/**
 * PDF mostrado na visualização de prova.
 * Em prova web, preferir *-ProvaN.pdf (sem brancos) mesmo se o job ainda
 * apontar para BaseSefoc.pdf. Se a pasta Sefoc tiver uma Prova com número
 * maior (suggested), adotar essa em vez do arquivo do job.
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
  folderSuggested?: string | null,
): PapelariaProvaDisplay | null {
  const suggested = (folderSuggested || "").trim();
  if (!job) return null;
  const arquivo = (job.arquivo_pdf || "").trim();
  if (!arquivo && !suggested) return null;

  const dados = (job.dados ?? {}) as Record<string, unknown>;
  const provaWebName = String(dados.prova_web_pdf_name ?? "").trim();
  const provaEmailName = String(dados.prova_email_pdf_name ?? "").trim();
  const prefersProvaFile =
    Boolean(arquivo) &&
    BASE_SEFOC_RE.test(arquivo) &&
    Boolean(provaWebName || provaEmailName);
  let displayFile = prefersProvaFile
    ? provaWebName || provaEmailName
    : arquivo;
  let fromFolder = false;

  if (suggested && (!displayFile || shouldAdoptSuggestedProof(displayFile, suggested))) {
    displayFile = suggested;
    fromFolder = true;
  }
  if (!displayFile) return null;

  const pdfUrl =
    fromFolder || prefersProvaFile
      ? emailProofFileUrl(job.ano_protocolo, job.nro_protocolo, displayFile)
      : papelariaJobFileUrl(job.id, "pdf");

  const versao = resolveVersao(displayFile, dados, job.versao);

  return {
    pdfUrl,
    fileLabel: displayFile,
    versao,
    provaLabel: versao != null ? `Prova ${versao}` : null,
  };
}
