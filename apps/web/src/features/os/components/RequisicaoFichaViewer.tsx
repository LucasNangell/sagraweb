import { Loader2, Printer, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface RequisicaoFichaViewerProps {
  src: string;
  title: string;
  /** Exibe chrome de modal A5 (148/210) com botões Imprimir/Fechar. */
  variant?: "modal" | "page";
  onClose?: () => void;
  /** Dispara impressão automaticamente após carregar (rota dedicada). */
  autoPrint?: boolean;
}

const FICHA_MODAL_HEADER_HEIGHT_PX = 57;

interface FichaPreviewSizeMessage {
  type: "sagra-ficha-preview-size";
  width: number;
  height: number;
}

function detectIframeError(doc: Document | null | undefined): string | null {
  if (!doc) {
    return null;
  }
  const h1 = doc.querySelector("h1")?.textContent?.trim() ?? "";
  const lower = h1.toLowerCase();
  if (
    lower.includes("não encontrada") ||
    lower.includes("nao encontrada") ||
    lower.includes("erro interno") ||
    lower.includes("template") ||
    lower.includes("não encontrado")
  ) {
    return h1 || "Falha ao carregar a ficha da OS.";
  }
  return null;
}

export function RequisicaoFichaViewer({
  src,
  title,
  variant = "modal",
  onClose,
  autoPrint = false,
}: RequisicaoFichaViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [previewSize, setPreviewSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [viewportSize, setViewportSize] = useState(() =>
    typeof window !== "undefined"
      ? { width: window.innerWidth, height: window.innerHeight }
      : { width: 1280, height: 800 },
  );

  useEffect(() => {
    setLoading(true);
    setError(null);
    setReady(false);
    setPreviewSize(null);
  }, [src]);

  const notifyPreviewResize = useCallback(() => {
    const maxWidth = Math.floor(viewportSize.width * 0.98);
    const maxHeight = Math.floor(
      viewportSize.height * 0.98 - FICHA_MODAL_HEADER_HEIGHT_PX,
    );
    iframeRef.current?.contentWindow?.postMessage(
      {
        type: "preview-resize",
        maxWidth,
        maxHeight,
      },
      "*",
    );
  }, [viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (variant !== "modal") {
      return;
    }
    const onResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [variant]);

  useEffect(() => {
    if (variant !== "modal") {
      return;
    }
    notifyPreviewResize();
  }, [variant, notifyPreviewResize]);

  useEffect(() => {
    if (variant !== "modal") {
      return;
    }
    const onMessage = (event: MessageEvent) => {
      const data = event.data as FichaPreviewSizeMessage | undefined;
      if (data?.type !== "sagra-ficha-preview-size") {
        return;
      }
      const width = Number(data.width);
      const height = Number(data.height);
      if (
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        width <= 0 ||
        height <= 0
      ) {
        return;
      }
      setPreviewSize((prev) => {
        if (
          prev &&
          Math.abs(prev.width - width) < 2 &&
          Math.abs(prev.height - height) < 2
        ) {
          return prev;
        }
        return { width, height };
      });
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [variant]);

  useEffect(() => {
    if (variant !== "modal") {
      return;
    }
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [variant]);

  const handleIframeLoad = useCallback(() => {
    setLoading(false);
    try {
      const doc = iframeRef.current?.contentDocument;
      const loadError = detectIframeError(doc);
      if (loadError) {
        setError(loadError);
        setReady(false);
        return;
      }
      setError(null);
      setReady(true);
      try {
        notifyPreviewResize();
      } catch {
        // iframe cross-origin ou indisponível
      }
      if (autoPrint) {
        window.setTimeout(() => {
          triggerPrint(iframeRef.current);
        }, 300);
      }
    } catch {
      setError(null);
      setReady(true);
    }
  }, [autoPrint, notifyPreviewResize]);

  const handleIframeError = useCallback(() => {
    setLoading(false);
    setReady(false);
    setError("Não foi possível carregar a ficha. Verifique a conexão e tente novamente.");
  }, []);

  const handlePrint = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) {
      window.alert("Aguarde o carregamento completo da ficha antes de imprimir.");
      return;
    }
    triggerPrint(iframe);
    if (variant === "modal" && onClose) {
      window.setTimeout(onClose, 400);
    }
  }, [onClose, variant]);

  const header = (
    <div className="flex shrink-0 items-center justify-between border-b border-neutral-200 px-4 py-3">
      <h3 className="text-base font-semibold text-secondary-blue">{title}</h3>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handlePrint}
          disabled={!ready || Boolean(error)}
          className="inline-flex items-center gap-1.5 rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Printer className="size-4" />
          Imprimir
        </button>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex items-center gap-1.5 rounded bg-neutral-500 px-4 py-2 text-sm font-semibold text-white hover:bg-neutral-600"
          >
            {variant === "modal" ? (
              "Fechar"
            ) : (
              <>
                <X className="size-4" />
                Fechar
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );

  const previewSurfaceClass =
    variant === "modal"
      ? "absolute inset-0 bg-white"
      : "relative min-h-0 flex-1 bg-neutral-100";

  const body = (
    <div className={previewSurfaceClass}>
      {loading ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 text-neutral-600">
          <Loader2 className="size-8 animate-spin text-secondary-blue" />
          <span className="text-sm">Gerando requisição…</span>
        </div>
      ) : null}
      {error ? (
        <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm font-semibold text-sagra-danger">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              setError(null);
              setReady(false);
              if (iframeRef.current) {
                iframeRef.current.src = src;
              }
            }}
            className="rounded bg-secondary-blue px-4 py-2 text-sm font-semibold text-white"
          >
            Tentar novamente
          </button>
        </div>
      ) : null}
      <iframe
        ref={iframeRef}
        title={title}
        src={src}
        onLoad={handleIframeLoad}
        onError={handleIframeError}
        className="size-full border-0 bg-white"
      />
    </div>
  );

  if (variant === "page") {
    return (
      <div className="flex min-h-screen flex-col bg-neutral-200">
        {header}
        <div className="flex min-h-0 flex-1 flex-col">{body}</div>
      </div>
    );
  }

  const viewportMaxW = Math.floor(viewportSize.width * 0.98);
  const viewportMaxH = Math.floor(
    viewportSize.height * 0.98 - FICHA_MODAL_HEADER_HEIGHT_PX,
  );
  const panelWidth = previewSize?.width ?? viewportMaxW;
  const bodyHeight = previewSize?.height ?? viewportMaxH;

  return (
    <div
      className="fixed inset-0 z-[10004] flex items-center justify-center bg-black/70"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="flex flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        style={{ width: panelWidth }}
      >
        {header}
        <div
          className="relative overflow-hidden"
          style={{ width: panelWidth, height: bodyHeight }}
        >
          {body}
        </div>
      </div>
    </div>
  );
}

function triggerPrint(iframe: HTMLIFrameElement | null): void {
  if (!iframe?.contentWindow) {
    return;
  }
  try {
    iframe.contentWindow.postMessage("print", "*");
  } catch (e) {
    window.alert(
      `Erro ao iniciar impressão: ${e instanceof Error ? e.message : "falha desconhecida"}`,
    );
  }
}
