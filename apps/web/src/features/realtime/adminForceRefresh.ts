import { fetchRemotePainelConfig } from "@/features/painel-global/painelGlobalApi";
import { PAINEL_CONFIG_STORAGE_KEY } from "@/features/painel-global/painelConfigStore";

export const ADMIN_RELOAD_EPOCH_STORAGE_KEY = "sagra_admin_reload_epoch";
/** Espalha thundering herd após Atualizar Clients (poll + reconnect). */
export const ADMIN_RELOAD_JITTER_MS = 15_000;

export interface AdminForceRefreshMessage {
  type?: string;
  action?: string;
  origem?: string;
  overwriteConfig?: boolean;
  scope?: string;
}

export interface AdminReloadState {
  epoch: number;
  overwriteConfig: boolean;
  at: string | null;
}

let reloadInFlight = false;

export function isAdminForceReload(
  message: AdminForceRefreshMessage | null | undefined,
): boolean {
  if (!message || message.type !== "force_refresh") {
    return false;
  }
  const action = String(message.action ?? "").trim();
  const origem = String(message.origem ?? "").trim();
  return action === "reload" || origem === "admin_panel";
}

export function shouldReloadForAdminEpoch(
  serverEpoch: number,
  seenEpoch: number | null,
): boolean {
  if (!Number.isFinite(serverEpoch) || serverEpoch <= 0) {
    return false;
  }
  if (seenEpoch == null) {
    return false;
  }
  return serverEpoch > seenEpoch;
}

export function readStoredAdminReloadEpoch(): number | null {
  if (typeof sessionStorage === "undefined") {
    return null;
  }
  try {
    const raw = sessionStorage.getItem(ADMIN_RELOAD_EPOCH_STORAGE_KEY);
    if (raw == null || raw === "") {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeStoredAdminReloadEpoch(epoch: number): void {
  if (typeof sessionStorage === "undefined") {
    return;
  }
  try {
    sessionStorage.setItem(ADMIN_RELOAD_EPOCH_STORAGE_KEY, String(epoch));
  } catch {
    /* ignore quota / private mode */
  }
}

export async function applyPainelGlobalOverwrite(): Promise<void> {
  const globalConfig = await fetchRemotePainelConfig();
  localStorage.setItem(
    PAINEL_CONFIG_STORAGE_KEY,
    JSON.stringify(globalConfig),
  );
}

export async function applyAdminClientReload(
  overwriteConfig?: boolean,
): Promise<void> {
  if (reloadInFlight) {
    return;
  }
  reloadInFlight = true;
  const jitterMs = Math.floor(Math.random() * ADMIN_RELOAD_JITTER_MS);
  if (jitterMs > 0) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, jitterMs);
    });
  }
  if (overwriteConfig) {
    try {
      await applyPainelGlobalOverwrite();
    } catch (err) {
      console.error("[admin-reload] Falha ao baixar config global:", err);
    }
  }
  window.location.reload();
}

/** Test helper */
export function resetAdminClientReloadGateForTests(): void {
  reloadInFlight = false;
}
