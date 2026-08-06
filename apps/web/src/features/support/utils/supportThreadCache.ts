import type { QueryClient } from "@tanstack/react-query";

import type { SupportMessage, SupportThreadMessage } from "@/api/support";

export type MergeThreadResult = "appended" | "duplicate" | "cache_miss";

/** Normaliza payload WS/API para SupportThreadMessage (Id vs id). */
export function normalizeSupportThreadMessage(
  raw: SupportThreadMessage | Record<string, unknown>,
): SupportThreadMessage | null {
  const id = raw.Id ?? (raw as Record<string, unknown>).id;
  const ticketId = raw.TicketId ?? (raw as Record<string, unknown>).ticketId;
  const mensagem = raw.Mensagem ?? (raw as Record<string, unknown>).mensagem;
  if (id == null || ticketId == null || mensagem == null) {
    return null;
  }
  return {
    Id: Number(id),
    TicketId: Number(ticketId),
    AutorTipo: (raw.AutorTipo ??
      (raw as Record<string, unknown>).autorTipo ??
      "admin") as SupportThreadMessage["AutorTipo"],
    AutorPonto: (raw.AutorPonto ??
      (raw as Record<string, unknown>).autorPonto ??
      null) as string | null,
    AutorNome: (raw.AutorNome ??
      (raw as Record<string, unknown>).autorNome ??
      null) as string | null,
    Mensagem: String(mensagem),
    DataCriacao: (raw.DataCriacao ??
      (raw as Record<string, unknown>).dataCriacao ??
      null) as string | null,
  };
}

export function mergeSupportThreadMessage(
  old: SupportMessage | undefined,
  message: SupportThreadMessage,
  ticketStatus?: string,
): { ticket: SupportMessage | undefined; result: MergeThreadResult } {
  return mergeThreadMessageIntoTicket(old, message, ticketStatus);
}

export function mergeThreadMessageIntoTicket(
  old: SupportMessage | undefined,
  message: SupportThreadMessage,
  ticketStatus?: string,
): { ticket: SupportMessage | undefined; result: MergeThreadResult } {
  if (!old) {
    return { ticket: old, result: "cache_miss" };
  }
  const thread = old.Thread ?? [];
  if (thread.some((item) => item.Id === message.Id)) {
    return { ticket: old, result: "duplicate" };
  }
  const nextStatus =
    ticketStatus === "aberto" || ticketStatus === "resolvido" ? ticketStatus : old.Status;
  return {
    ticket: {
      ...old,
      Thread: [...thread, message],
      Status: nextStatus,
    },
    result: "appended",
  };
}

export function applyThreadMessageToCache(
  qc: QueryClient,
  ticketQueryKey: readonly unknown[],
  message: SupportThreadMessage,
  ticketStatus?: string,
): MergeThreadResult {
  let result: MergeThreadResult = "cache_miss";
  qc.setQueryData<SupportMessage | undefined>(ticketQueryKey, (old) => {
    const merged = mergeThreadMessageIntoTicket(old, message, ticketStatus);
    result = merged.result;
    return merged.ticket ?? old;
  });
  if (result === "cache_miss") {
    void qc.refetchQueries({ queryKey: [...ticketQueryKey] });
  }
  return result;
}

export function applyTicketResolvedToCache(
  qc: QueryClient,
  ticketQueryKey: readonly unknown[],
): void {
  let hadCache = false;
  qc.setQueryData<SupportMessage | undefined>(ticketQueryKey, (old) => {
    if (!old) {
      return old;
    }
    hadCache = true;
    return { ...old, Status: "resolvido" };
  });
  if (!hadCache) {
    void qc.refetchQueries({ queryKey: [...ticketQueryKey] });
  }
}

export function invalidateSupportListQueries(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: ["support", "adminMessages"] });
  void qc.invalidateQueries({ queryKey: ["support", "userTickets"] });
  void qc.invalidateQueries({ queryKey: ["support", "assignedTickets"] });
}

export function ticketCacheHasMessage(
  qc: QueryClient,
  ticketQueryKey: readonly unknown[],
  messageId: number,
): boolean {
  const cached = qc.getQueryData<SupportMessage | undefined>(ticketQueryKey);
  return Boolean(cached?.Thread?.some((item) => item.Id === messageId));
}

/** Alias público solicitado pela spec de merge de thread. */
export const mergeSupportMessageIntoTicket = mergeThreadMessageIntoTicket;
