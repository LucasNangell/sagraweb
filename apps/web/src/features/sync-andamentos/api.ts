import { apiFetch } from "@/lib/api";

export type SyncAlertReason =
  | "SCM_NOT_RUNNING"
  | "DATA_DIVERGENCE"
  | "SYNC_DOWN"
  | "CIRCUIT_OPEN"
  | "RECOVERY_FAILED";

export const SYNC_ALERT_REASON_LABELS: Record<SyncAlertReason, string> = {
  SCM_NOT_RUNNING: "Serviço do sync não está em execução",
  DATA_DIVERGENCE: "Contagens MDB e MySQL divergentes após reinício",
  SYNC_DOWN: "Sync indisponível há mais de 5 minutos",
  CIRCUIT_OPEN: "Recuperação automática pausada (muitas tentativas seguidas)",
  RECOVERY_FAILED: "Última tentativa de recuperação automática falhou",
};

/** Visão resumida do SAGRA-SystemWatchdog sobre o sync. */
export interface SyncWatchdogSummary {
  available: boolean;
  fresh: boolean;
  maintenance: boolean;
  unhealthy_since: string | null;
  circuit_open_until: string | null;
  last_action_ok: boolean | null;
  alert_reasons: SyncAlertReason[];
}

export interface SyncAndamentosServiceStatus {
  service_name: string;
  exists: boolean;
  status: string | null;
  query_ok: boolean;
  healthy: boolean;
  alert: boolean;
  alert_reasons?: SyncAlertReason[];
  /** Contagens MDB/MySQL divergentes após restart do sync (monitor). */
  data_stale?: boolean;
  mdb_count?: number | null;
  mysql_count?: number | null;
  watchdog?: SyncWatchdogSummary;
}

export async function fetchSyncAndamentosServiceStatus(): Promise<SyncAndamentosServiceStatus> {
  return apiFetch<SyncAndamentosServiceStatus>(
    "/sync-andamentos/service-status",
    { cache: "no-store" },
  );
}
