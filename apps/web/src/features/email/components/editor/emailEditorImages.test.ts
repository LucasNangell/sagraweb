import { describe, expect, it } from "vitest";

import {
  EMAIL_EDITOR_IMG_LAYER_BEHIND_CLASS,
  EMAIL_EDITOR_IMG_LAYER_CLASS,
  EMAIL_EDITOR_IMG_LAYER_OVER_CLASS,
  getImageLayerMode,
  setImageLayerMode,
  wrapImageInLayer,
} from "./emailEditorImages";

describe("emailEditorImages", () => {
  it("envolve imagem em camada posicionada ao arrastar", () => {
    const editor = document.createElement("div");
    document.body.appendChild(editor);
    const img = document.createElement("img");
    img.src = "data:image/png;base64,abc";
    editor.appendChild(img);

    const layer = wrapImageInLayer(img, editor);
    expect(layer.classList.contains(EMAIL_EDITOR_IMG_LAYER_CLASS)).toBe(true);
    expect(layer.parentElement).toBe(editor);
    expect(layer.querySelector("img")).toBe(img);
    expect(editor.style.position).toBe("relative");

    document.body.removeChild(editor);
  });

  it("alterna modo atrás e sobre o texto", () => {
    const editor = document.createElement("div");
    document.body.appendChild(editor);
    const img = document.createElement("img");
    img.src = "data:image/png;base64,abc";
    editor.appendChild(img);

    setImageLayerMode(img, editor, "behind");
    expect(getImageLayerMode(img)).toBe("behind");
    const layer = img.parentElement!;
    expect(layer.classList.contains(EMAIL_EDITOR_IMG_LAYER_BEHIND_CLASS)).toBe(true);

    setImageLayerMode(img, editor, "over");
    expect(getImageLayerMode(img)).toBe("over");
    expect(layer.classList.contains(EMAIL_EDITOR_IMG_LAYER_OVER_CLASS)).toBe(true);

    setImageLayerMode(img, editor, "flow");
    expect(getImageLayerMode(img)).toBe("flow");
    expect(editor.contains(img)).toBe(true);

    document.body.removeChild(editor);
  });
});
