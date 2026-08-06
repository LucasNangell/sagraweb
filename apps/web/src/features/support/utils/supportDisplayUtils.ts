import type { SupportMessage, SupportMessageTipo } from "@/api/support";

export function supportTipoLabel(tipo: SupportMessageTipo | string): string {
  const normalized = String(tipo || "").toLowerCase();
  if (normalized === "sugestao") {
    return "Sugestão";
  }
  if (normalized === "duvida") {
    return "Dúvida";
  }
  return "Problema";
}

export function supportTicketStatusLabel(ticket: SupportMessage): string {
  if (ticket.Status === "resolvido") {
    return "Resolvido";
  }
  const thread = ticket.Thread ?? [];
  if (thread.length === 0) {
    return "Aberto";
  }
  const last = thread[thread.length - 1];
  if (last.AutorTipo === "admin") {
    return "Respondido";
  }
  return "Aguardando resposta";
}

export function supportTicketPreview(ticket: SupportMessage): string {
  const thread = ticket.Thread ?? [];
  const text =
    thread.length > 0
      ? thread[thread.length - 1]?.Mensagem
      : ticket.Mensagem;
  const body = String(text ?? "").trim();
  if (!body) {
    return "Sem mensagens";
  }
  const prefix =
    thread.length > 0 && thread[thread.length - 1]?.AutorTipo === "admin"
      ? "Suporte: "
      : thread.length > 0
        ? "Você: "
        : "";
  const preview = body.length > 90 ? `${body.slice(0, 90)}…` : body;
  return `${prefix}${preview}`;
}

export function supportTicketStatusTone(
  ticket: SupportMessage,
): "open" | "answered" | "waiting" | "resolved" {
  if (ticket.Status === "resolvido") {
    return "resolved";
  }
  const thread = ticket.Thread ?? [];
  if (thread.length === 0) {
    return "open";
  }
  const last = thread[thread.length - 1];
  if (last.AutorTipo === "admin") {
    return "answered";
  }
  return "waiting";
}
