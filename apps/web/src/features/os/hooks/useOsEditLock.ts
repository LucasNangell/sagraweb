import { useCallback, useEffect, useRef, useState } from "react";

import {
  acquireOsEditLock,
  heartbeatOsEditLock,
  releaseOsEditLock,
  releaseOsEditLockKeepalive,
  type OsEditLockOrigem,
} from "@/api/os";

export const OS_EDIT_LOCK_HEARTBEAT_MS = 20_000;

export function newOsEditLockToken(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `t-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

export function osEditLockAlertMessage(err: unknown): string {
  if (err instanceof Error && err.message.trim()) {
    return err.message;
  }
  return "Não é possível editar esta OS no momento.";
}

function validOsKey(ano: number | null, id: number | null): boolean {
  return (
    ano != null &&
    id != null &&
    Number.isFinite(ano) &&
    Number.isFinite(id) &&
    ano > 0 &&
    id > 0
  );
}

export function useOsEditLock(opts: {
  ano: number | null;
  id: number | null;
  origem: OsEditLockOrigem;
  enabled?: boolean;
}) {
  const { ano, id, origem, enabled = false } = opts;
  const tokenRef = useRef(newOsEditLockToken());
  const heldRef = useRef(false);
  const [held, setHeld] = useState(false);
  const [acquiring, setAcquiring] = useState(Boolean(enabled));
  const [blocked, setBlocked] = useState(false);

  const markHeld = useCallback((value: boolean) => {
    heldRef.current = value;
    setHeld(value);
  }, []);

  const acquire = useCallback(async (): Promise<boolean> => {
    if (!validOsKey(ano, id)) {
      return false;
    }
    setAcquiring(true);
    try {
      await acquireOsEditLock(ano!, id!, {
        token: tokenRef.current,
        origem,
      });
      setBlocked(false);
      markHeld(true);
      return true;
    } catch (err) {
      markHeld(false);
      setBlocked(true);
      window.alert(osEditLockAlertMessage(err));
      return false;
    } finally {
      setAcquiring(false);
    }
  }, [ano, id, origem, markHeld]);

  const release = useCallback(async (): Promise<void> => {
    if (!heldRef.current || !validOsKey(ano, id)) {
      markHeld(false);
      return;
    }
    markHeld(false);
    try {
      await releaseOsEditLock(ano!, id!, {
        token: tokenRef.current,
        origem,
      });
    } catch {
      /* TTL cobre falha de release */
    }
  }, [ano, id, origem, markHeld]);

  useEffect(() => {
    if (!enabled || !validOsKey(ano, id)) {
      setAcquiring(false);
      return;
    }
    let cancelled = false;
    setAcquiring(true);
    void acquireOsEditLock(ano!, id!, {
      token: tokenRef.current,
      origem,
    })
      .then(() => {
        if (cancelled) {
          releaseOsEditLockKeepalive(ano!, id!, {
            token: tokenRef.current,
            origem,
          });
          return;
        }
        setBlocked(false);
        markHeld(true);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        markHeld(false);
        setBlocked(true);
        window.alert(osEditLockAlertMessage(err));
      })
      .finally(() => {
        if (!cancelled) setAcquiring(false);
      });
    return () => {
      cancelled = true;
      if (heldRef.current) {
        heldRef.current = false;
        releaseOsEditLockKeepalive(ano!, id!, {
          token: tokenRef.current,
          origem,
        });
      }
    };
  }, [enabled, ano, id, origem, markHeld]);

  useEffect(() => {
    if (enabled) return;
    return () => {
      if (heldRef.current && validOsKey(ano, id)) {
        heldRef.current = false;
        releaseOsEditLockKeepalive(ano!, id!, {
          token: tokenRef.current,
          origem,
        });
      }
    };
  }, [enabled, ano, id, origem]);

  useEffect(() => {
    if (!held || !validOsKey(ano, id)) return;

    const beat = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      ) {
        return;
      }
      void heartbeatOsEditLock(ano!, id!, {
        token: tokenRef.current,
        origem,
      }).catch(() => {
        markHeld(false);
      });
    };

    const timer = window.setInterval(beat, OS_EDIT_LOCK_HEARTBEAT_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") beat();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [held, ano, id, origem, markHeld]);

  useEffect(() => {
    const onPageHide = () => {
      if (!heldRef.current || !validOsKey(ano, id)) return;
      releaseOsEditLockKeepalive(ano!, id!, {
        token: tokenRef.current,
        origem,
      });
      heldRef.current = false;
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, [ano, id, origem]);

  return { acquire, release, held, acquiring, blocked };
}
