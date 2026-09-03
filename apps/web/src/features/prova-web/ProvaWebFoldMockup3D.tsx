import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  RotateCcw,
  UnfoldHorizontal,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProvaWebFoldMockupMeta, ProvaWebPageMeta } from "@/api/provaWeb";

import {
  createFoldScene,
  DEFAULT_ROT_X,
  DEFAULT_ROT_Y,
  MAX_ROT_X,
  ORBIT_SENS_X,
  ORBIT_SENS_Y,
  type FoldSceneHandle,
} from "./fold-engine";
import { UNFOLD_WHEEL_SENS } from "./fold-engine/foldInteraction";
import { useIdleUnfoldLoop } from "./useIdleUnfoldLoop";
import "./prova-web-fold-mockup.css";

export interface ProvaWebFoldMockup3DProps {
  pages: ProvaWebPageMeta[];
  foldMockup: ProvaWebFoldMockupMeta;
  pageUrl: (page: ProvaWebPageMeta) => string;
  /** Ângulos iniciais de órbita em graus (X / Y). Padrão: pose do folheto. */
  initialOrbitDeg?: { x: number; y: number };
  /** Teto do devicePixelRatio do WebGL (padrão 2). */
  maxPixelRatio?: number;
  /** Padding do enquadramento inicial (menor = preenche mais a área). */
  fitPadding?: number;
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
}

const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.18;

export function ProvaWebFoldMockup3D({
  pages,
  foldMockup,
  pageUrl,
  initialOrbitDeg,
  maxPixelRatio,
  fitPadding,
}: ProvaWebFoldMockup3DProps) {
  const initialRot = useMemo(() => {
    if (initialOrbitDeg == null) {
      return { x: DEFAULT_ROT_X, y: DEFAULT_ROT_Y };
    }
    return {
      x: (initialOrbitDeg.x * Math.PI) / 180,
      y: (initialOrbitDeg.y * Math.PI) / 180,
    };
  }, [initialOrbitDeg?.x, initialOrbitDeg?.y]);

  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FoldSceneHandle | null>(null);
  const unfoldAnimRef = useRef<number | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotY: number;
    rotX: number;
  } | null>(null);
  const rotRef = useRef(initialRot);
  const unfoldRef = useRef(0);
  const zoomRef = useRef(1);

  const [rotX, setRotX] = useState(initialRot.x);
  const [rotY, setRotY] = useState(initialRot.y);
  const [unfold, setUnfold] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [solverMsg, setSolverMsg] = useState<string | null>(null);

  const front = useMemo(
    () =>
      pages.find((p) => p.role === "sheet-front" && !p.blank) ??
      pages.find((p) => !p.blank) ??
      null,
    [pages],
  );
  const back = useMemo(
    () => pages.find((p) => p.role === "sheet-back" && !p.blank) ?? null,
    [pages],
  );
  const frontUrl = front ? pageUrl(front) : null;
  const backUrl = foldMockup.hasVerso && back ? pageUrl(back) : null;

  const kickRender = useCallback(() => {
    const handle = sceneRef.current;
    if (!handle) return;
    handle.requestRender();
    handle.render();
  }, []);

  const applyUnfold = useCallback(
    (value: number) => {
      const v = Math.min(100, Math.max(0, value));
      unfoldRef.current = v;
      setUnfold(v);
      sceneRef.current?.setHingeAnglesFromUnfold(v / 100);
      const errs = sceneRef.current?.getErrors() ?? [];
      setSolverMsg(errs[0] ?? null);
      kickRender();
    },
    [kickRender],
  );

  const cancelUnfoldAnim = useCallback(() => {
    if (unfoldAnimRef.current != null) {
      cancelAnimationFrame(unfoldAnimRef.current);
      unfoldAnimRef.current = null;
    }
  }, []);

  const animateUnfoldTo = useCallback(
    (target: number) => {
      cancelUnfoldAnim();
      const from = unfoldRef.current;
      const to = Math.min(100, Math.max(0, target));
      if (Math.abs(to - from) < 0.05) {
        applyUnfold(to);
        return;
      }
      // ~7ms por ponto percentual, limitado para passos curtos e Fechar/Abrir
      const duration = Math.min(900, Math.max(220, Math.abs(to - from) * 7));
      const t0 = performance.now();
      const tick = (now: number) => {
        const p = Math.min(1, (now - t0) / duration);
        applyUnfold(from + (to - from) * easeOutCubic(p));
        if (p < 1) {
          unfoldAnimRef.current = requestAnimationFrame(tick);
        } else {
          unfoldAnimRef.current = null;
        }
      };
      unfoldAnimRef.current = requestAnimationFrame(tick);
    },
    [applyUnfold, cancelUnfoldAnim],
  );

  const applyOrbit = useCallback(
    (x: number, y: number) => {
      rotRef.current = { x, y };
      setRotX(x);
      setRotY(y);
      sceneRef.current?.setOrbit(x, y);
      kickRender();
    },
    [kickRender],
  );

  /** Idle: abre/fecha em loop até clique ou scroll (órbita fica na pose default). */
  const { engage } = useIdleUnfoldLoop({
    onUnfold: applyUnfold,
    halfCycleMs: 3000,
  });

  const applyZoom = useCallback(
    (value: number) => {
      const v = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
      zoomRef.current = v;
      setZoom(v);
      sceneRef.current?.setZoom(v);
      kickRender();
    },
    [kickRender],
  );

  const nudgeZoom = useCallback(
    (dir: -1 | 1) => {
      const next =
        dir > 0
          ? zoomRef.current * ZOOM_STEP
          : zoomRef.current / ZOOM_STEP;
      applyZoom(next);
    },
    [applyZoom],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    let cancelled = false;
    setReady(false);
    setError(null);

    void (async () => {
      try {
        sceneRef.current?.dispose();
        sceneRef.current = null;
        const handle = await createFoldScene(
          canvas,
          foldMockup,
          frontUrl,
          backUrl,
          { colorMode: "faithful", maxPixelRatio, fitPadding },
        );
        if (cancelled) {
          handle.dispose();
          return;
        }
        sceneRef.current = handle;
        handle.setOrbit(rotRef.current.x, rotRef.current.y);
        handle.setHingeAnglesFromUnfold(unfoldRef.current / 100);
        const rect = stage.getBoundingClientRect();
        handle.resize(rect.width, Math.max(1, rect.height));
        handle.setZoom(zoomRef.current);
        handle.fitView();
        setReady(true);
        handle.requestRender();
        handle.render();
        // Reenquadra após o layout do diálogo estabilizar
        requestAnimationFrame(() => {
          if (cancelled || sceneRef.current !== handle) return;
          const next = stage.getBoundingClientRect();
          handle.resize(next.width, Math.max(1, next.height));
          handle.fitView();
          handle.requestRender();
          handle.render();
        });
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Falha ao iniciar o mockup 3D.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      cancelUnfoldAnim();
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
  }, [foldMockup, frontUrl, backUrl, maxPixelRatio, fitPadding, cancelUnfoldAnim]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !ready) return;
    const ro = new ResizeObserver(() => {
      const handle = sceneRef.current;
      if (!handle) return;
      const rect = stage.getBoundingClientRect();
      handle.resize(rect.width, Math.max(1, rect.height));
      kickRender();
    });
    ro.observe(stage);
    return () => ro.disconnect();
  }, [ready, kickRender]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const t = event.target as HTMLElement;
    if (t.closest("input,button,label")) return;
    if (!sceneRef.current) return;

    engage();

    event.currentTarget.setPointerCapture(event.pointerId);
    // Mouse só para órbita; desdobrar pelo scroll/slider
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      rotY: rotRef.current.y,
      rotX: rotRef.current.x,
    };
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    const nextY = drag.rotY + dx * ORBIT_SENS_Y;
    const nextX = Math.max(
      -MAX_ROT_X,
      Math.min(MAX_ROT_X, drag.rotX + dy * ORBIT_SENS_X),
    );
    applyOrbit(nextX, nextY);
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
  };

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    engage();
    // Scroll desdobra a partir do % atual do loop (sem reset)
    cancelUnfoldAnim();
    applyUnfold(unfoldRef.current + event.deltaY * UNFOLD_WHEEL_SENS);
  };

  const hingeCount = Math.max(
    1,
    new Set((foldMockup.operations ?? []).map((h) => h.order)).size,
  );
  const stepUnfold = (dir: -1 | 1) => {
    engage();
    const step = 100 / hingeCount;
    const snapped =
      Math.round(unfoldRef.current / step) * step + dir * step;
    animateUnfoldTo(snapped);
  };

  const resetView = () => {
    applyOrbit(initialRot.x, initialRot.y);
    applyZoom(1);
    sceneRef.current?.fitView();
    kickRender();
  };

  const pageW = foldMockup.pageWidthMm;
  const pageH = foldMockup.pageHeightMm;

  return (
    <div
      className="prova-web-fold-mockup"
      role="img"
      aria-label="Mockup 3D do folheto dobrado"
    >
      <p className="prova-web-fold-mockup__hint">
        Abrindo/fechando automaticamente · clique ou scroll para interagir
      </p>

      <div className="prova-web-fold-mockup__toolbar">
        <button
          type="button"
          onClick={() => {
            engage();
            animateUnfoldTo(0);
          }}
          title="Fechar"
        >
          Fechar
        </button>
        <button
          type="button"
          onClick={() => stepUnfold(-1)}
          title="Passo fechar"
          aria-label="Passo para fechar"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <label className="prova-web-fold-mockup__slider">
          <UnfoldHorizontal className="size-3.5 shrink-0" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={unfold}
            onChange={(e) => {
              engage();
              cancelUnfoldAnim();
              applyUnfold(Number(e.target.value));
            }}
            aria-label="Desdobrar"
          />
          <span className="tabular-nums">{Math.round(unfold)}%</span>
        </label>
        <button
          type="button"
          onClick={() => stepUnfold(1)}
          title="Passo abrir"
          aria-label="Passo para abrir"
        >
          <ChevronRight className="size-3.5" />
        </button>
        <button
          type="button"
          onClick={() => {
            engage();
            animateUnfoldTo(100);
          }}
          title="Abrir"
        >
          Abrir
        </button>
        <span className="prova-web-fold-mockup__toolbar-sep" aria-hidden />
        <button
          type="button"
          onClick={() => nudgeZoom(-1)}
          title="Diminuir zoom"
          aria-label="Diminuir zoom"
          disabled={zoom <= ZOOM_MIN + 0.001}
        >
          <ZoomOut className="size-3.5" />
        </button>
        <span className="prova-web-fold-mockup__zoom-label tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => nudgeZoom(1)}
          title="Aumentar zoom"
          aria-label="Aumentar zoom"
          disabled={zoom >= ZOOM_MAX - 0.001}
        >
          <ZoomIn className="size-3.5" />
        </button>
        <button type="button" onClick={resetView} title="Resetar vista">
          <RotateCcw className="size-3.5" />
          Vista
        </button>
        <button
          type="button"
          onClick={() => {
            sceneRef.current?.fitView();
            kickRender();
          }}
          title="Enquadrar"
        >
          <Maximize2 className="size-3.5" />
        </button>
      </div>

      <div
        ref={stageRef}
        className="prova-web-fold-mockup__stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
        onDoubleClick={() => {
          sceneRef.current?.fitView();
          kickRender();
        }}
      >
        <canvas
          ref={canvasRef}
          className="prova-web-fold-mockup__canvas"
          aria-hidden
        />
        {!ready && !error && (
          <p className="prova-web-fold-mockup__loading">Preparando mockup 3D…</p>
        )}
        {error && (
          <p className="prova-web-fold-mockup__loading text-sagra-danger">
            {error}
          </p>
        )}
        {solverMsg && (
          <p className="prova-web-fold-mockup__solver">{solverMsg}</p>
        )}
        <p className="prova-web-fold-mockup__meta">
          {foldMockup.preset} · {pageW.toFixed(0)}×{pageH.toFixed(0)} mm ·{" "}
          {foldMockup.panels.length} painéis
          {foldMockup.hasVerso ? " · com verso" : " · só frente"}
          {" · "}
          órbita {(rotY * (180 / Math.PI)).toFixed(0)}°/
          {(rotX * (180 / Math.PI)).toFixed(0)}°
        </p>
      </div>
    </div>
  );
}
