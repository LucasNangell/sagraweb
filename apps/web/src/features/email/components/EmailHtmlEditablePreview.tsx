import { cn } from "@sagra/ui";
import { useEffect, useRef } from "react";

import {
  joinEmailHtmlDocument,
  sanitizeEmailHtml,
  splitEmailHtmlDocument,
} from "../utils";

interface EmailHtmlEditablePreviewProps {
  html: string;
  onHtmlChange: (html: string) => void;
  onFocusChange?: (focused: boolean) => void;
  className?: string;
}

/**
 * Prévia editável do corpo do e-mail. Alterações no texto refletem no HTML completo.
 */
export function EmailHtmlEditablePreview({
  html,
  onHtmlChange,
  onFocusChange,
  className,
}: EmailHtmlEditablePreviewProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef(splitEmailHtmlDocument(html));
  const lastEmittedHtml = useRef<string | null>(null);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (isFocusedRef.current) return;
    if (html === lastEmittedHtml.current) return;

    lastEmittedHtml.current = html;
    partsRef.current = splitEmailHtmlDocument(html);
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = sanitizeEmailHtml(partsRef.current.bodyHtml);
  }, [html]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    const newBody = sanitizeEmailHtml(el.innerHTML);
    const full = joinEmailHtmlDocument(partsRef.current, newBody);
    partsRef.current = { ...partsRef.current, bodyHtml: newBody };
    lastEmittedHtml.current = full;
    onHtmlChange(full);
  };

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline
      aria-label="Editar conteúdo do e-mail na prévia"
      className={cn(
        "email-editable-preview min-h-[12rem] max-w-full cursor-text rounded border border-slate-200 bg-white p-2 text-sm leading-relaxed text-slate-800 outline-none",
        "focus:border-secondary-blue/40 focus:ring-2 focus:ring-secondary-blue/15",
        "[&_a]:text-blue-600 [&_a]:underline [&_img]:max-w-full [&_p]:my-1 [&_table]:max-w-full",
        className,
      )}
      onInput={emitChange}
      onBlur={() => {
        isFocusedRef.current = false;
        onFocusChange?.(false);
        emitChange();
      }}
      onFocus={() => {
        isFocusedRef.current = true;
        onFocusChange?.(true);
      }}
    />
  );
}
