import { useEffect } from "react";

export function usePainelWakeLock(): void {
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let fallbackFrame: number | null = null;
    let keepAliveInterval: number | null = null;

    const releaseWakeLock = async () => {
      if (wakeLock) {
        try {
          await wakeLock.release();
        } catch {
          /* ignore */
        }
        wakeLock = null;
      }
    };

    const requestWakeLock = async () => {
      if (!("wakeLock" in navigator)) {
        return;
      }
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } catch (err) {
        console.error(
          "[Wake Lock] Erro ao ativar:",
          err instanceof Error ? err.message : err,
        );
        wakeLock = null;
      }
    };

    const startFallback = () => {
      if ("wakeLock" in navigator) {
        return;
      }
      let lastTime = Date.now();
      const keepActive = () => {
        const now = Date.now();
        if (now - lastTime > 30_000) {
          document.title = document.title;
          lastTime = now;
        }
        fallbackFrame = requestAnimationFrame(keepActive);
      };
      fallbackFrame = requestAnimationFrame(keepActive);
    };

    const stopFallback = () => {
      if (fallbackFrame != null) {
        cancelAnimationFrame(fallbackFrame);
        fallbackFrame = null;
      }
    };

    const startKeepAlive = () => {
      const tick = () => {
        try {
          document.title = document.title;
        } catch {
          /* ignore */
        }
      };
      tick();
      keepAliveInterval = window.setInterval(tick, 60_000);
    };

    const stopKeepAlive = () => {
      if (keepAliveInterval != null) {
        window.clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    };

    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible") {
        await requestWakeLock();
      } else {
        await releaseWakeLock();
      }
    };

    void requestWakeLock().then(() => {
      if (!("wakeLock" in navigator)) {
        startFallback();
      }
    });
    startKeepAlive();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    const onFocus = () => {
      void requestWakeLock();
    };
    window.addEventListener("focus", onFocus);

    return () => {
      void releaseWakeLock();
      stopFallback();
      stopKeepAlive();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
}
