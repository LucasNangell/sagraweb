/** Utilitários de seleção para o editor visual de e-mail (contenteditable). */

let savedRange: Range | null = null;

export function saveEditorSelection(): void {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (range.collapsed && !range.startContainer.textContent?.trim()) return;
  savedRange = range.cloneRange();
}

export function restoreEditorSelection(editor: HTMLElement | null): boolean {
  if (!savedRange || !editor) return false;
  const sel = window.getSelection();
  if (!sel) return false;
  if (!editor.contains(savedRange.startContainer)) return false;
  sel.removeAllRanges();
  sel.addRange(savedRange);
  return true;
}

export function focusEditor(editor: HTMLElement | null): void {
  if (!editor) return;
  editor.focus();
  restoreEditorSelection(editor);
}

export function execEditorCommand(
  editor: HTMLElement | null,
  command: string,
  value?: string,
): boolean {
  focusEditor(editor);
  try {
    return document.execCommand(command, false, value);
  } catch {
    return false;
  }
}

export function applyInlineStyleToSelection(
  editor: HTMLElement | null,
  styles: Record<string, string>,
): boolean {
  focusEditor(editor);
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;

  const range = sel.getRangeAt(0);
  const span = document.createElement("span");
  for (const [key, val] of Object.entries(styles)) {
    span.style.setProperty(key, val);
  }

  try {
    range.surroundContents(span);
    sel.removeAllRanges();
    const after = document.createRange();
    after.selectNodeContents(span);
    after.collapse(false);
    sel.addRange(after);
    savedRange = after.cloneRange();
    return true;
  } catch {
    const text = range.toString();
    if (!text) return false;
    const styleAttr = Object.entries(styles)
      .map(([k, v]) => `${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v}`)
      .join(";");
    document.execCommand(
      "insertHTML",
      false,
      `<span style="${styleAttr}">${escapeHtml(text)}</span>`,
    );
    return true;
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function insertHtmlAtSelection(editor: HTMLElement | null, html: string): boolean {
  focusEditor(editor);
  return document.execCommand("insertHTML", false, html);
}

export function getSelectedImage(editor: HTMLElement | null): HTMLImageElement | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  let node: Node | null = sel.anchorNode;
  if (node?.nodeType === Node.TEXT_NODE) node = node.parentElement;
  if (!(node instanceof HTMLElement)) return null;

  const layer = node.closest(".email-editor-img-layer");
  if (layer && editor?.contains(layer)) {
    const layerImg = layer.querySelector("img");
    if (layerImg instanceof HTMLImageElement) return layerImg;
  }

  if (node.classList.contains("email-editor-img-layer") && editor?.contains(node)) {
    const layerImg = node.querySelector("img");
    if (layerImg instanceof HTMLImageElement) return layerImg;
  }

  const img = node.closest("img");
  if (!img || !editor?.contains(img)) return null;
  return img;
}
