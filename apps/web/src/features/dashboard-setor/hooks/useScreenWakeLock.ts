import { useEffect } from "react";

export function useScreenWakeLock(): void {
  useEffect(() => {
    let wakeLock: WakeLockSentinel | null = null;
    let fallbackFrameId: number | null = null;
    let keepAliveInterval: ReturnType<typeof setInterval> | null = null;
    const wakeLockSupported = "wakeLock" in navigator;

    const releaseWakeLock = async () => {
      if (!wakeLock) {
        return;
      }
      try {
        await wakeLock.release();
      } catch {
        /* ignore */
      }
      wakeLock = null;
    };

    const requestWakeLock = async () => {
      if (!wakeLockSupported) {
        return;
      }
      try {
        wakeLock = await navigator.wakeLock.request("screen");
        wakeLock.addEventListener("release", () => {
          wakeLock = null;
        });
      } catch (err) {
        console.warn("[Wake Lock] Erro ao ativar:", err);
        wakeLock = null;
      }
    };

    const startFallback = () => {
      if (wakeLockSupported) {
        return;
      }
      let lastTime = Date.now();
      const keepActive = () => {
        const now = Date.now();
        if (now - lastTime > 30000) {
          document.title = document.title;
          lastTime = now;
        }
        fallbackFrameId = requestAnimationFrame(keepActive);
      };
      fallbackFrameId = requestAnimationFrame(keepActive);
    };

    const stopFallback = () => {
      if (fallbackFrameId != null) {
        cancelAnimationFrame(fallbackFrameId);
        fallbackFrameId = null;
      }
    };

    const startKeepAlive = () => {
      const tick = () => {
        try {
          document.title = document.title;
        } catch (err) {
          console.warn("[Keep-Alive] Tick falhou:", err);
        }
      };
      tick();
      keepAliveInterval = setInterval(tick, 60000);
    };

    const stopKeepAlive = () => {
      if (keepAliveInterval != null) {
        clearInterval(keepAliveInterval);
        keepAliveInterval = null;
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void requestWakeLock();
      } else {
        void releaseWakeLock();
      }
    };

    const handleFocus = () => {
      void requestWakeLock();
    };

    void requestWakeLock().then(() => {
      if (!wakeLockSupported) {
        startFallback();
      }
    });
    startKeepAlive();

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleFocus);

    return () => {
      void releaseWakeLock();
      stopFallback();
      stopKeepAlive();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleFocus);
    };
  }, []);
}
