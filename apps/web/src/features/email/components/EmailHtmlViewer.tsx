import { cn } from "@sagra/ui";
import { useEffect, useRef } from "react";

import { sanitizeEmailHtml } from "../utils";

const SHADOW_EMAIL_CSS = `
  :host {
    display: block;
    font-family: "Inter", system-ui, sans-serif;
    font-size: 14px;
    line-height: 1.55;
    color: #333;
    word-break: break-word;
    overflow-wrap: anywhere;
    max-width: 100%;
    overflow-x: auto;
  }
  .email-root {
    max-width: 100%;
    overflow-x: auto;
  }
  .email-root img {
    max-width: 100%;
    height: auto;
    display: block;
  }
  .email-root.email-no-images img {
    display: none !important;
  }
  .email-root table {
    max-width: 100%;
    table-layout: auto;
  }
  .email-root td,
  .email-root th {
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .email-root pre {
    white-space: pre-wrap;
    max-width: 100%;
    overflow-x: auto;
  }
  .email-root p {
    margin: 0.35em 0;
  }
  .email-root a {
    color: #2563eb;
    text-decoration: underline;
  }
  .email-root a:visited {
    color: #2563eb;
  }
`;

interface EmailHtmlViewerProps {
  html: string;
  className?: string;
  /** Oculta imagens inline (caixa de entrada — visualização texto-only). */
  hideImages?: boolean;
}

/**
 * Renderiza HTML de e-mail isolado em Shadow DOM para não afetar links/estilos do app.
 */
export function EmailHtmlViewer({ html, className, hideImages = false }: EmailHtmlViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    let root = host.shadowRoot;
    if (!root) {
      root = host.attachShadow({ mode: "open" });
    }

    const safe = sanitizeEmailHtml(html);
    const rootClass = hideImages ? "email-root email-no-images" : "email-root";
    root.innerHTML = `<style>${SHADOW_EMAIL_CSS}</style><div class="${rootClass}">${safe}</div>`;
  }, [html, hideImages]);

  return (
    <div
      ref={hostRef}
      className={cn("email-html-host min-h-[2rem] max-w-full overflow-x-auto", className)}
      aria-label="Conteúdo do e-mail"
    />
  );
}
