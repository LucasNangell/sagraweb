import { useState } from "react";

type RegisterOptions = {
  immediate?: boolean;
  onRegisteredSW?: (
    swScriptUrl: string,
    registration: ServiceWorkerRegistration | undefined,
  ) => void;
};

/**
 * Stub do virtual:pwa-register/react para Vitest (sem VitePWA).
 * Testes podem sobrescrever via vi.mock.
 */
export function useRegisterSW(_options?: RegisterOptions) {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [offlineReady, setOfflineReady] = useState(false);
  return {
    needRefresh: [needRefresh, setNeedRefresh] as [
      boolean,
      typeof setNeedRefresh,
    ],
    offlineReady: [offlineReady, setOfflineReady] as [
      boolean,
      typeof setOfflineReady,
    ],
    updateServiceWorker: async (_reloadPage?: boolean) => undefined,
  };
}
