import { easeInOutCubic } from "./boxKinematics";

export type TweenHandle = { cancel: () => void };

/**
 * Tween linear no tempo com easing cúbico — sem GSAP.
 * Chama `onUpdate(value)` a cada frame até chegar em `to`.
 */
export function tweenValue(
  from: number,
  to: number,
  durationMs: number,
  onUpdate: (value: number) => void,
  onDone?: () => void,
): TweenHandle {
  let raf = 0;
  let cancelled = false;
  const start = performance.now();
  const delta = to - from;

  const step = (now: number) => {
    if (cancelled) return;
    const t =
      durationMs <= 0 ? 1 : Math.min(1, (now - start) / Math.max(1, durationMs));
    onUpdate(from + delta * easeInOutCubic(t));
    if (t < 1) {
      raf = requestAnimationFrame(step);
    } else {
      onDone?.();
    }
  };

  raf = requestAnimationFrame(step);
  return {
    cancel() {
      cancelled = true;
      cancelAnimationFrame(raf);
    },
  };
}
