import { useCallback, useRef } from "react";

import {
  playNotificationSound,
  resolveNotificationSoundForSlot,
} from "../notificationSounds";
import type {
  DashboardNotificationSound,
  DashboardNotificationSounds,
  DashboardSoundSlot,
} from "../types";

export function usePriorityAlert(
  sounds?: DashboardNotificationSounds,
  legacy?: DashboardNotificationSound,
) {
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const legacyRef = useRef(legacy);
  legacyRef.current = legacy;

  const triggerPriorityAlert = useCallback(
    async (slot: DashboardSoundSlot = "normal") => {
      try {
        await playNotificationSound(
          resolveNotificationSoundForSlot(
            soundsRef.current,
            slot,
            legacyRef.current,
          ),
        );
      } catch (err) {
        console.warn("[Alert] Falha ao tocar alerta:", err);
      }
    },
    [],
  );

  return { triggerPriorityAlert };
}
