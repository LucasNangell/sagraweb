import { useCallback, useRef } from "react";

export function usePriorityAlert() {
  const audioCtxRef = useRef<AudioContext | null>(null);
  const customAlertRef = useRef<HTMLAudioElement | null>(null);

  const triggerPriorityAlert = useCallback(async () => {
    try {
      try {
        if (!customAlertRef.current) {
          customAlertRef.current = new Audio("/danger.mp3");
          customAlertRef.current.preload = "auto";
        }
        const clip = customAlertRef.current.cloneNode(true) as HTMLAudioElement;
        clip.currentTime = 0;
        await clip.play();
        return;
      } catch (playErr) {
        console.warn(
          "[Alert] Falha ao tocar danger.mp3, usando beep padrão:",
          playErr,
        );
      }

      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioContextCtor) {
        console.warn("[Alert] AudioContext não suportado");
        return;
      }

      if (!audioCtxRef.current) {
        audioCtxRef.current = new AudioContextCtor();
      }

      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") {
        await ctx.resume();
      }

      const now = ctx.currentTime;
      const toneLen = 0.075;
      const gap = 0.005;

      for (let i = 0; i < 20; i++) {
        const startAt = now + i * (toneLen + gap);
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1000, startAt);

        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, startAt);
        gain.gain.exponentialRampToValueAtTime(0.24, startAt + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + toneLen);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(startAt);
        osc.stop(startAt + toneLen);
      }
    } catch (err) {
      console.warn("[Alert] Falha ao tocar alerta:", err);
    }
  }, []);

  return { triggerPriorityAlert };
}
