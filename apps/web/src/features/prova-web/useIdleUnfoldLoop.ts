import { useCallback, useEffect, useRef, useState } from "react";

/** Duração de um meio-ciclo (0→100 ou 100→0), em ms. */
const HALF_CYCLE_MS = 3000;

function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Loop idle abrir↔fechar (0–100%) até o usuário interagir (`engage`).
 * Preferível a yaw no folheto — demonstra as dobras sem orbitar.
 */
export function useIdleUnfoldLoop(opts: {
  onUnfold: (percent: number) => void;
  /** ms por meio-ciclo; default ~3s. */
  halfCycleMs?: number;
}) {
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef(false);
  const onUnfoldRef = useRef(opts.onUnfold);
  const halfMsRef = useRef(opts.halfCycleMs ?? HALF_CYCLE_MS);
  onUnfoldRef.current = opts.onUnfold;
  halfMsRef.current = opts.halfCycleMs ?? HALF_CYCLE_MS;

  const engage = useCallback(() => {
    if (engagedRef.current) return;
    engagedRef.current = true;
    setEngaged(true);
  }, []);

  useEffect(() => {
    if (engaged) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      if (engagedRef.current) return;
      const half = Math.max(400, halfMsRef.current);
      const elapsed = now - t0;
      // Ciclo completo 0→100→0 = 2 * half
      const cycle = (elapsed % (half * 2)) / half;
      // 0..1 sobe, 1..2 desce
      const goingUp = cycle < 1;
      const local = goingUp ? cycle : 2 - cycle;
      const percent = smoothstep01(local) * 100;
      onUnfoldRef.current(percent);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [engaged]);

  return { engaged, engage };
}
