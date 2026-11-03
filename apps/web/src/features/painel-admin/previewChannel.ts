import { normalizeDashboardConfigFromRemote } from "@/features/dashboard-setor/normalizeConfig";
import type { DashboardConfig } from "@/features/dashboard-setor/types";

export const PREVIEW_CHANNEL_NAME = "sagra-painel-admin-preview";
const PREVIEW_STORAGE_KEY = "sagra-painel-admin-preview";

type PreviewMessage =
  | { type: "config"; config: DashboardConfig }
  | { type: "request" };

function writeSnapshot(config: DashboardConfig) {
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(config));
  } catch {
    /* quota / private mode */
  }
}

export function readPreviewSnapshot(): DashboardConfig | null {
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return normalizeDashboardConfigFromRemote(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function publishPreviewConfig(config: DashboardConfig) {
  writeSnapshot(config);
  const channel = new BroadcastChannel(PREVIEW_CHANNEL_NAME);
  const message: PreviewMessage = { type: "config", config };
  channel.postMessage(message);
  channel.close();
}

export function subscribePreviewConfig(
  onConfig: (config: DashboardConfig) => void,
): () => void {
  const channel = new BroadcastChannel(PREVIEW_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<PreviewMessage>) => {
    if (event.data?.type === "config" && event.data.config) {
      onConfig(normalizeDashboardConfigFromRemote(event.data.config));
    }
  };
  channel.postMessage({ type: "request" } satisfies PreviewMessage);
  const cached = readPreviewSnapshot();
  if (cached) {
    onConfig(cached);
  }
  return () => channel.close();
}

export function listenPreviewRequests(
  getConfig: () => DashboardConfig,
): () => void {
  const channel = new BroadcastChannel(PREVIEW_CHANNEL_NAME);
  channel.onmessage = (event: MessageEvent<PreviewMessage>) => {
    if (event.data?.type === "request") {
      channel.postMessage({
        type: "config",
        config: getConfig(),
      } satisfies PreviewMessage);
    }
  };
  return () => channel.close();
}
