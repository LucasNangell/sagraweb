import { useEffect, useRef } from "react";

import type { UserPreferenceKey } from "@/api/userPreferences";
import {
  loadPreferenceFromServer,
  schedulePreferenceSave,
} from "@/lib/userPreferences";

interface UseUserPreferenceSyncOptions<T> {
  key: UserPreferenceKey;
  enabled: boolean;
  watchValue: T;
  onRemoteLoaded: (value: T) => void;
  toPayload?: (value: T) => unknown;
  debounceMs?: number;
}

/** Carrega preferência do servidor ao logar; persiste alterações com debounce. */
export function useUserPreferenceSync<T>({
  key,
  enabled,
  watchValue,
  onRemoteLoaded,
  toPayload,
  debounceMs,
}: UseUserPreferenceSyncOptions<T>): void {
  const readyRef = useRef(false);
  const onRemoteLoadedRef = useRef(onRemoteLoaded);
  onRemoteLoadedRef.current = onRemoteLoaded;

  useEffect(() => {
    if (!enabled) {
      readyRef.current = false;
      return;
    }

    let cancelled = false;
    readyRef.current = false;

    void (async () => {
      const remote = await loadPreferenceFromServer<T>(key);
      if (cancelled) {
        return;
      }
      if (remote != null) {
        onRemoteLoadedRef.current(remote);
      }
      readyRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, key]);

  useEffect(() => {
    if (!enabled || !readyRef.current) {
      return;
    }
    const payload = toPayload ? toPayload(watchValue) : watchValue;
    schedulePreferenceSave(key, payload, debounceMs);
  }, [debounceMs, enabled, key, toPayload, watchValue]);
}
