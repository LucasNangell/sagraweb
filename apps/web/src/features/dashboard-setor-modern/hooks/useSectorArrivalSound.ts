import { useCallback, useEffect, useRef } from "react";

import {
  playNotificationSound,
  resolveNotificationSoundForSlot,
} from "@/features/dashboard-setor/notificationSounds";
import type {
  DashboardNotificationSound,
  DashboardNotificationSounds,
  DashboardSoundSlot,
} from "@/features/dashboard-setor/types";

export function useSectorArrivalSound(
  sounds?: DashboardNotificationSounds,
  legacy?: DashboardNotificationSound,
) {
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const legacyRef = useRef(legacy);
  legacyRef.current = legacy;

  useEffect(() => {
    const unlock = () => {
      const probe = new Audio();
      probe.muted = true;
      void probe.play().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const playArrivalSound = useCallback(async (slot: DashboardSoundSlot = "normal") => {
    try {
      await playNotificationSound(
        resolveNotificationSoundForSlot(
          soundsRef.current,
          slot,
          legacyRef.current,
        ),
      );
    } catch (error) {
      console.warn(
        "[Painel moderno] Não foi possível reproduzir o toque:",
        error,
      );
    }
  }, []);

  return { playArrivalSound };
}
