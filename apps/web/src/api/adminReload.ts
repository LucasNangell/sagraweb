import { apiFetch } from "@/api/client";
import type { AdminReloadState } from "@/features/realtime/adminForceRefresh";

export function fetchAdminReloadState(): Promise<AdminReloadState> {
  return apiFetch<AdminReloadState>("/realtime/admin-reload");
}
