import { apiFetch } from "@/api/client";

import type { AppNotification } from "@/features/os/types";

export async function fetchNotifications(ponto: string): Promise<AppNotification[]> {
  const qs = new URLSearchParams({ ponto: String(ponto) });
  return apiFetch<AppNotification[]>(`/notifications?${qs}`);
}

export async function markNotificationRead(id: number): Promise<void> {
  await apiFetch(`/notifications/${id}/read`, { method: "POST" });
}
