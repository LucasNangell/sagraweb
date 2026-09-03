import { apiFetch } from "@/lib/api";

export interface SyncAndamentosServiceStatus {
  service_name: string;
  exists: boolean;
  status: string | null;
  query_ok: boolean;
  healthy: boolean;
  alert: boolean;
}

export async function fetchSyncAndamentosServiceStatus(): Promise<SyncAndamentosServiceStatus> {
  return apiFetch<SyncAndamentosServiceStatus>(
    "/sync-andamentos/service-status",
    { cache: "no-store" },
  );
}
