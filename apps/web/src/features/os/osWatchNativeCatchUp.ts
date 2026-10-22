import type { AppNotification } from "./types";

export const OS_WATCH_CATCH_UP_MAX = 3;

export const OS_WATCH_TYPES = new Set(["os_watch_andamento", "os_watch_change"]);

export interface OsWatchDetalhes {
  type?: string;
  ticket_id?: number;
  support_message_id?: number;
  tipo?: string;
  os_ano?: number;
  os_nro?: number;
  urgent?: boolean;
}

export function parseOsWatchDetalhes(
  notification: AppNotification,
): OsWatchDetalhes | null {
  const raw = notification.DetalhesJson?.trim();
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as OsWatchDetalhes;
  } catch {
    return null;
  }
}

export function isOsWatchNotification(
  notification: AppNotification,
  action?: string,
): boolean {
  if (action && OS_WATCH_TYPES.has(action)) {
    return true;
  }
  const type = parseOsWatchDetalhes(notification)?.type;
  return Boolean(type && OS_WATCH_TYPES.has(type));
}

export type OsWatchCatchUpPlan =
  | { kind: "none"; items: AppNotification[] }
  | { kind: "individual"; items: AppNotification[] }
  | { kind: "summary"; items: AppNotification[] };

export function selectOsWatchCatchUp(
  items: AppNotification[],
  isShown: (id: number) => boolean,
  maxIndividual = OS_WATCH_CATCH_UP_MAX,
): OsWatchCatchUpPlan {
  const pending = items.filter(
    (item) =>
      isOsWatchNotification(item) && item.Id > 0 && !isShown(item.Id),
  );
  if (pending.length === 0) {
    return { kind: "none", items: [] };
  }
  if (pending.length <= maxIndividual) {
    return { kind: "individual", items: pending };
  }
  return { kind: "summary", items: pending };
}
