import { useCallback, useEffect, useMemo, useState } from "react";

import {
  allowedPainelSetores,
  useAuthStore,
} from "@/auth/authStore";

import {
  fetchBoardPreference,
  fetchSetorPainelDefault,
} from "./api";
import { DEFAULT_DASHBOARD_CONFIG } from "./constants";
import type { DashboardConfig } from "./types";
import { normalizeDashboardConfigFromRemote } from "./utils";

export function useBoardConfig() {
  const user = useAuthStore((s) => s.user);
  const permissions = useAuthStore((s) => s.permissions);
  const allowed = useMemo(
    () => allowedPainelSetores(permissions, user?.setor),
    [permissions, user?.setor],
  );

  const [config, setConfig] = useState<DashboardConfig>(() => ({
    ...DEFAULT_DASHBOARD_CONFIG,
    sector: user?.setor || allowed[0] || DEFAULT_DASHBOARD_CONFIG.sector,
  }));
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const sectorHint = user?.setor || allowed[0] || DEFAULT_DASHBOARD_CONFIG.sector;
    try {
      let remote: unknown = null;
      try {
        remote = await fetchBoardPreference();
      } catch {
        remote = null;
      }
      if (!remote && sectorHint) {
        try {
          remote = await fetchSetorPainelDefault(sectorHint);
        } catch {
          remote = null;
        }
      }
      const next = normalizeDashboardConfigFromRemote(remote, sectorHint);
      if (allowed.length > 0 && !allowed.includes(next.sector)) {
        next.sector = allowed[0]!;
      }
      setConfig(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao carregar config");
      setConfig({
        ...DEFAULT_DASHBOARD_CONFIG,
        sector: sectorHint,
      });
    } finally {
      setLoading(false);
    }
  }, [allowed, user?.setor]);

  useEffect(() => {
    void load();
  }, [load]);

  const setSector = useCallback(
    (sector: string) => {
      if (allowed.length > 0 && !allowed.includes(sector)) return;
      setConfig((prev) => ({ ...prev, sector }));
    },
    [allowed],
  );

  return {
    config,
    setSector,
    allowedSectors: allowed,
    loading,
    error,
    reload: load,
  };
}
