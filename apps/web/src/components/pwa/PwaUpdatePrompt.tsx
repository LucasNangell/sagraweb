import { useRegisterSW } from "virtual:pwa-register/react";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchServerBuildId,
  isClientBuildOutdated,
  resolveClientBuildId,
} from "@/components/pwa/pwaUpdateUtils";

const UPDATE_CHECK_INTERVAL_MS = 5 * 60 * 1000;

/**
 * Registro do service worker (somente build de produção) e aviso de nova versão.
 * Atualização manual para não interromper operações em andamento.
 * Dismiss "Depois" é só em memória — F5 sempre reavalia.
 */
async function clearAppCaches(): Promise<void> {
  if (!("caches" in window)) return;
  const keys = await caches.keys();
  await Promise.all(keys.map((key) => caches.delete(key)));
}

async function forceServiceWorkerRefresh(): Promise<void> {
  await clearAppCaches();
  const registration = await navigator.serviceWorker.getRegistration();
  await registration?.unregister();
}

function waitForControllerChange(timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    if (!("serviceWorker" in navigator)) {
      resolve(false);
      return;
    }

    const timer = window.setTimeout(() => resolve(false), timeoutMs);
    navigator.serviceWorker.addEventListener(
      "controllerchange",
      () => {
        window.clearTimeout(timer);
        resolve(true);
      },
      { once: true },
    );
  });
}

function sendSkipWaiting(registration: ServiceWorkerRegistration): void {
  registration.waiting?.postMessage({ type: "SKIP_WAITING" });
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

export function PwaUpdatePrompt() {
  const [visible, setVisible] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [buildOutdated, setBuildOutdated] = useState(false);
  const [waitingDetected, setWaitingDetected] = useState(false);
  const dismissedRef = useRef(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      registrationRef.current = registration ?? null;
      if (!registration) return;

      if (registration.waiting) {
        setWaitingDetected(true);
      }
      scheduleUpdateChecks(registration, intervalRef);
    },
  });

  const updateAvailable = needRefresh || waitingDetected || buildOutdated;

  const showIfNotDismissed = useCallback(() => {
    if (dismissedRef.current) return;
    setVisible(true);
  }, []);

  const checkServerBuild = useCallback(async () => {
    const serverId = await fetchServerBuildId();
    const outdated = isClientBuildOutdated(resolveClientBuildId(), serverId);
    setBuildOutdated(outdated);
    if (outdated) {
      showIfNotDismissed();
    }
  }, [showIfNotDismissed]);

  useEffect(() => {
    if (!updateAvailable) return;
    showIfNotDismissed();
  }, [updateAvailable, showIfNotDismissed]);

  useEffect(() => {
    void checkServerBuild();
  }, [checkServerBuild]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      void registrationRef.current?.update();
      void checkServerBuild();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [checkServerBuild]);

  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  const handleDismiss = useCallback(() => {
    dismissedRef.current = true;
    setVisible(false);
  }, []);

  const handleUpdate = useCallback(async () => {
    setIsUpdating(true);
    dismissedRef.current = false;
    setNeedRefresh(false);
    setWaitingDetected(false);
    setBuildOutdated(false);

    try {
      const registration =
        registrationRef.current ??
        (await navigator.serviceWorker.getRegistration()) ??
        null;

      const controllerWait = waitForControllerChange(5000);

      await updateServiceWorker(true);
      if (registration) {
        sendSkipWaiting(registration);
      }

      const activated = await controllerWait;
      if (activated) {
        window.location.reload();
        return;
      }

      await forceServiceWorkerRefresh();
      window.location.reload();
    } catch {
      await forceServiceWorkerRefresh().catch(() => undefined);
      window.location.reload();
    }
  }, [setNeedRefresh, updateServiceWorker]);

  if (!visible) {
    return null;
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy={isUpdating}
      className="fixed bottom-[calc(1rem+env(safe-area-inset-bottom,0px))] left-1/2 z-[9999] flex w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 flex-col gap-2 rounded-lg border border-sagra-border bg-white px-4 py-3 text-sm text-slate-800 shadow-lg sm:flex-row sm:items-center sm:justify-between"
    >
      <span>
        {isUpdating
          ? "Atualizando SAGRA Web…"
          : "Nova versão do SAGRA Web disponível."}
      </span>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={isUpdating}
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary-green px-3 py-1.5 font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-70"
          onClick={() => {
            void handleUpdate();
          }}
        >
          {isUpdating ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {isUpdating ? "Atualizando…" : "Atualizar"}
        </button>
        <button
          type="button"
          disabled={isUpdating}
          className="rounded-md border border-sagra-border px-3 py-1.5 text-slate-600 hover:bg-sagra-bg disabled:cursor-not-allowed disabled:opacity-60"
          onClick={handleDismiss}
        >
          Depois
        </button>
      </div>
    </div>
  );
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
