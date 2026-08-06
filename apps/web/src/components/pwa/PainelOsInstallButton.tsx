import { Download } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandaloneDisplay(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia("(display-mode: standalone)").matches) return true;
  const nav = window.navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true;
}

function isIosDevice(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

/**
 * CTA de instalação do PWA Painel OS (beforeinstallprompt no Chromium;
 * tip curto no iOS).
 */
export function PainelOsInstallButton() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(
    null,
  );
  const [standalone, setStandalone] = useState(false);
  const [iosTipVisible, setIosTipVisible] = useState(false);

  useEffect(() => {
    setStandalone(isStandaloneDisplay());

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    return () =>
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferred) return;
    await deferred.prompt();
    await deferred.userChoice;
    setDeferred(null);
  }, [deferred]);

  if (standalone) return null;

  if (deferred) {
    return (
      <button
        type="button"
        className="dashboard-setor-settings-btn tablet-install-btn"
        onClick={() => void handleInstall()}
        aria-label="Instalar app Painel OS"
        title="Instalar app"
      >
        <Download className="size-5" />
        <span className="tablet-install-btn-label">Instalar</span>
      </button>
    );
  }

  if (isIosDevice()) {
    return (
      <div className="tablet-install-ios">
        <button
          type="button"
          className="dashboard-setor-settings-btn tablet-install-btn"
          onClick={() => setIosTipVisible((v) => !v)}
          aria-label="Como instalar o Painel OS"
          title="Como instalar"
        >
          <Download className="size-5" />
        </button>
        {iosTipVisible ? (
          <p className="tablet-install-ios-tip" role="status">
            Compartilhar → Adicionar à Tela de Início
          </p>
        ) : null}
      </div>
    );
  }

  return null;
}
