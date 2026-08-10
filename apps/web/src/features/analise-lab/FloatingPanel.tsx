import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, X } from "lucide-react";

import { clampPanelPosition } from "./analiseLabPageSync";

const STORAGE_KEY = "analise-lab:tools-panel";

type Stored = {
  x: number;
  y: number;
  open: boolean;
  collapsed: boolean;
};

function loadStored(): Stored | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw) as Stored;
    if (typeof data.x !== "number" || typeof data.y !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

function saveStored(data: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

interface FloatingPanelProps {
  title: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  width?: number;
}

export function FloatingPanel({
  title,
  open,
  onOpenChange,
  children,
  width = 320,
}: FloatingPanelProps) {
  const stored = useRef(loadStored()).current;
  const [pos, setPos] = useState(() => {
    if (stored) {
      return clampPanelPosition(
        stored.x,
        stored.y,
        width,
        200,
        typeof window !== "undefined" ? window.innerWidth : 1200,
        typeof window !== "undefined" ? window.innerHeight : 800,
      );
    }
    return { x: 16, y: typeof window !== "undefined" ? window.innerHeight - 420 : 200 };
  });
  const [collapsed, setCollapsed] = useState(stored?.collapsed ?? false);
  const dragRef = useRef<{
    ox: number;
    oy: number;
    sx: number;
    sy: number;
  } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    saveStored({ x: pos.x, y: pos.y, open, collapsed });
  }, [pos, open, collapsed]);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if ((e.target as HTMLElement).closest("button")) return;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        ox: e.clientX,
        oy: e.clientY,
        sx: pos.x,
        sy: pos.y,
      };
    },
    [pos],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.ox;
      const dy = e.clientY - dragRef.current.oy;
      const el = panelRef.current;
      const h = el?.offsetHeight ?? 200;
      setPos(
        clampPanelPosition(
          dragRef.current.sx + dx,
          dragRef.current.sy + dy,
          width,
          h,
          window.innerWidth,
          window.innerHeight,
        ),
      );
    },
    [width],
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    dragRef.current = null;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  }, []);

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={title}
      className="fixed z-30 flex max-h-[70vh] flex-col overflow-hidden rounded-lg border border-sagra-border bg-white shadow-lg"
      style={{ left: pos.x, top: pos.y, width }}
    >
      <div
        className="flex cursor-grab items-center gap-1 border-b border-sagra-border bg-neutral-50 px-2 py-1.5 active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-neutral-700">
          {title}
        </span>
        <button
          type="button"
          className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200"
          onClick={() => setCollapsed((c) => !c)}
          title={collapsed ? "Expandir" : "Recolher"}
        >
          {collapsed ? (
            <ChevronUp className="size-3.5" aria-hidden />
          ) : (
            <ChevronDown className="size-3.5" aria-hidden />
          )}
        </button>
        <button
          type="button"
          className="rounded p-0.5 text-neutral-500 hover:bg-neutral-200"
          onClick={() => onOpenChange(false)}
          title="Fechar"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      </div>
      {!collapsed ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-sm">{children}</div>
      ) : null}
    </div>
  );
}
