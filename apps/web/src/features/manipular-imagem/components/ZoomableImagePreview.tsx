import { ZoomIn, ZoomOut } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type SetStateAction,
} from "react";

const ZOOM_MIN = 1;
const ZOOM_MAX = 6;
const ZOOM_STEP = 0.25;
const CHECKER =
  "bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%),linear-gradient(-45deg,#e2e8f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#e2e8f0_75%),linear-gradient(-45deg,transparent_75%,#e2e8f0_75%)] bg-[length:16px_16px] bg-[position:0_0,0_8px,8px_-8px,-8px_0]";

function clampZoom(value: number): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(value * 100) / 100));
}

export function useSyncedImageZoom() {
  const [zoom, setZoom] = useState(ZOOM_MIN);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const reset = useCallback(() => {
    setZoom(ZOOM_MIN);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomIn = useCallback(() => {
    setZoom((z) => clampZoom(z + ZOOM_STEP));
  }, []);

  const zoomOut = useCallback(() => {
    setZoom((z) => {
      const next = clampZoom(z - ZOOM_STEP);
      if (next <= ZOOM_MIN) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  const applyWheelDelta = useCallback((deltaY: number) => {
    const delta = deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP;
    setZoom((z) => {
      const next = clampZoom(z + delta);
      if (next <= ZOOM_MIN) setPan({ x: 0, y: 0 });
      return next;
    });
  }, []);

  return { zoom, pan, setPan, reset, zoomIn, zoomOut, applyWheelDelta };
}

export function ZoomControls({
  zoom,
  onZoomIn,
  onZoomOut,
  onReset,
}: {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        title="Diminuir zoom"
        aria-label="Diminuir zoom"
        disabled={zoom <= ZOOM_MIN}
        onClick={onZoomOut}
        className="rounded border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        <ZoomOut className="h-4 w-4" />
      </button>
      <button
        type="button"
        title="Resetar zoom"
        onClick={onReset}
        className="min-w-14 rounded border border-slate-200 bg-white px-2 py-1 text-xs tabular-nums text-slate-700 hover:bg-slate-50"
      >
        {Math.round(zoom * 100)}%
      </button>
      <button
        type="button"
        title="Aumentar zoom"
        aria-label="Aumentar zoom"
        disabled={zoom >= ZOOM_MAX}
        onClick={onZoomIn}
        className="rounded border border-slate-200 bg-white p-1.5 text-slate-700 hover:bg-slate-50 disabled:opacity-40"
      >
        <ZoomIn className="h-4 w-4" />
      </button>
    </div>
  );
}

export function ZoomableImageFrame({
  label,
  zoom,
  pan,
  setPan,
  applyWheelDelta,
  children,
  empty,
}: {
  label: string;
  zoom: number;
  pan: { x: number; y: number };
  setPan: Dispatch<SetStateAction<{ x: number; y: number }>>;
  applyWheelDelta: (deltaY: number) => void;
  children?: ReactNode;
  empty?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const canPan = zoom > ZOOM_MIN;

  useEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyWheelDelta(event.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [applyWheelDelta]);

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (!canPan || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setPan({
      x: drag.originX + (event.clientX - drag.startX),
      y: drag.originY + (event.clientY - drag.startY),
    });
  }

  function endDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <div
        ref={frameRef}
        className={[
          "h-[360px] overflow-hidden rounded border border-slate-100 p-2 touch-none",
          CHECKER,
          canPan ? "cursor-grab active:cursor-grabbing" : "cursor-default",
        ].join(" ")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {children ? (
          <div className="flex h-full w-full items-center justify-center">
            <div
              className="max-h-full max-w-full will-change-transform"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
                transformOrigin: "center center",
                transition: dragging ? undefined : "transform 80ms ease-out",
              }}
            >
              {children}
            </div>
          </div>
        ) : (
          empty
        )}
      </div>
    </div>
  );
}
