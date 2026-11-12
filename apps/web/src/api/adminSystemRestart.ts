import { apiFetch } from "@/api/client";

export type SystemRestartServiceResult = {
  name?: string;
  ok?: boolean;
  detail?: string;
};

export type SystemRestartStatus = {
  request_id: string | null;
  phase: string;
  ok: boolean | null;
  reason: string | null;
  started_at: string | null;
  finished_at: string | null;
  services: SystemRestartServiceResult[];
  detail: string | null;
  path?: string;
  pid?: number | null;
  requested_by?: string | null;
};

export function fetchSystemRestartStatus() {
  return apiFetch<SystemRestartStatus>("/admin/system/restart/status");
}

export function requestSystemRestart(reason = "reinicio via UI") {
  return apiFetch<SystemRestartStatus>("/admin/system/restart", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reason }),
  });
}
