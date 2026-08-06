import { useEffect, useRef, useState, type RefObject, type ReactNode } from "react";

type HandleSpec = {
  id: string;
  left: number;
  top: number;
  height: number;
  table: HTMLTableElement;
  colIndex: number;
};

function collectTableHandles(editor: HTMLElement): HandleSpec[] {
  const handles: HandleSpec[] = [];
  const wrapper = editor.parentElement ?? editor;
  const wrapperRect = wrapper.getBoundingClientRect();

  editor.querySelectorAll("table").forEach((table, tableIdx) => {
    const tableRect = table.getBoundingClientRect();
    const firstRow = table.querySelector("tr");
    if (!firstRow) return;

    const cells = Array.from(firstRow.querySelectorAll("td, th"));
    if (cells.length < 2) return;

    for (let i = 0; i < cells.length - 1; i += 1) {
      const cell = cells[i] as HTMLElement;
      const cellRect = cell.getBoundingClientRect();
      const boundaryX = cellRect.right - wrapperRect.left;

      handles.push({
        id: `t${tableIdx}-c${i}`,
        left: boundaryX,
        top: tableRect.top - wrapperRect.top,
        height: tableRect.height,
        table,
        colIndex: i,
      });
    }
  });

  return handles;
}

function setColumnWidth(table: HTMLTableElement, colIndex: number, widthPx: number): void {
  const w = Math.max(24, Math.round(widthPx));
  const rows = table.querySelectorAll("tr");
  rows.forEach((row) => {
    const cell = row.querySelectorAll("td, th")[colIndex] as HTMLElement | undefined;
    if (!cell) return;
    cell.style.width = `${w}px`;
    cell.setAttribute("width", String(w));
  });
}

export function useTableColumnResize(
  editorRef: RefObject<HTMLDivElement | null>,
  enabled: boolean,
  onResize: () => void,
): ReactNode {
  const [handles, setHandles] = useState<HandleSpec[]>([]);
  const dragRef = useRef<{
    table: HTMLTableElement;
    colIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || !enabled) {
      setHandles([]);
      return;
    }

    const refresh = () => setHandles(collectTableHandles(editor));
    refresh();

    const ro = new ResizeObserver(refresh);
    ro.observe(editor);
    const scrollParent = editor.parentElement?.closest(".email-visual-editor-canvas");
    scrollParent?.addEventListener("scroll", refresh);
    window.addEventListener("resize", refresh);

    return () => {
      ro.disconnect();
      scrollParent?.removeEventListener("scroll", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [editorRef, enabled]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const delta = e.clientX - drag.startX;
      setColumnWidth(drag.table, drag.colIndex, drag.startWidth + delta);
      const editor = editorRef.current;
      if (editor) setHandles(collectTableHandles(editor));
    };

    const onUp = () => {
      if (dragRef.current) {
        dragRef.current = null;
        setDraggingId(null);
        onResize();
      }
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [editorRef, onResize]);

  const startDrag = (handle: HandleSpec, clientX: number) => {
    const cell = handle.table.querySelectorAll("tr td, tr th")[handle.colIndex] as
      | HTMLElement
      | undefined;
    const startWidth = cell?.getBoundingClientRect().width ?? 100;
    dragRef.current = {
      table: handle.table,
      colIndex: handle.colIndex,
      startX: clientX,
      startWidth,
    };
    setDraggingId(handle.id);
  };

  if (!enabled || handles.length === 0) return null;

  return (
    <div className="email-table-resize-layer">
      {handles.map((h) => (
        <div
          key={h.id}
          className={`email-table-resize-handle${draggingId === h.id ? " is-dragging" : ""}`}
          style={{ left: h.left, top: h.top, height: h.height }}
          title="Arraste para ajustar a largura da coluna"
          onMouseDown={(e) => {
            e.preventDefault();
            startDrag(h, e.clientX);
          }}
        />
      ))}
    </div>
  );
}
