import { cn } from "@sagra/ui";

import { useEffect, useRef } from "react";



import {
  mergeAnaliseEditableBody,
  prepareAnaliseShadowDisplay,
  stripRedundantPtItemLabels,
} from "../utils";



const SHADOW_ANALISE_EDITOR_CSS = `

  :host {

    display: block;

    font-family: "Inter", system-ui, sans-serif;

    font-size: 14px;

    line-height: 1.5;

    color: #333;

  }

  .analise-editable.analise-root {

    min-height: 5rem;

    padding: 0.5rem;

    outline: none;

    word-break: break-word;

    overflow-wrap: anywhere;

  }

  .analise-editable.analise-root img {

    max-width: 100%;

    height: auto;

    display: block;

  }

  .analise-editable:focus {

    outline: none;

  }

`;



interface AnaliseHtmlEditorProps {

  html: string;

  onChange: (html: string) => void;

  className?: string;

  readOnly?: boolean;

  /** Título do item na biblioteca — remove rótulos duplicados (ex.: Manual Técnico). */
  itemTitulo?: string;

}

/** Monta o DOM do editor sem perder <img> (innerHTML em contentEditable costuma apagar imagens). */
function setEditableBodyHtml(editable: HTMLElement, html: string): void {
  editable.replaceChildren();
  if (!html) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = html;
  editable.append(...tpl.content.childNodes);
  editable.querySelectorAll("img").forEach((img) => {
    img.contentEditable = "false";
  });
}



/**

 * Editor contentEditable isolado em Shadow DOM para não afetar estilos do app.

 */

export function AnaliseHtmlEditor({
  html,
  onChange,
  className,
  readOnly = false,
  itemTitulo,
}: AnaliseHtmlEditorProps) {

  const hostRef = useRef<HTMLDivElement>(null);

  const onChangeRef = useRef(onChange);

  const htmlRef = useRef(html);

  /** Último HTML emitido pelo editor (digitação); difere do prop quando há atualização externa. */

  const lastEmittedHtmlRef = useRef(html);

  /** Evita que innerHTML programático dispare input e apague <img> do snapshot. */
  const suppressInputRef = useRef(false);

  onChangeRef.current = onChange;

  htmlRef.current = html;



  useEffect(() => {

    const host = hostRef.current;

    if (!host) return;



    let root = host.shadowRoot;

    if (!root) {

      root = host.attachShadow({ mode: "open" });

      root.innerHTML = `<style>${SHADOW_ANALISE_EDITOR_CSS}</style><div class="analise-editable analise-root" contenteditable="${readOnly ? "false" : "true"}"></div>`;

      const editable = root.querySelector(".analise-editable") as HTMLDivElement;

      editable.addEventListener("input", () => {
        if (suppressInputRef.current) return;
        const merged = mergeAnaliseEditableBody(htmlRef.current, editable.innerHTML);
        lastEmittedHtmlRef.current = merged;
        onChangeRef.current(merged);
      });

    }



    const editable = root.querySelector(".analise-editable") as HTMLDivElement;

    if (!editable) return;



    const { embeddedStyles, bodyHtml } = prepareAnaliseShadowDisplay(html, itemTitulo);
    editable.setAttribute("contenteditable", readOnly ? "false" : "true");




    const docStyleEl = root.querySelector("style[data-analise-doc]") as HTMLStyleElement | null;

    if (embeddedStyles) {

      if (docStyleEl) {

        docStyleEl.textContent = embeddedStyles;

      } else {

        const styleEl = document.createElement("style");

        styleEl.setAttribute("data-analise-doc", "1");

        styleEl.textContent = embeddedStyles;

        root.insertBefore(styleEl, editable);

      }

    } else if (docStyleEl) {

      docStyleEl.remove();

    }



    const isExternalUpdate = html !== lastEmittedHtmlRef.current;

    const isEditing = document.activeElement === editable;



    if (isExternalUpdate || (!isEditing && editable.innerHTML !== bodyHtml)) {
      const cleanedSource = stripRedundantPtItemLabels(html, itemTitulo);
      lastEmittedHtmlRef.current = cleanedSource;
      htmlRef.current = cleanedSource;
      suppressInputRef.current = true;
      setEditableBodyHtml(editable, bodyHtml);
      if (!readOnly && cleanedSource !== html) {
        onChangeRef.current(cleanedSource);
      }
      queueMicrotask(() => {
        suppressInputRef.current = false;
      });
    }

  }, [html, readOnly, itemTitulo]);



  return (

    <div

      ref={hostRef}

      className={cn(

        "analise-html-host rounded border border-slate-300 bg-white focus-within:border-secondary-blue focus-within:ring-2 focus-within:ring-secondary-blue/15",

        className,

      )}

      aria-label="Conteúdo editável do problema técnico"

    />

  );

}


