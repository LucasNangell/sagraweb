import { useCallback, useEffect, useRef } from "react";

/** Toque discreto de duas notas, com ataque suave e decaimento curto. */
export function useSectorArrivalSound() {
  const contextRef = useRef<AudioContext | null>(null);
  const playingUntil = useRef(0);

  const getContext = useCallback(() => {
    const AudioContextCtor =
      window.AudioContext ||
      (window as Window & { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioContextCtor) return null;
    contextRef.current ??= new AudioContextCtor();
    return contextRef.current;
  }, []);

  useEffect(() => {
    const unlock = () => {
      const ctx = getContext();
      if (ctx?.state === "suspended") void ctx.resume().catch(() => {});
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      const ctx = contextRef.current;
      contextRef.current = null;
      if (ctx && ctx.state !== "closed") void ctx.close().catch(() => {});
    };
  }, [getContext]);

  const playArrivalSound = useCallback(async () => {
    try {
      const requestedAt = performance.now();
      const ctx = getContext();
      if (!ctx) return;
      if (ctx.state === "suspended") await ctx.resume();
      // Uma chegada bloqueada pelo autoplay não deve tocar atrasada ao liberar o áudio.
      if (
        contextRef.current !== ctx ||
        ctx.state !== "running" ||
        performance.now() - requestedAt > 1000 ||
        ctx.currentTime < playingUntil.current
      )
        return;

      const now = ctx.currentTime;
      playingUntil.current = now + 0.7;
      [587.33, 783.99].forEach((frequency, index) => {
        const start = now + index * 0.14;
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(frequency, start);
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(0.035, start + 0.04);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
        gain.gain.linearRampToValueAtTime(0, start + 0.55);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.onended = () => {
          oscillator.disconnect();
          gain.disconnect();
        };
        oscillator.start(start);
        oscillator.stop(start + 0.56);
      });
    } catch (error) {
      console.warn(
        "[Painel moderno] Não foi possível reproduzir o toque:",
        error,
      );
    }
  }, [getContext]);

  return { playArrivalSound };
}
