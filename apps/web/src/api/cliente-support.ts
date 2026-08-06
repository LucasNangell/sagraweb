import type { SupportMessage } from "@/api/support";
import { clienteFetch } from "@/api/cliente-portal";

export interface ClienteSupportSettings {
  cliente_chat_enabled: boolean;
}

export async function fetchClienteSupportSettings(): Promise<ClienteSupportSettings> {
  return clienteFetch<ClienteSupportSettings>("/cliente/support/settings");
}

export interface ClienteSupportMessagePayload {
  ano: number;
  nr_os: number;
  assunto: string;
  mensagem: string;
  versao?: string | null;
}

export async function fetchClienteOpenSupportTicket(
  ano: number,
  nrOs: number,
): Promise<SupportMessage | null> {
  const qs = new URLSearchParams({
    ano: String(ano),
    nr_os: String(nrOs),
  });
  const data = await clienteFetch<{ item: SupportMessage | null }>(
    `/cliente/support/ticket?${qs}`,
  );
  return data.item ?? null;
}

export async function submitClienteSupportMessage(
  payload: ClienteSupportMessagePayload,
): Promise<SupportMessage> {
  return clienteFetch<SupportMessage>("/cliente/support/messages", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function fetchClienteSupportTicket(ticketId: number): Promise<SupportMessage> {
  return clienteFetch<SupportMessage>(`/cliente/support/tickets/${ticketId}`);
}

export async function replyClienteSupportTicket(
  ticketId: number,
  mensagem: string,
): Promise<SupportMessage> {
  return clienteFetch<SupportMessage>(`/cliente/support/tickets/${ticketId}/reply`, {
    method: "POST",
    body: JSON.stringify({ mensagem }),
  });
}
