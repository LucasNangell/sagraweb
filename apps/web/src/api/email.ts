import { apiFetch, apiUrl } from "@/api/client";
import type {
  AndamentoResult,
  DeputadoEmails,
  GalResolveResponse,
  EmailConnectResult,
  EmailExchangeConfig,
  EmailFoldersResult,
  EmailNotificationStatus,
  EmailSendPlanResponse,
  EmailProofFilesResponse,
  InboxEmail,
  PendenciaOs,
  ProtocoloLookup,
  PtHtmlResponse,
  SaveEmailMhtResult,
  SendPtResult,
} from "@/features/email/types";

async function parseApiError(res: Response): Promise<string> {
  const text = await res.text().catch(() => res.statusText);
  try {
    const data = JSON.parse(text) as { detail?: string | { msg?: string }[] };
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail) && data.detail[0]?.msg) {
      return data.detail[0].msg;
    }
  } catch {
    /* ignore */
  }
  return text || res.statusText;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res));
  }
  return res.json() as Promise<T>;
}

export async function fetchEmailInbox(): Promise<InboxEmail[]> {
  return apiFetch<InboxEmail[]>("/email/inbox");
}

export async function fetchEmailPendencias(
  setor = "SEFOC",
): Promise<PendenciaOs[]> {
  return apiFetch<PendenciaOs[]>(
    `/email/pendencias?setor=${encodeURIComponent(setor)}`,
  );
}

export async function fetchEmailNotificationStatus(
  setor = "SEFOC",
): Promise<EmailNotificationStatus> {
  return apiFetch<EmailNotificationStatus>(
    `/email/notification_status?setor=${encodeURIComponent(setor)}`,
  );
}

export async function fetchPtHtml(ano: number, os: number): Promise<PtHtmlResponse> {
  return apiFetch<PtHtmlResponse>(`/email/pt-html/${ano}/${os}`);
}

export async function fetchEmailProofFiles(
  ano: number,
  os: number,
): Promise<EmailProofFilesResponse> {
  return apiFetch<EmailProofFilesResponse>(`/email/os/${ano}/${os}/proof-files`);
}

export async function fetchProtocoloLookup(
  os: number,
  ano: number,
): Promise<ProtocoloLookup> {
  return apiFetch<ProtocoloLookup>(
    `/aux/protocolo/buscar?os=${os}&ano=${ano}`,
  );
}

export async function fetchDeputadoEmails(
  nomeUsuario: string,
  os: number,
  ano: number,
): Promise<DeputadoEmails> {
  const q = new URLSearchParams({
    nome_usuario: nomeUsuario,
    NrOS: String(os),
    Ano: String(ano),
  });
  return apiFetch<DeputadoEmails>(`/aux/deputado/emails?${q}`);
}

export async function fetchGalResolve(query: string): Promise<GalResolveResponse> {
  const q = new URLSearchParams({ q: query.trim() });
  return apiFetch<GalResolveResponse>(`/email/gal/resolve?${q}`);
}

export function emailDownloadUrl(entryId: string, attIndex: number): string {
  const q = new URLSearchParams({
    entry_id: entryId,
    att_index: String(attIndex),
  });
  return apiUrl(`/email/download?${q}`);
}

export async function postEmailAndamento(payload: {
  os: number;
  ano: number;
  situacao: string;
  setor: string;
  observacao: string;
  ponto: string;
  email_entry_id?: string | null;
}): Promise<AndamentoResult> {
  return apiPost<AndamentoResult>("/email/andamento", payload);
}

export async function postEmailMarkRead(payload: {
  email_entry_id: string;
  category?: string;
}): Promise<{ success?: boolean }> {
  return apiPost("/email/mark-read", payload);
}

export async function postEmailSendPt(payload: {
  os: number;
  ano: number;
  versao?: string;
  to: string[];
  ponto: string;
  type: string;
  email_entry_id?: string | null;
  proof_filename?: string;
  /** HTML editado na prévia ou corpo do e-mail Apogee. */
  html?: string;
  /** Assunto do e-mail Apogee. */
  subject?: string;
  register_andamento?: boolean;
}): Promise<SendPtResult> {
  return apiPost<SendPtResult>("/email/send-pt", payload);
}

export async function postEmailPendenciaAndamento(payload: {
  os: number;
  ano: number;
  versao?: string;
  ponto: string;
  type: string;
  proof_filename?: string;
  send_mode?: string;
  to?: string[];
}): Promise<AndamentoResult> {
  return apiPost<AndamentoResult>("/email/pendencia-andamento", payload);
}

export async function postEmailSaveMht(payload: {
  email_entry_id: string;
  os: number;
  ano: number;
}): Promise<SaveEmailMhtResult> {
  return apiPost<SaveEmailMhtResult>("/email/save-mht", payload);
}

export async function fetchEmailConfig(): Promise<EmailExchangeConfig> {
  return apiFetch<EmailExchangeConfig>("/email/config");
}

export async function connectEmailExchange(payload: {
  ews_url: string;
  verify_ssl: boolean;
  extra_mailboxes?: string[];
}): Promise<EmailConnectResult> {
  return apiPost<EmailConnectResult>("/email/config/connect", payload);
}

export async function fetchEmailFolders(payload: {
  ews_url: string;
  verify_ssl: boolean;
  mailbox: string;
  parent?: string;
}): Promise<EmailFoldersResult> {
  return apiPost<EmailFoldersResult>("/email/config/folders", payload);
}

export async function saveEmailConfig(payload: {
  monitored_targets: EmailExchangeConfig["monitored_targets"];
  send_routing?: EmailExchangeConfig["send_routing"];
  sent_folder_routing?: EmailExchangeConfig["sent_folder_routing"];
  config_version?: number;
}): Promise<{ success: boolean; config: EmailExchangeConfig }> {
  const res = await fetch(apiUrl("/email/config"), {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(await parseApiError(res));
  }
  return res.json() as Promise<{ success: boolean; config: EmailExchangeConfig }>;
}

export async function fetchEmailSendPlan(payload: {
  os: number;
  ano: number;
  type: "pt" | "proof" | "apogee" | "reply";
  from_mailbox_hint?: string;
  validate_folder?: boolean;
}): Promise<EmailSendPlanResponse> {
  return apiPost<EmailSendPlanResponse>("/email/config/send-plan", payload);
}
