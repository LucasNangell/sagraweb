import { useCallback, useEffect, useRef, useState } from "react";

/** Espera restante para cadência “uma por segundo”. */
export function idleFlipPadMs(elapsedMs: number, intervalMs = 1000): number {
  return Math.max(0, intervalMs - Math.max(0, elapsedMs));
}

/**
 * Folheia automaticamente (~1 folha/s) até o usuário interagir (`engage`).
 * Sem órbita — só troca de página.
 */
export function useIdleSpiralPageFlip(opts: {
  enabled: boolean;
  /** Intervalo alvo entre inícios de virada (ms). Default 1000. */
  intervalMs?: number;
  onFlip: () => Promise<void>;
}) {
  const [engaged, setEngaged] = useState(false);
  const engagedRef = useRef(false);
  const onFlipRef = useRef(opts.onFlip);
  const intervalRef = useRef(opts.intervalMs ?? 1000);
  onFlipRef.current = opts.onFlip;
  intervalRef.current = opts.intervalMs ?? 1000;

  const engage = useCallback(() => {
    if (engagedRef.current) return;
    engagedRef.current = true;
    setEngaged(true);
  }, []);

  useEffect(() => {
    if (engaged || !opts.enabled) return;
    let cancelled = false;
    const sleep = (ms: number) =>
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, ms);
      });

    const run = async () => {
      // Pequeno atraso inicial para a cena estabilizar
      await sleep(400);
      while (!cancelled && !engagedRef.current) {
        const t0 = performance.now();
        try {
          await onFlipRef.current();
        } catch {
          // ignora falha pontual de textura/cena
        }
        if (cancelled || engagedRef.current) break;
        await sleep(idleFlipPadMs(performance.now() - t0, intervalRef.current));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [engaged, opts.enabled]);

  return { engaged, engage };
}
