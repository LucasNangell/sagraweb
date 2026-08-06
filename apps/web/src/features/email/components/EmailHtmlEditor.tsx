import { cn } from "@sagra/ui";
import { useEffect, useRef, useState } from "react";

import { buildEmailEditSrcDoc, serializeEmailDocument } from "../utils";

interface EmailHtmlEditorProps {
  html: string;
  onChange: (html: string) => void;
  className?: string;
}

/**
 * Pré-visualização editável do e-mail em iframe isolado (preserva layout/tabelas do modelo).
 */
export function EmailHtmlEditor({ html, onChange, className }: EmailHtmlEditorProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const htmlRef = useRef(html);
  const lastEmittedRef = useRef(html);
  const onChangeRef = useRef(onChange);
  const suppressInputRef = useRef(false);
  const [height, setHeight] = useState(320);

  onChangeRef.current = onChange;
  htmlRef.current = html;

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const attachEditor = () => {
      const doc = iframe.contentDocument;
      if (!doc?.body) return;

      doc.body.contentEditable = "true";
      doc.querySelectorAll("img").forEach((img) => {
        img.contentEditable = "false";
      });

      const resize = () => {
        try {
          const h = Math.max(
            doc.body.scrollHeight,
            doc.documentElement?.scrollHeight ?? 0,
          );
          setHeight(Math.min(Math.max(h + 24, 200), 3200));
        } catch {
          /* ignore */
        }
      };

      const onInput = () => {
        if (suppressInputRef.current) return;
        const serialized = serializeEmailDocument(doc);
        lastEmittedRef.current = serialized;
        onChangeRef.current(serialized);
        resize();
      };

      doc.body.addEventListener("input", onInput);
      resize();

      return () => {
        doc.body.removeEventListener("input", onInput);
      };
    };

    let cleanup: (() => void) | undefined;
    const onLoad = () => {
      cleanup?.();
      cleanup = attachEditor();
    };

    iframe.addEventListener("load", onLoad);
    if (iframe.contentDocument?.readyState === "complete") {
      onLoad();
    }

    return () => {
      iframe.removeEventListener("load", onLoad);
      cleanup?.();
    };
  }, []);

  useEffect(() => {
    if (html === lastEmittedRef.current) return;

    const iframe = iframeRef.current;
    const doc = iframe?.contentDocument;
    if (!doc) return;

    suppressInputRef.current = true;
    doc.open();
    doc.write(buildEmailEditSrcDoc(html));
    doc.close();
    suppressInputRef.current = false;
    lastEmittedRef.current = html;

    const resize = () => {
      try {
        const h = Math.max(
          doc.body?.scrollHeight ?? 0,
          doc.documentElement?.scrollHeight ?? 0,
        );
        setHeight(Math.min(Math.max(h + 24, 200), 3200));
      } catch {
        /* ignore */
      }
    };
    requestAnimationFrame(resize);
  }, [html]);

  if (!html.trim()) {
    return (
      <div
        className={cn(
          "flex min-h-[8rem] items-center justify-center text-sm text-slate-500",
          className,
        )}
      >
        (Sem conteúdo)
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      title="Pré-visualização editável do e-mail"
      className={cn("w-full border-0 bg-white", className)}
      style={{ height: `${height}px`, minHeight: "12rem" }}
      sandbox="allow-same-origin"
      srcDoc={buildEmailEditSrcDoc(html)}
    />
  );
}
