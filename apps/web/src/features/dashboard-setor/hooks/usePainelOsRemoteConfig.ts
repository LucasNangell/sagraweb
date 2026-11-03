import { useCallback, useEffect, useRef } from "react";

import {
  fetchPainelRemoteConfig,
  postPainelHello,
  type PainelOsRoute,
} from "@/api/painelRemote";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";
import { normalizeDashboardConfigFromRemote } from "../normalizeConfig";
import {
  getPainelClientId,
  isPainelConfigUpdateMessage,
} from "../painelClientId";
import { saveDashboardConfig } from "../configStorage";
import { buildDashboardConfigSignature } from "../utils";
import type { DashboardConfig } from "../types";

/** Fallback quando o WS de config não chega no painel aberto. */
const PAINEL_REMOTE_CONFIG_POLL_MS = 8_000;

interface UsePainelOsRemoteConfigOptions {
  route: PainelOsRoute;
  config: DashboardConfig;
  setConfig: (next: DashboardConfig) => void;
  fallbackSector?: string | null;
}

export function applyPainelConfigUpdate(
  current: DashboardConfig,
  message: { payload?: unknown; sector?: string },
  fallbackSector?: string | null,
): DashboardConfig {
  if (message.payload != null) {
    return normalizeDashboardConfigFromRemote(message.payload, fallbackSector);
  }
  const sector = (message.sector ?? "").trim();
  if (!sector) {
    return current;
  }
  return normalizeDashboardConfigFromRemote(
    { ...current, sector },
    fallbackSector,
  );
}

export function usePainelOsRemoteConfig({
  route,
  config,
  setConfig,
  fallbackSector,
}: UsePainelOsRemoteConfigOptions): string {
  const clientId = getPainelClientId();
  const configRef = useRef(config);
  configRef.current = config;
  const setConfigRef = useRef(setConfig);
  setConfigRef.current = setConfig;
  const fallbackRef = useRef(fallbackSector);
  fallbackRef.current = fallbackSector;

  const applyRemote = useCallback((next: DashboardConfig) => {
    if (
      buildDashboardConfigSignature(next) ===
      buildDashboardConfigSignature(configRef.current)
    ) {
      const currentShows =
        configRef.current.showAndamentoTime !== false;
      const nextShows = next.showAndamentoTime !== false;
      if (currentShows === nextShows && next.sector === configRef.current.sector) {
        return;
      }
    }
    saveDashboardConfig(next);
    setConfigRef.current(next);
  }, []);

  const { send, status } = useSagraWebSocket({
    path: "/ws",
    onMessage: (data) => {
      if (!isPainelConfigUpdateMessage(data, clientId)) {
        return;
      }
      applyRemote(
        applyPainelConfigUpdate(configRef.current, data, fallbackRef.current),
      );
    },
  });

  const pullRemoteConfig = useCallback(() => {
    return fetchPainelRemoteConfig(clientId)
      .then((remote) => {
        if (remote.payload == null) {
          return;
        }
        applyRemote(
          normalizeDashboardConfigFromRemote(
            remote.payload,
            fallbackRef.current,
          ),
        );
      })
      .catch((err) => {
        console.warn("[painel-remoto] falha ao carregar config", err);
      });
  }, [applyRemote, clientId]);

  useEffect(() => {
    let cancelled = false;
    const tick = () => {
      if (cancelled || document.hidden) {
        return;
      }
      void pullRemoteConfig();
    };
    tick();
    const timer = window.setInterval(tick, PAINEL_REMOTE_CONFIG_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        tick();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [pullRemoteConfig]);

  useEffect(() => {
    const body = {
      clientId,
      route,
      sector: config.sector,
    };
    void postPainelHello(body).catch((err) => {
      console.warn("[painel-remoto] hello HTTP falhou", err);
    });
    if (status === "connected") {
      send({
        type: "painel_hello",
        clientId,
        route,
        sector: config.sector,
      });
    }
  }, [clientId, config.sector, route, send, status]);

  useEffect(() => {
    if (status !== "connected") {
      return;
    }
    void pullRemoteConfig();
  }, [pullRemoteConfig, status]);

  return clientId;
}
