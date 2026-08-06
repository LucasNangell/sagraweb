/** Utilitários de posicionamento livre de imagens no editor visual de e-mail. */

export const EMAIL_EDITOR_IMG_LAYER_CLASS = "email-editor-img-layer";
export const EMAIL_EDITOR_IMG_LAYER_BEHIND_CLASS = "is-behind";
export const EMAIL_EDITOR_IMG_LAYER_OVER_CLASS = "is-over";

export type EmailImageLayerMode = "flow" | "behind" | "over";

export function ensureEditorPositioningContext(editor: HTMLElement): void {
  if (!editor.style.position) {
    editor.style.position = "relative";
  }
}

export function getImageLayerWrap(img: HTMLImageElement): HTMLElement | null {
  const parent = img.parentElement;
  if (parent?.classList.contains(EMAIL_EDITOR_IMG_LAYER_CLASS)) return parent;
  return null;
}

export function isFloatedImage(img: HTMLImageElement): boolean {
  return getImageLayerWrap(img) != null;
}

export function wrapImageInLayer(img: HTMLImageElement, editor: HTMLElement): HTMLElement {
  const existing = getImageLayerWrap(img);
  if (existing) return existing;

  ensureEditorPositioningContext(editor);

  const rect = img.getBoundingClientRect();
  const editorRect = editor.getBoundingClientRect();
  const left = rect.left - editorRect.left + editor.scrollLeft;
  const top = rect.top - editorRect.top + editor.scrollTop;

  const layer = document.createElement("span");
  layer.className = `${EMAIL_EDITOR_IMG_LAYER_CLASS} ${EMAIL_EDITOR_IMG_LAYER_OVER_CLASS}`;
  layer.contentEditable = "false";
  layer.style.left = `${Math.max(0, Math.round(left))}px`;
  layer.style.top = `${Math.max(0, Math.round(top))}px`;
  layer.dataset.emailImgLayer = "over";

  img.draggable = false;
  if (!img.style.display) img.style.display = "block";
  if (!img.style.maxWidth) img.style.maxWidth = "100%";

  const parent = img.parentNode;
  if (parent) {
    parent.insertBefore(layer, img);
    layer.appendChild(img);
  }

  return layer;
}

export function unwrapImageFromLayer(img: HTMLImageElement): void {
  const layer = getImageLayerWrap(img);
  if (!layer?.parentNode) return;

  layer.parentNode.insertBefore(img, layer);
  layer.remove();

  img.style.position = "";
  img.style.left = "";
  img.style.top = "";
  img.style.zIndex = "";
  img.removeAttribute("data-email-img-layer");
}

export function getImageLayerMode(img: HTMLImageElement): EmailImageLayerMode {
  const layer = getImageLayerWrap(img);
  if (!layer) return "flow";
  if (layer.classList.contains(EMAIL_EDITOR_IMG_LAYER_BEHIND_CLASS)) return "behind";
  return "over";
}

export function setImageLayerMode(img: HTMLImageElement, editor: HTMLElement, mode: EmailImageLayerMode): void {
  if (mode === "flow") {
    unwrapImageFromLayer(img);
    return;
  }

  const layer = wrapImageInLayer(img, editor);
  layer.classList.remove(EMAIL_EDITOR_IMG_LAYER_BEHIND_CLASS, EMAIL_EDITOR_IMG_LAYER_OVER_CLASS);
  layer.dataset.emailImgLayer = mode;

  if (mode === "behind") {
    layer.classList.add(EMAIL_EDITOR_IMG_LAYER_BEHIND_CLASS);
    layer.style.zIndex = "0";
  } else {
    layer.classList.add(EMAIL_EDITOR_IMG_LAYER_OVER_CLASS);
    layer.style.zIndex = "10";
  }
}

export function positionImageLayer(
  layer: HTMLElement,
  editor: HTMLElement,
  left: number,
  top: number,
): void {
  ensureEditorPositioningContext(editor);
  const maxLeft = Math.max(0, editor.clientWidth - 40);
  const maxTop = Math.max(0, editor.scrollHeight - 20);
  layer.style.left = `${Math.min(maxLeft, Math.max(0, Math.round(left)))}px`;
  layer.style.top = `${Math.min(maxTop, Math.max(0, Math.round(top)))}px`;
}

export function createFloatedImageAt(
  editor: HTMLElement,
  src: string,
  clientX: number,
  clientY: number,
  mode: EmailImageLayerMode = "over",
): HTMLImageElement {
  ensureEditorPositioningContext(editor);

  const editorRect = editor.getBoundingClientRect();
  const left = clientX - editorRect.left + editor.scrollLeft;
  const top = clientY - editorRect.top + editor.scrollTop;

  const img = document.createElement("img");
  img.src = src;
  img.alt = "";
  img.draggable = false;
  img.style.display = "block";
  img.style.maxWidth = "100%";

  const layer = document.createElement("span");
  layer.className = EMAIL_EDITOR_IMG_LAYER_CLASS;
  layer.contentEditable = "false";
  layer.appendChild(img);
  editor.appendChild(layer);

  positionImageLayer(layer, editor, left, top);
  setImageLayerMode(img, editor, mode);

  return img;
}

export function enhanceImagesForEditing(editor: HTMLElement): void {
  ensureEditorPositioningContext(editor);

  editor.querySelectorAll("img").forEach((node) => {
    const img = node as HTMLImageElement;
    img.draggable = false;
    if (!img.style.maxWidth) img.style.maxWidth = "100%";
    if (!img.getAttribute("alt")) img.setAttribute("alt", "");

    const layer = getImageLayerWrap(img);
    if (layer) {
      layer.contentEditable = "false";
      const mode = layer.dataset.emailImgLayer === "behind" ? "behind" : "over";
      setImageLayerMode(img, editor, mode);
    }
  });
}

export function resolveDragTarget(target: EventTarget | null): HTMLImageElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const layer = target.closest(`.${EMAIL_EDITOR_IMG_LAYER_CLASS}`);
  if (layer) {
    const img = layer.querySelector("img");
    return img instanceof HTMLImageElement ? img : null;
  }
  if (target instanceof HTMLImageElement) return target;
  const img = target.closest("img");
  return img instanceof HTMLImageElement ? img : null;
}
