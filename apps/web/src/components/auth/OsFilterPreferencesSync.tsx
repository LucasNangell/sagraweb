import { useEffect, useRef } from "react";

import { useAuthStore } from "@/features/auth/authStore";
import { useOsFiltersStore } from "@/features/os/osFiltersStore";
import {
  loadPreferenceFromServer,
  schedulePreferenceSave,
} from "@/lib/userPreferences";

interface OsFilterTogglesPayload {
  includeOs?: boolean;
  includeSp?: boolean;
}

/** Sincroniza toggles de filtro OS com o servidor após login. */
export function OsFilterPreferencesSync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const includeOs = useOsFiltersStore((s) => s.filters.includeOs);
  const includeSp = useOsFiltersStore((s) => s.filters.includeSp);
  const saveGeneration = useRef(0);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    let cancelled = false;

    void (async () => {
      const remote = await loadPreferenceFromServer<OsFilterTogglesPayload>(
        "os_filter_toggles",
      );
      if (cancelled || !remote) {
        return;
      }
      useOsFiltersStore.setState((state) => {
        const next = {
          includeFinished: true,
          includeOs: remote.includeOs ?? state.filters.includeOs,
          includeSp: remote.includeSp ?? state.filters.includeSp,
        };
        if (
          next.includeOs === state.filters.includeOs &&
          next.includeSp === state.filters.includeSp &&
          state.filters.includeFinished
        ) {
          return state;
        }
        return {
          filters: { ...state.filters, ...next },
        };
      });
      saveGeneration.current += 1;
    })();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }
    const gen = saveGeneration.current;
    const timer = window.setTimeout(() => {
      if (gen !== saveGeneration.current) {
        return;
      }
      schedulePreferenceSave("os_filter_toggles", {
        includeOs,
        includeSp,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [isAuthenticated, includeOs, includeSp]);

  return null;
}
