import type { SupportThreadMessage } from "@/api/support";

import { normalizeSupportThreadMessage } from "@/features/support/utils/supportThreadCache";

/** Eventos WebSocket que não são do chat de suporte (heartbeat, painel, etc.). */
const NON_SUPPORT_WS_TYPES = new Set([
  "ping",
  "pong",
  "system_update",
  "pcp_queue_update",
  "force_refresh",
]);

export interface NormalizedSupportWsEvent {
  type: string | null;
  action: string | null;
  ticketId: number | null;
  messageId: number | null;
  message: SupportThreadMessage | null;
  authorRole: string | null;
  authorLabel: string | null;
  typing: boolean | null;
  targetPonto: string | null;
  recipientUserId: string | null;
  ticketStatus: string | null;
  notificationId: number | null;
  isSupportEvent: boolean;
}

function parseJsonObject(value: unknown): Record<string, unknown> | null {
  if (value == null) {
    return null;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
  }
  return null;
}

function pickNumber(...values: unknown[]): number | null {
  for (const value of values) {
    if (value == null || value === "") {
      continue;
    }
    const num = Number(value);
    if (Number.isFinite(num) && num > 0) {
      return num;
    }
  }
  return null;
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value == null) {
      continue;
    }
    const str = String(value).trim();
    if (str) {
      return str;
    }
  }
  return null;
}

function pickBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return null;
}

function extractDetalhes(data: Record<string, unknown>): Record<string, unknown> | null {
  return (
    parseJsonObject(data.DetalhesJson) ??
    parseJsonObject(data.detalhesJson) ??
    parseJsonObject(data.detalhes) ??
    parseJsonObject(data.details) ??
    parseJsonObject(data.payload)
  );
}

function extractRawMessage(data: Record<string, unknown>): SupportThreadMessage | null {
  const payload =
    data.payload && typeof data.payload === "object"
      ? (data.payload as Record<string, unknown>)
      : null;
  const candidates = [data.message, payload?.message];
  for (const candidate of candidates) {
    if (candidate && typeof candidate === "object") {
      const normalized = normalizeSupportThreadMessage(
        candidate as SupportThreadMessage | Record<string, unknown>,
      );
      if (normalized) {
        return normalized;
      }
    }
  }
  return null;
}

/**
 * Normaliza payloads WebSocket heterogêneos do chat de suporte.
 */
export function normalizeSupportWsEvent(data: unknown): NormalizedSupportWsEvent {
  const empty: NormalizedSupportWsEvent = {
    type: null,
    action: null,
    ticketId: null,
    messageId: null,
    message: null,
    authorRole: null,
    authorLabel: null,
    typing: null,
    targetPonto: null,
    recipientUserId: null,
    ticketStatus: null,
    notificationId: null,
    isSupportEvent: false,
  };

  if (!data || typeof data !== "object") {
    return empty;
  }

  const raw = data as Record<string, unknown>;
  const detalhes = extractDetalhes(raw);
  const payload =
    raw.payload && typeof raw.payload === "object"
      ? (raw.payload as Record<string, unknown>)
      : null;
  const ticketObj =
    raw.ticket && typeof raw.ticket === "object"
      ? (raw.ticket as Record<string, unknown>)
      : null;

  const type = pickString(raw.type, payload?.type);
  const action = pickString(raw.action, payload?.action, detalhes?.type, detalhes?.action);

  const message = extractRawMessage(raw);
  const messageId = pickNumber(
    raw.message_id,
    raw.messageId,
    message?.Id,
    detalhes?.message_id,
    detalhes?.messageId,
  );

  const ticketId = pickNumber(
    raw.ticket_id,
    raw.ticketId,
    raw.support_message_id,
    raw.supportMessageId,
    ticketObj?.id,
    ticketObj?.Id,
    payload?.ticket_id,
    payload?.ticketId,
    payload?.support_message_id,
    detalhes?.ticket_id,
    detalhes?.ticketId,
    detalhes?.support_message_id,
    message?.TicketId,
  );

  const authorRole = pickString(
    raw.author_role,
    raw.authorRole,
    payload?.author_role,
    message?.AutorTipo,
    detalhes?.author_role,
  );

  const authorLabel = pickString(
    raw.author_label,
    raw.authorLabel,
    payload?.author_label,
    message?.AutorNome,
    detalhes?.author_label,
  );

  const typing = pickBoolean(raw.typing ?? payload?.typing);

  const targetPonto = pickString(
    raw.target_ponto,
    raw.targetPonto,
    raw.target_user,
    raw.targetUser,
    payload?.target_ponto,
    detalhes?.target_ponto,
  );

  const recipientUserId = pickString(raw.target_user, raw.targetUser, raw.recipient_user_id);

  const ticketStatus = pickString(raw.ticket_status, raw.ticketStatus, payload?.ticket_status);

  const notificationId = pickNumber(raw.notification_id, raw.notificationId);

  const isSupportEvent =
    Boolean(type && !NON_SUPPORT_WS_TYPES.has(type)) &&
    (type.startsWith("support_") ||
      action === "support_reply" ||
      action === "support_incoming" ||
      action === "cliente_support" ||
      detalhes?.type === "support_reply" ||
      detalhes?.type === "support_incoming" ||
      detalhes?.type === "cliente_support");

  return {
    type,
    action,
    ticketId,
    messageId,
    message,
    authorRole,
    authorLabel,
    typing,
    targetPonto,
    recipientUserId,
    ticketStatus,
    notificationId,
    isSupportEvent,
  };
}

/** Logs DEV: payload bruto + normalizado (somente eventos de suporte). */
export function logSupportWsEvent(scope: string, data: unknown): NormalizedSupportWsEvent {
  const event = normalizeSupportWsEvent(data);
  if (!import.meta.env.DEV) {
    return event;
  }
  if (!event.isSupportEvent && event.type !== "notification_new") {
    return event;
  }
  console.info(`[SUPPORT WS RAW] ${scope}`, data);
  console.info(`[SUPPORT WS NORMALIZED] ${scope}`, event);
  return event;
}
