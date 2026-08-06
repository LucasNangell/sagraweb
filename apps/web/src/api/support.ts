import { apiFetch } from "@/api/client";

export type SupportMessageTipo = "problema" | "sugestao";
export type SupportMessageStatus = "aberto" | "resolvido";
export type SupportThreadAuthor = "usuario" | "admin" | "cliente";

export interface SupportThreadMessage {
  Id: number;
  TicketId: number;
  AutorTipo: SupportThreadAuthor;
  AutorPonto: string | null;
  AutorNome: string | null;
  Mensagem: string;
  DataCriacao: string | null;
}

export interface SupportMessage {
  Id: number;
  Ponto: string;
  NomeUsuario: string | null;
  Tipo: SupportMessageTipo;
  Assunto: string;
  Mensagem: string;
  Status: SupportMessageStatus;
  Resposta: string | null;
  RespondidoPor: string | null;
  DataCriacao: string | null;
  DataResposta: string | null;
  DataResolucao: string | null;
  ResolvidoPor: string | null;
  Thread?: SupportThreadMessage[];
  AssignedPonto?: string | null;
  OsAno?: number | null;
  OsNro?: number | null;
  ClienteId?: number | null;
  VersaoPt?: string | null;
  Source?: string | null;
}

export interface SubmitSupportMessagePayload {
  tipo: SupportMessageTipo;
  assunto: string;
  mensagem: string;
}

export interface SupportChatSettings {
  usuario_chat_enabled: boolean;
  cliente_chat_enabled: boolean;
}

export interface UsuarioSupportSettings {
  usuario_chat_enabled: boolean;
}

export async function submitSupportMessage(
  payload: SubmitSupportMessagePayload,
): Promise<SupportMessage> {
  return apiFetch<SupportMessage>("/support/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

export async function fetchUserSupportTickets(
  status?: SupportMessageStatus,
): Promise<SupportMessage[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await apiFetch<{ items: SupportMessage[] }>(`/support/tickets${qs}`);
  return data.items ?? [];
}

export async function fetchUserSupportTicket(ticketId: number): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(`/support/tickets/${ticketId}`);
}

export async function replyUserSupportTicket(
  ticketId: number,
  mensagem: string,
): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(`/support/tickets/${ticketId}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mensagem }),
  });
}

export async function fetchAdminSupportMessages(
  status?: SupportMessageStatus,
): Promise<SupportMessage[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await apiFetch<{ items: SupportMessage[] }>(
    `/admin/system/support-messages${qs}`,
  );
  return data.items ?? [];
}

export async function fetchAdminSupportMessage(ticketId: number): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(`/admin/system/support-messages/${ticketId}`);
}

export async function replyAdminSupportMessage(
  messageId: number,
  resposta: string,
): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(
    `/admin/system/support-messages/${messageId}/reply`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resposta }),
    },
  );
}

export async function fetchAssignedSupportTickets(
  status?: SupportMessageStatus,
): Promise<SupportMessage[]> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await apiFetch<{ items: SupportMessage[] }>(
    `/support/assigned-tickets${qs}`,
  );
  return data.items ?? [];
}

export async function fetchAssignedSupportTicket(ticketId: number): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(`/support/assigned-tickets/${ticketId}`);
}

export async function replyAssignedSupportMessage(
  ticketId: number,
  resposta: string,
): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(`/support/assigned-tickets/${ticketId}/reply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resposta }),
  });
}

export async function resolveAdminSupportMessage(
  messageId: number,
): Promise<SupportMessage> {
  return apiFetch<SupportMessage>(
    `/admin/system/support-messages/${messageId}/resolve`,
    { method: "POST" },
  );
}

export async function fetchSupportSettings(): Promise<UsuarioSupportSettings> {
  return apiFetch<UsuarioSupportSettings>("/support/settings");
}

export async function fetchAdminSupportSettings(): Promise<SupportChatSettings> {
  return apiFetch<SupportChatSettings>("/admin/system/support-settings");
}

export async function saveAdminSupportSettings(
  payload: SupportChatSettings,
): Promise<SupportChatSettings> {
  return apiFetch<SupportChatSettings>("/admin/system/support-settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/** URL do manual do usuário (servido pelo backend em /manual/usuario). */
export function userManualUrl(): string {
  const base = import.meta.env.BASE_URL;
  if (base && base !== "/") {
    return `${base.replace(/\/$/, "")}/manual/usuario`;
  }
  return "/manual/usuario";
}
