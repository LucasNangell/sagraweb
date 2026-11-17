import { apiFetch } from "@/lib/api";

export type SyncAlertReason =
  | "SCM_NOT_RUNNING"
  | "DATA_DIVERGENCE"
  | "DATA_STUCK"
  | "DATA_LAGGING"
  | "SYNC_DOWN"
  | "CIRCUIT_OPEN"
  | "RECOVERY_FAILED";

export const SYNC_ALERT_REASON_LABELS: Record<SyncAlertReason, string> = {
  SCM_NOT_RUNNING: "Serviço do sync não está em execução",
  DATA_DIVERGENCE: "Andamentos não reconciliados entre MDB e MySQL",
  DATA_STUCK: "Andamentos não reconciliados (divergência travada)",
  DATA_LAGGING: "Sync em recuperação (lag transitório MDB↔MySQL)",
  SYNC_DOWN: "Sync indisponível há mais de 5 minutos",
  CIRCUIT_OPEN: "Recuperação automática pausada (falha de processo)",
  RECOVERY_FAILED: "Última tentativa de recuperação automática falhou",
};

export interface SyncDivergenceSample {
  only_mdb?: string[];
  only_mysql?: string[];
  only_mdb_count?: number;
  only_mysql_count?: number;
  sample_ok?: boolean;
  direction?: string | null;
}

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
  /** Contagens travadas (monitor alert=true). */
  data_stale?: boolean;
  /** Lag em cura — informativo, sem alerta vermelho sozinho. */
  data_lagging?: boolean;
  mdb_count?: number | null;
  mysql_count?: number | null;
  direction?: string | null;
  sample?: SyncDivergenceSample | null;
  watchdog?: SyncWatchdogSummary;
}

export async function fetchSyncAndamentosServiceStatus(): Promise<SyncAndamentosServiceStatus> {
  return apiFetch<SyncAndamentosServiceStatus>(
    "/sync-andamentos/service-status",
    { cache: "no-store" },
  );
}
