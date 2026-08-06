/** Lógica pura de subscribe/unsubscribe da página /mensagens (testável). */

export function shouldSkipSubscribe(
  subscribedTicketId: number | null,
  selectedTicketId: number,
): boolean {
  return subscribedTicketId === selectedTicketId;
}

export function ticketToUnsubscribeBeforeChange(
  subscribedTicketId: number | null,
  selectedTicketId: number,
): number | null {
  if (subscribedTicketId == null || subscribedTicketId === selectedTicketId) {
    return null;
  }
  return subscribedTicketId;
}

export function shouldClearSubscription(selectedTicketId: number | null): boolean {
  return selectedTicketId == null;
}

export function buildSubscribePayload(ticketId: number) {
  return { type: "support_subscribe" as const, ticket_id: ticketId };
}

export function buildUnsubscribePayload(ticketId: number) {
  return { type: "support_unsubscribe" as const, ticket_id: ticketId };
}
