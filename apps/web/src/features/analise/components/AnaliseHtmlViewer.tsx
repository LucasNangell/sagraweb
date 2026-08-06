import { cn } from "@sagra/ui";
import { useEffect, useRef, useState } from "react";

import { buildAnaliseSrcDoc } from "../utils";

interface AnaliseHtmlViewerProps {
  html: string;
  className?: string;
  emptyLabel?: string;
  itemTitulo?: string;
}

/**
 * Pré-visualização somente leitura via iframe (documento HTML real).
 * Garante estilos Word/Outlook no portal do cliente — Shadow DOM quebrava o CSS.
 */
export function AnaliseHtmlViewer({
  html,
  className,
  emptyLabel = "(Sem conteúdo HTML)",
  itemTitulo,
}: AnaliseHtmlViewerProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  const srcDoc = html.trim() ? buildAnaliseSrcDoc(html, itemTitulo) : "";

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || !srcDoc) {
      setHeight(80);
      return;
    }

    const resize = () => {
      try {
        const doc = iframe.contentDocument;
        if (!doc?.body) return;
        const h = Math.max(doc.body.scrollHeight, doc.documentElement?.scrollHeight ?? 0);
        setHeight(Math.min(Math.max(h + 16, 80), 2400));
      } catch {
        /* sandbox / cross-origin */
      }
    };

    iframe.addEventListener("load", resize);
    resize();
    return () => iframe.removeEventListener("load", resize);
  }, [srcDoc]);

  if (!srcDoc) {
    return (
      <div
        className={cn(
          "analise-html-host flex min-h-[5rem] items-center justify-center text-sm text-slate-500",
          className,
        )}
      >
        {emptyLabel}
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title="Pré-visualização do problema técnico"
      className={cn("analise-html-host w-full border-0 bg-white", className)}
      style={{ height: `${height}px`, minHeight: "5rem" }}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
    />
  );
}
