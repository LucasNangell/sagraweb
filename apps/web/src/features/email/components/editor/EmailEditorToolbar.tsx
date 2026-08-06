import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  ImagePlus,
  Italic,
  Link2,
  Ruler,
  Underline,
} from "lucide-react";
import { useCallback, useState, type RefObject } from "react";

import {
  applyInlineStyleToSelection,
  execEditorCommand,
  getSelectedImage,
  insertHtmlAtSelection,
  saveEditorSelection,
} from "./emailEditorSelection";
import type { EmailImageLayerMode } from "./emailEditorImages";

const FONT_OPTIONS = [
  "Arial, Helvetica, sans-serif",
  "Georgia, serif",
  "Times New Roman, Times, serif",
  "Verdana, Geneva, sans-serif",
  "Tahoma, Geneva, sans-serif",
  "Courier New, Courier, monospace",
];

const SIZE_OPTIONS = ["12px", "14px", "16px", "18px", "20px", "24px", "28px", "32px"];

type EmailEditorToolbarProps = {
  editorRef: RefObject<HTMLDivElement | null>;
  onChange: () => void;
  rulersEnabled: boolean;
  onRulersToggle: (enabled: boolean) => void;
  selectedImageWidth: number | null;
  onImageWidthChange: (width: number) => void;
  selectedImageLayer: EmailImageLayerMode | null;
  onImageLayerChange: (mode: EmailImageLayerMode) => void;
};

export function EmailEditorToolbar({
  editorRef,
  onChange,
  rulersEnabled,
  onRulersToggle,
  selectedImageWidth,
  onImageWidthChange,
  selectedImageLayer,
  onImageLayerChange,
}: EmailEditorToolbarProps) {
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0]);
  const [fontSize, setFontSize] = useState("16px");

  const run = useCallback(
    (fn: () => void) => {
      fn();
      onChange();
    },
    [onChange],
  );

  const handleFontFamily = (family: string) => {
    setFontFamily(family);
    run(() => {
      applyInlineStyleToSelection(editorRef.current, { fontFamily: family });
    });
  };

  const handleFontSize = (size: string) => {
    setFontSize(size);
    run(() => {
      applyInlineStyleToSelection(editorRef.current, { fontSize: size });
    });
  };

  const handleColor = (color: string) => {
    run(() => {
      execEditorCommand(editorRef.current, "foreColor", color);
    });
  };

  const handleInsertLink = () => {
    const url = window.prompt("URL do link:", "https://");
    if (!url?.trim()) return;
    run(() => {
      execEditorCommand(editorRef.current, "createLink", url.trim());
    });
  };

  const handleInsertImage = () => {
    const url = window.prompt("URL da imagem:", "https://");
    if (!url?.trim()) return;
    run(() => {
      insertHtmlAtSelection(
        editorRef.current,
        `<img src="${url.trim().replace(/"/g, "&quot;")}" alt="" style="display:block;max-width:100%;" />`,
      );
    });
  };

  const handleImageUpload = (file: File | undefined) => {
    if (!file?.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl) return;
      run(() => {
        insertHtmlAtSelection(
          editorRef.current,
          `<img src="${dataUrl}" alt="" style="display:block;max-width:100%;" />`,
        );
      });
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="email-editor-toolbar" onMouseDown={(e) => e.preventDefault()}>
      <select
        title="Fonte"
        value={fontFamily}
        onChange={(e) => handleFontFamily(e.target.value)}
        onFocus={saveEditorSelection}
      >
        {FONT_OPTIONS.map((f) => (
          <option key={f} value={f}>
            {f.split(",")[0]}
          </option>
        ))}
      </select>

      <select
        title="Tamanho"
        value={fontSize}
        onChange={(e) => handleFontSize(e.target.value)}
        onFocus={saveEditorSelection}
      >
        {SIZE_OPTIONS.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <label className="inline-flex items-center gap-1 text-[10px] text-slate-600" title="Cor do texto">
        <span>A</span>
        <input
          type="color"
          defaultValue="#111827"
          onChange={(e) => handleColor(e.target.value)}
          onFocus={saveEditorSelection}
        />
      </label>

      <button
        type="button"
        title="Negrito"
        onClick={() => run(() => execEditorCommand(editorRef.current, "bold"))}
      >
        <Bold className="size-3.5" />
      </button>
      <button
        type="button"
        title="Itálico"
        onClick={() => run(() => execEditorCommand(editorRef.current, "italic"))}
      >
        <Italic className="size-3.5" />
      </button>
      <button
        type="button"
        title="Sublinhado"
        onClick={() => run(() => execEditorCommand(editorRef.current, "underline"))}
      >
        <Underline className="size-3.5" />
      </button>

      <button
        type="button"
        title="Alinhar à esquerda"
        onClick={() => run(() => execEditorCommand(editorRef.current, "justifyLeft"))}
      >
        <AlignLeft className="size-3.5" />
      </button>
      <button
        type="button"
        title="Centralizar"
        onClick={() => run(() => execEditorCommand(editorRef.current, "justifyCenter"))}
      >
        <AlignCenter className="size-3.5" />
      </button>
      <button
        type="button"
        title="Alinhar à direita"
        onClick={() => run(() => execEditorCommand(editorRef.current, "justifyRight"))}
      >
        <AlignRight className="size-3.5" />
      </button>

      <button type="button" title="Inserir link" onClick={handleInsertLink}>
        <Link2 className="size-3.5" />
      </button>

      <button type="button" title="Inserir imagem por URL" onClick={handleInsertImage}>
        <ImagePlus className="size-3.5" />
      </button>

      <label
        className="inline-flex cursor-pointer items-center gap-1 rounded border border-slate-300 bg-white px-1.5 text-[10px] text-slate-700"
        title="Enviar imagem"
      >
        Upload
        <input
          type="file"
          accept="image/*"
          className="sr-only"
          onChange={(e) => handleImageUpload(e.target.files?.[0])}
        />
      </label>

      <button
        type="button"
        title="Réguas de colunas (tabelas)"
        aria-pressed={rulersEnabled}
        onClick={() => onRulersToggle(!rulersEnabled)}
      >
        <Ruler className="size-3.5" />
      </button>

      {selectedImageWidth != null ? (
        <>
          <label className="ml-1 inline-flex items-center gap-1 text-[10px] text-slate-600">
            Largura
            <input
              type="number"
              min={40}
              max={1200}
              value={selectedImageWidth}
              className="h-7 w-16 rounded border border-slate-300 px-1"
              onChange={(e) => onImageWidthChange(Number(e.target.value) || 40)}
            />
            px
          </label>
          <span className="text-[10px] text-slate-400">|</span>
          <button
            type="button"
            title="Imagem no fluxo do texto (inline)"
            aria-pressed={selectedImageLayer === "flow"}
            onClick={() => onImageLayerChange("flow")}
          >
            Fluxo
          </button>
          <button
            type="button"
            title="Imagem atrás do texto"
            aria-pressed={selectedImageLayer === "behind"}
            onClick={() => onImageLayerChange("behind")}
          >
            Atrás
          </button>
          <button
            type="button"
            title="Imagem sobre o texto"
            aria-pressed={selectedImageLayer === "over"}
            onClick={() => onImageLayerChange("over")}
          >
            Sobre
          </button>
        </>
      ) : null}
    </div>
  );
}

export function syncToolbarFromSelection(
  editor: HTMLElement | null,
  onImageSelect: (width: number | null) => void,
): void {
  const img = getSelectedImage(editor);
  if (img) {
    const w = img.width || parseInt(img.getAttribute("width") || "0", 10) || 200;
    onImageSelect(w);
  } else {
    onImageSelect(null);
  }
}
