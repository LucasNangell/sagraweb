import { useEffect, type RefObject } from "react";

import {
  getImageLayerWrap,
  positionImageLayer,
  resolveDragTarget,
  wrapImageInLayer,
} from "./emailEditorImages";

const DRAG_THRESHOLD_PX = 4;

type UseFloatingImageDragOptions = {
  editorRef: RefObject<HTMLDivElement | null>;
  enabled?: boolean;
  onDragStart?: (img: HTMLImageElement) => void;
  onDragEnd?: () => void;
  onChange: () => void;
};

export function useFloatingImageDrag({
  editorRef,
  enabled = true,
  onDragStart,
  onDragEnd,
  onChange,
}: UseFloatingImageDragOptions): void {
  useEffect(() => {
    if (!enabled) return;
    const editor = editorRef.current;
    if (!editor) return;

    let dragState: {
      img: HTMLImageElement;
      layer: HTMLElement;
      startX: number;
      startY: number;
      originLeft: number;
      originTop: number;
      active: boolean;
    } | null = null;

    const finishDrag = () => {
      if (!dragState) return;
      if (dragState.active) {
        onChange();
        onDragEnd?.();
      }
      dragState = null;
      document.body.classList.remove("email-editor-img-dragging-body");
      editor.classList.remove("email-editor-img-dragging");
    };

    const onPointerDown = (e: PointerEvent) => {
      if (e.button !== 0) return;

      let img = resolveDragTarget(e.target);

      if (!img && e.altKey) {
        for (const el of document.elementsFromPoint(e.clientX, e.clientY)) {
          if (!(el instanceof HTMLElement) || !editor.contains(el)) continue;
          img = resolveDragTarget(el);
          if (img) break;
        }
      }

      if (!img || !editor.contains(img)) return;

      const layer = getImageLayerWrap(img) ?? wrapImageInLayer(img, editor);
      const startLeft = parseInt(layer.style.left || "0", 10) || 0;
      const startTop = parseInt(layer.style.top || "0", 10) || 0;

      dragState = {
        img,
        layer,
        startX: e.clientX,
        startY: e.clientY,
        originLeft: startLeft,
        originTop: startTop,
        active: false,
      };

      try {
        (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }

      e.preventDefault();
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragState) return;

      const dx = e.clientX - dragState.startX;
      const dy = e.clientY - dragState.startY;

      if (!dragState.active) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        dragState.active = true;
        onDragStart?.(dragState.img);
        document.body.classList.add("email-editor-img-dragging-body");
        editor.classList.add("email-editor-img-dragging");
      }

      positionImageLayer(
        dragState.layer,
        editor,
        dragState.originLeft + dx,
        dragState.originTop + dy,
      );
    };

    const onPointerUp = () => finishDrag();
    const onPointerCancel = () => finishDrag();

    editor.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);

    return () => {
      finishDrag();
      editor.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
  }, [editorRef, enabled, onChange, onDragEnd, onDragStart]);
}
