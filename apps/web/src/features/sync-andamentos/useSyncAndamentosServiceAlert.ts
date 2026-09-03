import { useEffect, useState } from "react";

import {
  fetchSyncAndamentosServiceStatus,
  type SyncAndamentosServiceStatus,
} from "./api";

/** Intervalo de poll do status SCM do sync andamentos. */
export const SYNC_ANDAMENTOS_STATUS_POLL_MS = 30_000;

export function useSyncAndamentosServiceAlert(enabled = true): boolean {
  const [alert, setAlert] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setAlert(false);
      return;
    }

    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled || document.hidden) {
        return;
      }
      try {
        const status: SyncAndamentosServiceStatus =
          await fetchSyncAndamentosServiceStatus();
        if (!cancelled) {
          setAlert(Boolean(status.alert));
        }
      } catch {
        /* Falha de rede não força alerta — só alert:true da API. */
      }
    };

    const schedule = () => {
      if (cancelled) {
        return;
      }
      timer = window.setTimeout(() => {
        void poll().finally(() => {
          schedule();
        });
      }, SYNC_ANDAMENTOS_STATUS_POLL_MS);
    };

    void poll().finally(() => {
      schedule();
    });

    const onVisibility = () => {
      if (!document.hidden) {
        void poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [enabled]);

  return alert;
}
