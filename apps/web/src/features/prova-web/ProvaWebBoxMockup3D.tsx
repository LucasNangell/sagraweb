import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCcw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProvaWebBoxMockupMeta, ProvaWebPageMeta } from "@/api/provaWeb";

import {
  createBoxScene,
  DEFAULT_ROT_X,
  DEFAULT_ROT_Y,
  type BoxSceneHandle,
} from "./box-engine";
import { useIdleYawSpin } from "./useIdleYawSpin";
import "./prova-web-box-mockup.css";

export interface ProvaWebBoxMockup3DProps {
  pages: ProvaWebPageMeta[];
  boxMockup: ProvaWebBoxMockupMeta;
  pageUrl: (page: ProvaWebPageMeta) => string;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.18;

export function ProvaWebBoxMockup3D({
  pages,
  boxMockup,
  pageUrl,
}: ProvaWebBoxMockup3DProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<BoxSceneHandle | null>(null);
  const rotRef = useRef({ x: DEFAULT_ROT_X, y: DEFAULT_ROT_Y });
  const openRef = useRef(100);
  const zoomRef = useRef(1);

  const [openPct, setOpenPct] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const art = useMemo(
    () =>
      pages.find((p) => p.role === "sheet-front" && !p.blank) ??
      pages.find((p) => !p.blank) ??
      null,
    [pages],
  );
  const artUrl = art ? pageUrl(art) : null;

  const applyOrbit = useCallback((rx: number, ry: number) => {
    rotRef.current = { x: rx, y: ry };
    sceneRef.current?.setOrbit(rx, ry);
  }, []);

  const applyOpen = useCallback((pct: number) => {
    const clamped = Math.max(0, Math.min(100, pct));
    openRef.current = clamped;
    setOpenPct(clamped);
    sceneRef.current?.setOpen01(clamped / 100);
  }, []);

  const applyZoom = useCallback((z: number) => {
    const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
    zoomRef.current = next;
    setZoom(next);
    sceneRef.current?.setZoom(next);
  }, []);

  const { engage } = useIdleYawSpin({
    speedPerSec: 12,
    onTick: (deltaDeg) => {
      applyOrbit(rotRef.current.x, rotRef.current.y + deltaDeg);
    },
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !artUrl) return;
    let cancelled = false;
    let handle: BoxSceneHandle | null = null;
    setReady(false);
    setError(null);
    void (async () => {
      try {
        handle = await createBoxScene(canvas, boxMockup, artUrl);
        if (cancelled) {
          handle.dispose();
          return;
        }
        sceneRef.current = handle;
        handle.setOrbit(rotRef.current.x, rotRef.current.y);
        handle.setOpen01(openRef.current / 100);
        handle.setZoom(zoomRef.current);
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Não foi possível montar o mockup da caixa.",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
      handle?.dispose();
      sceneRef.current = null;
    };
  }, [artUrl, boxMockup]);

  const onPointerDown = () => {
    engage();
  };

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    engage();
    applyOpen(openRef.current + event.deltaY * 0.08);
  };

  const dims = boxMockup.dimsMm;
  const hingeCount = Math.max(
    1,
    new Set((boxMockup.openOperations ?? []).map((o) => o.order)).size,
  );

  return (
    <div className="prova-web-box-mockup">
      <div className="prova-web-box-mockup__toolbar">
        <button
          type="button"
          className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-slate-200"
          onClick={() => {
            engage();
            applyOpen(0);
          }}
        >
          Fechar
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-100 p-1.5 text-neutral-600 hover:bg-slate-200"
          aria-label="Fechar um pouco"
          onClick={() => {
            engage();
            applyOpen(openPct - 100 / hingeCount);
          }}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </button>
        <input
          className="prova-web-box-mockup__range"
          type="range"
          min={0}
          max={100}
          value={openPct}
          onChange={(e) => {
            engage();
            applyOpen(Number(e.target.value));
          }}
          aria-label="Abrir ou fechar abas"
        />
        <button
          type="button"
          className="rounded-lg bg-slate-100 p-1.5 text-neutral-600 hover:bg-slate-200"
          aria-label="Abrir um pouco"
          onClick={() => {
            engage();
            applyOpen(openPct + 100 / hingeCount);
          }}
        >
          <ChevronRight className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-medium text-neutral-700 hover:bg-slate-200"
          onClick={() => {
            engage();
            applyOpen(100);
          }}
        >
          Abrir
        </button>
        <span className="mx-1 h-4 w-px bg-slate-200" aria-hidden />
        <button
          type="button"
          className="rounded-lg bg-slate-100 p-1.5 text-neutral-600 hover:bg-slate-200"
          aria-label="Diminuir zoom"
          onClick={() => {
            engage();
            applyZoom(zoom / ZOOM_STEP);
          }}
        >
          <ZoomOut className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-100 p-1.5 text-neutral-600 hover:bg-slate-200"
          aria-label="Aumentar zoom"
          onClick={() => {
            engage();
            applyZoom(zoom * ZOOM_STEP);
          }}
        >
          <ZoomIn className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-100 p-1.5 text-neutral-600 hover:bg-slate-200"
          aria-label="Enquadrar"
          onClick={() => {
            engage();
            sceneRef.current?.fitView();
          }}
        >
          <Maximize2 className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          className="rounded-lg bg-slate-100 p-1.5 text-neutral-600 hover:bg-slate-200"
          aria-label="Resetar vista"
          onClick={() => {
            engage();
            applyOrbit(DEFAULT_ROT_X, DEFAULT_ROT_Y);
            applyZoom(1);
            applyOpen(100);
          }}
        >
          <RotateCcw className="size-4" aria-hidden />
        </button>
        <span className="text-[11px] text-neutral-500">
          {boxMockup.template} · {dims.length.toFixed(0)}×{dims.width.toFixed(0)}×
          {dims.height.toFixed(0)} mm · aberto {openPct.toFixed(0)}%
          {!ready && !error ? " · carregando…" : ""}
        </span>
      </div>
      <div
        ref={stageRef}
        className="prova-web-box-mockup__stage"
        onPointerDown={onPointerDown}
        onWheel={onWheel}
      >
        <canvas ref={canvasRef} className="prova-web-box-mockup__canvas" />
        {error ? (
          <p className="absolute inset-0 flex items-center justify-center p-4 text-sm text-sagra-danger">
            {error}
          </p>
        ) : (
          <p className="prova-web-box-mockup__hint">
            Arraste para girar · scroll abre/fecha as abas
          </p>
        )}
      </div>
    </div>
  );
}
