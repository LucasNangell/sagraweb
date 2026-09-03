import { useEffect, useRef, type MutableRefObject } from "react";

import { fetchAdminReloadState } from "@/api/adminReload";
import {
  applyAdminClientReload,
  isAdminForceReload,
  readStoredAdminReloadEpoch,
  shouldReloadForAdminEpoch,
  writeStoredAdminReloadEpoch,
  type AdminForceRefreshMessage,
} from "@/features/realtime/adminForceRefresh";
import { useSagraWebSocket } from "@/hooks/useSagraWebSocket";

const POLL_WS_DOWN_MS = 8_000;
const POLL_WS_UP_MS = 8_000;

async function maybeReloadFromState(
  seenEpochRef: MutableRefObject<number | null>,
): Promise<void> {
  const state = await fetchAdminReloadState();
  const serverEpoch = Number(state.epoch) || 0;

  if (seenEpochRef.current == null) {
    const stored = readStoredAdminReloadEpoch();
    seenEpochRef.current = stored ?? serverEpoch;
    writeStoredAdminReloadEpoch(seenEpochRef.current);
  }

  if (!shouldReloadForAdminEpoch(serverEpoch, seenEpochRef.current)) {
    return;
  }

  seenEpochRef.current = serverEpoch;
  writeStoredAdminReloadEpoch(serverEpoch);
  await applyAdminClientReload(Boolean(state.overwriteConfig));
}

export function useAdminForceRefreshReload() {
  const seenEpochRef = useRef<number | null>(readStoredAdminReloadEpoch());

  const { status: wsStatus } = useSagraWebSocket<AdminForceRefreshMessage>({
    path: "/ws",
    onMessage: (data) => {
      if (!isAdminForceReload(data)) {
        return;
      }
      void (async () => {
        try {
          const state = await fetchAdminReloadState();
          const epoch = Number(state.epoch) || 0;
          seenEpochRef.current = epoch;
          writeStoredAdminReloadEpoch(epoch);
          await applyAdminClientReload(
            Boolean(data.overwriteConfig) || Boolean(state.overwriteConfig),
          );
        } catch {
          /* Poll HTTP aplica o reload quando a API responder. */
        }
      })();
    },
  });

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;

    const poll = async () => {
      if (cancelled || document.hidden) {
        return;
      }
      try {
        await maybeReloadFromState(seenEpochRef);
      } catch {
        /* poll is best-effort; WS remains primary */
      }
    };

    const schedule = () => {
      if (cancelled) {
        return;
      }
      const delay = wsStatus === "connected" ? POLL_WS_UP_MS : POLL_WS_DOWN_MS;
      timer = window.setTimeout(() => {
        void poll().finally(schedule);
      }, delay);
    };

    void poll().finally(schedule);

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
  }, [wsStatus]);
}

export function AdminForceRefreshListener() {
  useAdminForceRefreshReload();
  return null;
}
