import { prepareAnaliseShadowContent } from "@/features/analise/utils";

const KEEP_TAGS = new Set([
  "P",
  "BR",
  "UL",
  "OL",
  "LI",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "A",
  "H1",
  "H2",
  "H3",
  "H4",
  "TABLE",
  "THEAD",
  "TBODY",
  "TR",
  "TH",
  "TD",
  "IMG",
  "SPAN",
  "DIV",
]);

const STRIP_ATTRS = new Set([
  "style",
  "class",
  "className",
  "width",
  "height",
  "bgcolor",
  "align",
  "color",
  "face",
  "size",
  "valign",
  "border",
  "cellpadding",
  "cellspacing",
]);

const TITLE_BLOCK_TAGS = new Set([
  "H1",
  "H2",
  "H3",
  "H4",
  "P",
  "STRONG",
  "B",
]);

function unwrapElement(el: Element): void {
  const parent = el.parentNode;
  if (!parent) {
    el.remove();
    return;
  }
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

function normalizeLabelText(value: string): string {
  return value
    .replace(/<[^>]+>/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Remove o primeiro bloco cujo texto é igual ao título (já exibido no cabeçalho). */
export function stripLeadingTitleBlock(
  root: HTMLElement,
  itemTitulo?: string,
): void {
  const title = normalizeLabelText(itemTitulo || "");
  if (!title) return;
  for (const child of [...root.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      if (!child.textContent?.trim()) continue;
      if (normalizeLabelText(child.textContent || "") === title) {
        root.removeChild(child);
      }
      return;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const el = child as HTMLElement;
    if (!TITLE_BLOCK_TAGS.has(el.tagName.toUpperCase())) return;
    if (normalizeLabelText(el.textContent || "") === title) {
      root.removeChild(el);
    }
    return;
  }
}

/** Remove barras/listas de providências do HTML (exibidas via UI estruturada). */
export function stripProvidenciasBlocks(root: HTMLElement): void {
  for (const el of [...root.querySelectorAll(".providencias-bar, .action-list")]) {
    el.remove();
  }
  for (const el of [...root.querySelectorAll("*")]) {
    const text = normalizeLabelText(el.textContent || "");
    if (text === "providencias" || text.startsWith("providencias ")) {
      const next = el.nextElementSibling;
      if (next && (next.classList.contains("action-list") || next.tagName === "UL" || next.tagName === "OL")) {
        next.remove();
      }
      el.remove();
    }
  }
}

/** HTML limpo para o balão: sem estilos do banco, com estrutura preservada. */
export function toBalloonHtml(
  html: string,
  itemTitulo?: string,
  opts?: { stripProvidencias?: boolean },
): string {
  const { bodyHtml } = prepareAnaliseShadowContent(html || "", itemTitulo);
  if (!bodyHtml.trim()) return "";
  if (typeof DOMParser === "undefined") {
    return bodyHtml
      .replace(/<\/?(style|script|link|meta|base)\b[^>]*>/gi, "")
      .replace(/\s(style|class|width|height|bgcolor|align)=("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  const doc = new DOMParser().parseFromString(
    `<div id="root">${bodyHtml}</div>`,
    "text/html",
  );
  const root = doc.getElementById("root");
  if (!root) return "";

  if (opts?.stripProvidencias) {
    stripProvidenciasBlocks(root);
  }

  const walk = (node: Node) => {
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    const tag = el.tagName.toUpperCase();

    if (tag === "FONT" || tag === "O:P" || tag.startsWith("O:")) {
      const kids = [...el.childNodes];
      unwrapElement(el);
      for (const child of kids) walk(child);
      return;
    }

    if (!KEEP_TAGS.has(tag)) {
      const kids = [...el.childNodes];
      unwrapElement(el);
      for (const child of kids) walk(child);
      return;
    }

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (STRIP_ATTRS.has(name) || name.startsWith("on") || name.startsWith("data-")) {
        el.removeAttribute(attr.name);
      }
    }
    if (tag === "A") {
      const href = el.getAttribute("href");
      if (!href || href.trim().toLowerCase().startsWith("javascript:")) {
        el.removeAttribute("href");
      } else {
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
    }
    if (tag === "IMG") {
      const src = el.getAttribute("src");
      if (!src) el.remove();
    }

    for (const child of [...el.childNodes]) {
      walk(child);
    }
  };

  for (const child of [...root.childNodes]) {
    walk(child);
  }

  stripLeadingTitleBlock(root, itemTitulo);

  return root.innerHTML.trim();
}
