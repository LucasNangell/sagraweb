import { useRegisterSW } from "virtual:pwa-register/react";
import { useCallback, useEffect, useRef } from "react";

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const BOOT_APPLY_WINDOW_MS = 3000;
export const PWA_RELOAD_GUARD_KEY = "sagra-pwa-reloading";

/**
 * Registro do service worker (somente build de produção).
 * Nova versão fica em waiting; aplica no próximo carregamento (F5 / reabrir), sem banner.
 */
export function shouldApplyWaitingWorker(options: {
  hasWaiting: boolean;
  hasController: boolean;
  bootStartedAt: number;
  now: number;
  alreadyTried: boolean;
  bootWindowMs?: number;
}): boolean {
  if (!options.hasWaiting || !options.hasController) return false;
  if (options.alreadyTried) return false;
  const windowMs = options.bootWindowMs ?? BOOT_APPLY_WINDOW_MS;
  return options.now - options.bootStartedAt <= windowMs;
}

function scheduleUpdateChecks(
  registration: ServiceWorkerRegistration,
  intervalRef: { current: ReturnType<typeof setInterval> | null },
): void {
  if (intervalRef.current) {
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }
  void registration.update();
  intervalRef.current = setInterval(() => {
    void registration.update();
  }, UPDATE_CHECK_INTERVAL_MS);
}

function watchInstalling(
  worker: ServiceWorker | null,
  onInstalled: () => void,
): void {
  if (!worker) return;
  worker.addEventListener("statechange", () => {
    if (worker.state === "installed") {
      onInstalled();
    }
  });
}

export function PwaUpdatePrompt() {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);
  const bootStartedAtRef = useRef(Date.now());
  const triedApplyRef = useRef(false);
  const updateServiceWorkerRef = useRef<(reloadPage?: boolean) => Promise<void>>(
    async () => undefined,
  );

  const tryApplyWaiting = useCallback((registration: ServiceWorkerRegistration) => {
    if (!registration.waiting) {
      sessionStorage.removeItem(PWA_RELOAD_GUARD_KEY);
      return;
    }

    const alreadyTried =
      triedApplyRef.current ||
      sessionStorage.getItem(PWA_RELOAD_GUARD_KEY) === "1";
    if (
      !shouldApplyWaitingWorker({
        hasWaiting: true,
        hasController: Boolean(navigator.serviceWorker?.controller),
        bootStartedAt: bootStartedAtRef.current,
        now: Date.now(),
        alreadyTried,
      })
    ) {
      return;
    }

    triedApplyRef.current = true;
    sessionStorage.setItem(PWA_RELOAD_GUARD_KEY, "1");
    registration.waiting.postMessage({ type: "SKIP_WAITING" });
    void updateServiceWorkerRef.current(true);
  }, []);

  const tryApplyWaitingRef = useRef(tryApplyWaiting);
  tryApplyWaitingRef.current = tryApplyWaiting;

  const { updateServiceWorker } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration ?? null;
      if (!registration) return;

      const apply = () => {
        tryApplyWaitingRef.current(registration);
      };
      apply();
      watchInstalling(registration.installing, apply);
      registration.addEventListener("updatefound", () => {
        watchInstalling(registration.installing, apply);
      });
      scheduleUpdateChecks(registration, intervalRef);
    },
  });

  updateServiceWorkerRef.current = updateServiceWorker;

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void registrationRef.current?.update();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  return null;
}

export function PwaProvider({ children }: { children: React.ReactNode }) {
  if (!import.meta.env.PROD) {
    return <>{children}</>;
  }
  return (
    <>
      {children}
      <PwaUpdatePrompt />
    </>
  );
}
