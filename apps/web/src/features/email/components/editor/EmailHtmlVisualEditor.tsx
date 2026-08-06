import { cn } from "@sagra/ui";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  joinEmailHtmlDocument,
  sanitizeEmailHtml,
  splitEmailHtmlDocument,
} from "../../utils";
import { EmailEditorToolbar, syncToolbarFromSelection } from "./EmailEditorToolbar";
import {
  createFloatedImageAt,
  enhanceImagesForEditing,
  getImageLayerMode,
  resolveDragTarget,
  setImageLayerMode,
  type EmailImageLayerMode,
} from "./emailEditorImages";
import { getSelectedImage, saveEditorSelection } from "./emailEditorSelection";
import { useFloatingImageDrag } from "./useFloatingImageDrag";
import { useTableColumnResize } from "./useTableColumnResize";
import "./emailVisualEditor.css";

interface EmailHtmlVisualEditorProps {
  html: string;
  onHtmlChange: (html: string) => void;
  onFocusChange?: (focused: boolean) => void;
  className?: string;
}

export function EmailHtmlVisualEditor({
  html,
  onHtmlChange,
  onFocusChange,
  className,
}: EmailHtmlVisualEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const partsRef = useRef(splitEmailHtmlDocument(html));
  const lastEmittedHtml = useRef<string | null>(null);
  const isFocusedRef = useRef(false);
  const [rulersEnabled, setRulersEnabled] = useState(true);
  const [selectedImageWidth, setSelectedImageWidth] = useState<number | null>(null);
  const [selectedImageLayer, setSelectedImageLayer] = useState<EmailImageLayerMode | null>(null);
  const [dropActive, setDropActive] = useState(false);

  const emitChange = useCallback(() => {
    const el = editorRef.current;
    if (!el) return;
    enhanceImagesForEditing(el);
    const newBody = sanitizeEmailHtml(el.innerHTML);
    const full = joinEmailHtmlDocument(partsRef.current, newBody);
    partsRef.current = { ...partsRef.current, bodyHtml: newBody };
    lastEmittedHtml.current = full;
    onHtmlChange(full);
  }, [onHtmlChange]);

  const resizeLayer = useTableColumnResize(editorRef, rulersEnabled, emitChange);

  const handleSelectionUpdate = useCallback((forcedImg?: HTMLImageElement | null) => {
    saveEditorSelection();
    const editor = editorRef.current;
    const img = forcedImg ?? getSelectedImage(editor);
    syncToolbarFromSelection(editor, setSelectedImageWidth);
    setSelectedImageLayer(img ? getImageLayerMode(img) : null);
    editor?.querySelectorAll("img").forEach((node) => {
      node.classList.toggle("email-editor-img-selected", node === img);
    });
    editor?.querySelectorAll(".email-editor-img-layer").forEach((node) => {
      const layerImg = node.querySelector("img");
      node.classList.toggle("email-editor-img-layer-selected", layerImg === img);
    });
  }, []);

  useFloatingImageDrag({
    editorRef,
    onChange: emitChange,
    onDragStart: (img) => {
      handleSelectionUpdate(img);
    },
  });

  useEffect(() => {
    if (isFocusedRef.current) return;
    if (html === lastEmittedHtml.current) return;

    lastEmittedHtml.current = html;
    partsRef.current = splitEmailHtmlDocument(html);
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = sanitizeEmailHtml(partsRef.current.bodyHtml);
    enhanceImagesForEditing(el);
  }, [html]);

  const handleImageWidthChange = (width: number) => {
    const img = getSelectedImage(editorRef.current);
    if (!img) return;
    const w = Math.max(40, Math.round(width));
    img.style.width = `${w}px`;
    img.style.maxWidth = "100%";
    img.setAttribute("width", String(w));
    img.removeAttribute("height");
    setSelectedImageWidth(w);
    emitChange();
  };

  const handleImageLayerChange = (mode: EmailImageLayerMode) => {
    const editor = editorRef.current;
    const img = getSelectedImage(editor);
    if (!img || !editor) return;
    setImageLayerMode(img, editor, mode);
    setSelectedImageLayer(mode);
    handleSelectionUpdate(img);
    emitChange();
  };

  const insertImageFile = (file: File, clientX?: number, clientY?: number) => {
    if (!file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === "string" ? reader.result : "";
      if (!dataUrl || !editorRef.current) return;
      editorRef.current.focus();

      if (clientX != null && clientY != null) {
        const img = createFloatedImageAt(editorRef.current, dataUrl, clientX, clientY, "over");
        handleSelectionUpdate(img);
        emitChange();
        return;
      }

      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "";
        img.style.display = "block";
        img.style.maxWidth = "100%";
        img.draggable = false;
        range.insertNode(img);
        range.setStartAfter(img);
        range.collapse(true);
        sel.removeAllRanges();
        sel.addRange(range);
      } else {
        const img = document.createElement("img");
        img.src = dataUrl;
        img.alt = "";
        img.style.display = "block";
        img.style.maxWidth = "100%";
        img.draggable = false;
        editorRef.current.appendChild(img);
      }
      handleSelectionUpdate();
      emitChange();
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="email-visual-editor">
      <EmailEditorToolbar
        editorRef={editorRef}
        onChange={emitChange}
        rulersEnabled={rulersEnabled}
        onRulersToggle={setRulersEnabled}
        selectedImageWidth={selectedImageWidth}
        onImageWidthChange={handleImageWidthChange}
        selectedImageLayer={selectedImageLayer}
        onImageLayerChange={handleImageLayerChange}
      />

      <div ref={canvasRef} className="email-visual-editor-canvas">
        <div className="email-visual-editor-inner">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            role="textbox"
            aria-multiline
            aria-label="Editor visual do e-mail"
            className={cn(
              "email-editable-preview max-w-full cursor-text rounded border border-slate-200 bg-white p-2 text-sm leading-relaxed text-slate-800 outline-none",
              "focus:border-secondary-blue/40 focus:ring-2 focus:ring-secondary-blue/15",
              "[&_a]:text-blue-600 [&_a]:underline [&_p]:my-1 [&_table]:max-w-full",
              dropActive && "email-editor-drop-hint",
              className,
            )}
            onInput={() => {
              handleSelectionUpdate();
              emitChange();
            }}
            onBlur={() => {
              isFocusedRef.current = false;
              onFocusChange?.(false);
              emitChange();
            }}
            onFocus={() => {
              isFocusedRef.current = true;
              onFocusChange?.(true);
            }}
            onKeyUp={() => handleSelectionUpdate()}
            onMouseUp={() => handleSelectionUpdate()}
            onClick={(e) => {
              const img = resolveDragTarget(e.target);
              handleSelectionUpdate(img);
            }}
            onDragEnter={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                setDropActive(true);
              }
            }}
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("Files")) {
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                setDropActive(true);
              }
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                setDropActive(false);
              }
            }}
            onDrop={(e) => {
              setDropActive(false);
              const file = Array.from(e.dataTransfer.files).find((f) =>
                f.type.startsWith("image/"),
              );
              if (file) {
                e.preventDefault();
                insertImageFile(file, e.clientX, e.clientY);
              }
            }}
          />
          {resizeLayer}
        </div>
      </div>
    </div>
  );
}
