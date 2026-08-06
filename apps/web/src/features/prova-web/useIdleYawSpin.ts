import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Auto-yaw enquanto o usuário não interagiu (clique ou scroll).
 * `onTick(deltaSec)` aplica o incremento; retorna se ainda deve continuar.
 */
export function useIdleYawSpin(opts: {
  /** Graus por segundo (book CSS) ou rad/s (fold Three) — o caller interpreta. */
  speedPerSec: number;
  onTick: (delta: number) => void;
}) {
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef(false);
  const onTickRef = useRef(opts.onTick);
  const speedRef = useRef(opts.speedPerSec);
  onTickRef.current = opts.onTick;
  speedRef.current = opts.speedPerSec;

  const engage = useCallback(() => {
    if (engagedRef.current) return;
    engagedRef.current = true;
    setEngaged(true);
  }, []);

  useEffect(() => {
    if (engaged) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      if (engagedRef.current) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      onTickRef.current(speedRef.current * dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engaged]);

  return { engaged, engage };
}
