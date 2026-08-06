import type { QueryClient } from "@tanstack/react-query";

import { fetchNotifications } from "@/api/notifications";
import { queryKeys } from "@/api/query-keys";
import { useSupportUiStore } from "@/features/support/supportUiStore";

export interface SupportWsNotification {
  type?: string;
  action?: string;
  ticket_id?: number;
  support_message_id?: number;
  target_ponto?: string;
  target_user?: string;
  id?: number;
  ano?: number;
}

export function supportNotificationDetailsFromWs(
  data: Pick<
    SupportWsNotification,
    "action" | "ticket_id" | "support_message_id"
  >,
): { type?: string; ticket_id?: number; support_message_id?: number } | null {
  if (!data.action) {
    return null;
  }
  const ticketId = extractSupportTicketId(data, null);
  if (ticketId == null) {
    return { type: data.action };
  }
  return {
    type: data.action,
    ticket_id: ticketId,
    support_message_id: ticketId,
  };
}

interface SupportDetalhesJson {
  type?: string;
  ticket_id?: number;
  support_message_id?: number;
}

export function extractSupportTicketId(
  primary: { ticket_id?: number; support_message_id?: number },
  detalhes?: SupportDetalhesJson | null,
): number | null {
  const raw =
    primary.ticket_id ??
    primary.support_message_id ??
    detalhes?.ticket_id ??
    detalhes?.support_message_id;
  if (raw == null || Number(raw) <= 0) {
    return null;
  }
  return Number(raw);
}

export function invalidateUserSupportTicketQueries(
  qc: QueryClient,
  ticketId: number | null | undefined,
  options?: { skipTicketRefetch?: boolean },
): void {
  void qc.invalidateQueries({ queryKey: ["support", "userTickets"] });
  if (ticketId != null && ticketId > 0 && !options?.skipTicketRefetch) {
    void qc.refetchQueries({
      queryKey: queryKeys.support.userTicket(ticketId),
    });
  }
}

export function invalidateAssignedSupportTicketQueries(
  qc: QueryClient,
  ticketId: number | null | undefined,
): void {
  void qc.invalidateQueries({ queryKey: ["support", "assignedTickets"] });
  if (ticketId != null && ticketId > 0) {
    void qc.invalidateQueries({
      queryKey: queryKeys.support.assignedTicket(ticketId),
    });
  }
}

async function resolveTicketIdFromNotifications(
  ponto: string,
  type: "support_reply" | "cliente_support",
): Promise<number | null> {
  try {
    const list = await fetchNotifications(ponto);
    for (const item of list) {
      if (!item.DetalhesJson?.trim()) {
        continue;
      }
      try {
        const detalhes = JSON.parse(item.DetalhesJson) as SupportDetalhesJson;
        if (detalhes.type === type) {
          const id = extractSupportTicketId({}, detalhes);
          if (id != null) {
            return id;
          }
        }
      } catch {
        /* ignore malformed json */
      }
    }
  } catch {
    /* ignore fetch errors */
  }
  return null;
}

export async function handleSupportReplyNotification(
  qc: QueryClient,
  ponto: string | null,
  data: SupportWsNotification,
): Promise<void> {
  if (data.action !== "support_reply") {
    return;
  }

  let ticketId = extractSupportTicketId(data, null);
  const viewing = useSupportUiStore.getState().viewingTickets;

  if (ticketId == null && viewing.usuario != null) {
    ticketId = viewing.usuario;
  }

  if (ticketId == null && ponto) {
    ticketId = await resolveTicketIdFromNotifications(ponto, "support_reply");
  }

  const skipTicketRefetch = false;

  invalidateUserSupportTicketQueries(qc, ticketId, {
    skipTicketRefetch,
  });
  if (ticketId != null && ticketId > 0) {
    void qc.refetchQueries({
      queryKey: queryKeys.support.userTicket(ticketId),
    });
  }

  if (ponto) {
    void qc.invalidateQueries({ queryKey: queryKeys.notifications(ponto) });
  }
}

export async function handleClienteSupportNotification(
  qc: QueryClient,
  ponto: string | null,
  data: SupportWsNotification,
): Promise<void> {
  if (data.action !== "cliente_support") {
    return;
  }

  let ticketId = extractSupportTicketId(data, null);
  const viewing = useSupportUiStore.getState().viewingTickets;

  if (ticketId == null && viewing.assigned != null) {
    ticketId = viewing.assigned;
  }

  if (ticketId == null && ponto) {
    ticketId = await resolveTicketIdFromNotifications(ponto, "cliente_support");
  }

  invalidateAssignedSupportTicketQueries(qc, ticketId);
  if (ticketId != null && ticketId > 0) {
    void qc.refetchQueries({
      queryKey: queryKeys.support.assignedTicket(ticketId),
    });
  }

  if (ponto) {
    void qc.invalidateQueries({ queryKey: queryKeys.notifications(ponto) });
  }
}

export async function handleSupportIncomingNotification(
  qc: QueryClient,
  ponto: string | null,
  data: SupportWsNotification,
): Promise<void> {
  if (data.action !== "support_incoming") {
    return;
  }

  let ticketId = extractSupportTicketId(data, null);
  const viewing = useSupportUiStore.getState().viewingTickets;

  if (ticketId == null && viewing.admin != null) {
    ticketId = viewing.admin;
  }

  void qc.invalidateQueries({ queryKey: ["support", "adminMessages"] });
  if (ticketId != null && ticketId > 0) {
    void qc.refetchQueries({
      queryKey: queryKeys.support.adminTicket(ticketId),
    });
  }

  if (ponto) {
    void qc.invalidateQueries({ queryKey: queryKeys.notifications(ponto) });
  }
}

export async function handleSupportNotificationAction(
  qc: QueryClient,
  ponto: string | null,
  data: SupportWsNotification,
): Promise<void> {
  if (data.action === "support_reply") {
    await handleSupportReplyNotification(qc, ponto, data);
    return;
  }
  if (data.action === "cliente_support") {
    await handleClienteSupportNotification(qc, ponto, data);
    return;
  }
  if (data.action === "support_incoming") {
    await handleSupportIncomingNotification(qc, ponto, data);
  }
}
