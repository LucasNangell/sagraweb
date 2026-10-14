import { apiFetch } from "@/api/client";
import type {
  SyncAlertReason,
  SyncWatchdogSummary,
} from "@/features/sync-andamentos/api";

export type SyncTableName =
  | "tabProtocolos"
  | "tabDetalhesServico"
  | "tabAndamento";

export type SyncMode = "uni" | "bi";
export type SyncDeletePolicy = "off" | "dryrun" | "on";

export type SyncPolicyRow = {
  table_name: SyncTableName;
  enabled: boolean;
  mode: SyncMode;
  delete_policy: SyncDeletePolicy;
  updated_at?: string | null;
  updated_by?: string | null;
};

export type SyncHeartbeat = {
  present: boolean;
  phase: string | null;
  age_sec: number | null;
  cycles: number | null;
  consecutive_errors: number | null;
  last_error: string | null;
  last_cycle_at: string | null;
  written_at: string | null;
  stats: Record<string, number> | null;
  stale: boolean;
  tabandamento_bidi: boolean | null;
  pid?: number | null;
};

export type SyncServiceCard = {
  service_name: string;
  exists: boolean;
  status: string | null;
  query_ok: boolean;
  healthy: boolean;
  alert?: boolean;
  alert_reasons?: SyncAlertReason[];
  data_stale?: boolean;
  mdb_count?: number | null;
  mysql_count?: number | null;
  heartbeat?: SyncHeartbeat;
  watchdog?: SyncWatchdogSummary;
};

export type SystemWatchdogSyncStatus = SyncWatchdogSummary & {
  checked_at: string | null;
  overall: string | null;
  last_action_detail: string | null;
};

export type SyncAdminStatus = {
  system_watchdog?: SystemWatchdogSyncStatus;
  services: {
    sync_andamentos: SyncServiceCard;
    monitor_sync: SyncServiceCard;
  };
  divergencia: {
    data_stale: boolean;
    mdb_count: number | null;
    mysql_count: number | null;
    checked_at: string | null;
    status_fresh: boolean;
    phase: string | null;
  };
  policies: SyncPolicyRow[];
  pending_counts: Record<string, number>;
};

export type SyncPendingDelete = {
  nro: number;
  ano: number;
  origem?: string | null;
  first_missing_at?: string | null;
  confirm_count?: number;
  last_check_at?: string | null;
  status: string;
  andamentos_count?: number;
  motivo?: string | null;
  titulo?: string | null;
  decided_by?: string | null;
  decided_at?: string | null;
};

export async function fetchSyncAdminStatus(): Promise<SyncAdminStatus> {
  return apiFetch<SyncAdminStatus>("/admin/system/sync/status");
}

export async function fetchSyncPolicy(): Promise<{ policies: SyncPolicyRow[] }> {
  return apiFetch("/admin/system/sync/policy");
}

export async function saveSyncPolicy(policies: Partial<SyncPolicyRow>[]): Promise<{
  policies: SyncPolicyRow[];
}> {
  return apiFetch("/admin/system/sync/policy", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ policies }),
  });
}

export async function fetchSyncPendingDeletes(status?: string): Promise<{
  items: SyncPendingDelete[];
  counts: Record<string, number>;
}> {
  const q = status ? `?status=${encodeURIComponent(status)}` : "";
  return apiFetch(`/admin/system/sync/pending-deletes${q}`);
}

export async function approveSyncPendingDelete(
  nro: number,
  ano: number,
): Promise<unknown> {
  return apiFetch(`/admin/system/sync/pending-deletes/${nro}/${ano}/approve`, {
    method: "POST",
  });
}

export async function rejectSyncPendingDelete(
  nro: number,
  ano: number,
): Promise<unknown> {
  return apiFetch(`/admin/system/sync/pending-deletes/${nro}/${ano}/reject`, {
    method: "POST",
  });
}

export async function controlSyncService(
  name: string,
  action: "start" | "stop" | "restart",
): Promise<{ ok: boolean; service_name: string; action: string }> {
  return apiFetch(`/admin/system/sync/service/${encodeURIComponent(name)}/${action}`, {
    method: "POST",
  });
}
