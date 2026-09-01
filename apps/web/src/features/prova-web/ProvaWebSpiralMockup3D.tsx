import { ChevronLeft, ChevronRight, RotateCcw, ZoomIn, ZoomOut } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ProvaWebPageMeta,
  ProvaWebSpiralMockupMeta,
} from "@/api/provaWeb";

import {
  createSpiralScene,
  type SpiralSceneHandle,
} from "./spiralSceneThree";
import { useIdleSpiralPageFlip } from "./useIdleSpiralPageFlip";
import "./prova-web-spiral-mockup.css";

const DEFAULT_ROT_Y = -32;
const DEFAULT_ROT_X = -14;
const MAX_ROT_X = 28;
const ZOOM_MIN = 0.4;
const ZOOM_MAX = 3;
const ZOOM_STEP = 1.18;

type SpiralTurnTiming = {
  durationMs?: number;
  settleMs?: number;
  fadeMs?: number;
};

export interface ProvaWebSpiralMockup3DProps {
  pages: ProvaWebPageMeta[];
  spiralMockup: ProvaWebSpiralMockupMeta;
  pageUrl: (page: ProvaWebPageMeta) => string;
}

type SheetPair = {
  front: ProvaWebPageMeta;
  back: ProvaWebPageMeta | null;
};

/** Pares frente/verso consecutivos (páginas não-blank). */
export function buildSpiralSheets(pages: ProvaWebPageMeta[]): SheetPair[] {
  const list = pages.filter((p) => !p.blank);
  const sheets: SheetPair[] = [];
  for (let i = 0; i < list.length; i += 2) {
    sheets.push({
      front: list[i]!,
      back: list[i + 1] ?? null,
    });
  }
  return sheets;
}

/**
 * Verso exibido na face de trás do bloco em repouso = verso da folha
 * anterior (já virada). A folha atual só mostra o próprio verso no flip.
 */
export function previousSheetVerso(
  sheets: SheetPair[],
  sheetIndex: number,
): ProvaWebPageMeta | null {
  if (sheetIndex <= 0) return null;
  return sheets[sheetIndex - 1]?.back ?? null;
}

export function ProvaWebSpiralMockup3D({
  pages,
  spiralMockup,
  pageUrl,
}: ProvaWebSpiralMockup3DProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SpiralSceneHandle | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotY: number;
    rotX: number;
  } | null>(null);
  const turningRef = useRef(false);
  const sheetIndexRef = useRef(0);
  const idleDirRef = useRef<1 | -1>(1);
  const engageRef = useRef<() => void>(() => {});

  const sheets = useMemo(() => buildSpiralSheets(pages), [pages]);

  const [sheetIndex, setSheetIndex] = useState(0);
  sheetIndexRef.current = sheetIndex;
  const [rotY, setRotY] = useState(DEFAULT_ROT_Y);
  const [rotX, setRotX] = useState(DEFAULT_ROT_X);
  const [zoom, setZoom] = useState(1);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rotYRef = useRef(DEFAULT_ROT_Y);
  const rotXRef = useRef(DEFAULT_ROT_X);
  const zoomRef = useRef(1);
  rotYRef.current = rotY;
  rotXRef.current = rotX;
  zoomRef.current = zoom;

  const edge = spiralMockup.edge === "top" ? "top" : "left";
  const totalSheets = sheets.length;
  const current = sheets[sheetIndex] ?? null;

  const kickRender = useCallback(() => {
    sceneRef.current?.requestRender();
  }, []);

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

  const turnTo = useCallback(
    async (
      nextSheet: number,
      opts?: { fromIdle?: boolean; timing?: SpiralTurnTiming },
    ) => {
      const handle = sceneRef.current;
      if (!handle || turningRef.current || !ready) return;
      const from = sheetIndexRef.current;
      const clamped = Math.max(0, Math.min(totalSheets - 1, nextSheet));
      if (clamped === from) return;
      const next = sheets[clamped];
      const leaving = sheets[from];
      if (!next || !leaving) return;
      if (!opts?.fromIdle) engageRef.current();
      turningRef.current = true;
      const dir: 1 | -1 = clamped > from ? 1 : -1;
      try {
        await handle.playPageTurn({
          dir,
          nextFrontUrl: pageUrl(next.front),
          blockBackUrl: (() => {
            if (dir > 0) {
              return leaving.back ? pageUrl(leaving.back) : null;
            }
            const prevVerso = previousSheetVerso(sheets, clamped);
            return prevVerso ? pageUrl(prevVerso) : null;
          })(),
          leafBackUrl: (() => {
            const leaf = dir > 0 ? leaving : next;
            return leaf.back ? pageUrl(leaf.back) : null;
          })(),
          timing: opts?.timing,
        });
        sheetIndexRef.current = clamped;
        setSheetIndex(clamped);
      } finally {
        turningRef.current = false;
      }
    },
    [pageUrl, ready, sheets, totalSheets],
  );

  const idleFlip = useCallback(async () => {
    if (!ready || totalSheets < 2 || turningRef.current) return;
    let next = sheetIndexRef.current + idleDirRef.current;
    if (next >= totalSheets) {
      idleDirRef.current = -1;
      next = sheetIndexRef.current - 1;
    } else if (next < 0) {
      idleDirRef.current = 1;
      next = sheetIndexRef.current + 1;
    }
    if (next < 0 || next >= totalSheets || next === sheetIndexRef.current) {
      return;
    }
    await turnTo(next, {
      fromIdle: true,
      timing: { durationMs: 700, settleMs: 40, fadeMs: 60 },
    });
  }, [ready, totalSheets, turnTo]);

  const { engage } = useIdleSpiralPageFlip({
    enabled: ready && totalSheets > 1,
    intervalMs: 1000,
    onFlip: idleFlip,
  });
  engageRef.current = engage;

  useEffect(() => {
    sceneRef.current?.setOrbit(rotX, rotY);
  }, [rotX, rotY]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;

    let cancelled = false;
    setReady(false);
    setError(null);
    setSheetIndex(0);
    sheetIndexRef.current = 0;
    idleDirRef.current = 1;

    const first = sheets[0];
    const initialFront = first ? pageUrl(first.front) : null;
    // Folha 0: sem anterior — verso do bloco vazio (papel)
    const initialBack = null;

    void (async () => {
      try {
        sceneRef.current?.dispose();
        sceneRef.current = null;
        const handle = await createSpiralScene(
          canvas,
          spiralMockup,
          initialFront,
          initialBack,
        );
        if (cancelled) {
          handle.dispose();
          return;
        }
        sceneRef.current = handle;
        const rect = stage.getBoundingClientRect();
        handle.resize(rect.width, Math.max(1, rect.height));
        handle.setOrbit(rotXRef.current, rotYRef.current);
        handle.setZoom(zoomRef.current);
        handle.render();
        setReady(true);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : "Falha ao iniciar o mockup 3D espiral.",
          );
        }
      }
    })();

    return () => {
      cancelled = true;
      sceneRef.current?.dispose();
      sceneRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spiralMockup, sheets.length]);

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

  const goPrev = useCallback(() => {
    engage();
    void turnTo(sheetIndexRef.current - 1);
  }, [engage, turnTo]);
  const goNext = useCallback(() => {
    engage();
    void turnTo(sheetIndexRef.current + 1);
  }, [engage, turnTo]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const t = event.target as HTMLElement;
      if (t.closest("button")) return;
      engage();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rotY: rotYRef.current,
        rotX: rotXRef.current,
      };
    },
    [engage],
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      const nextY = drag.rotY + dx * 0.45;
      const nextX = Math.max(
        -MAX_ROT_X,
        Math.min(MAX_ROT_X, drag.rotX - dy * 0.35),
      );
      setRotY(nextY);
      setRotX(nextX);
      sceneRef.current?.setOrbit(nextX, nextY);
    },
    [],
  );

  const endDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // já liberado
    }
  }, []);

  const onWheel = useCallback(
    (event: React.WheelEvent) => {
      event.preventDefault();
      engage();
      if (event.ctrlKey || event.metaKey) {
        if (Math.abs(event.deltaY) < 0.2) return;
        applyZoom(zoomRef.current * Math.exp(-event.deltaY * 0.002));
        return;
      }
      if (Math.abs(event.deltaY) < 2) return;
      if (event.deltaY > 0) void turnTo(sheetIndexRef.current + 1);
      else void turnTo(sheetIndexRef.current - 1);
    },
    [applyZoom, engage, turnTo],
  );

  const reset = () => {
    engage();
    setRotY(DEFAULT_ROT_Y);
    setRotX(DEFAULT_ROT_X);
    sceneRef.current?.setOrbit(DEFAULT_ROT_X, DEFAULT_ROT_Y);
    applyZoom(1);
  };

  return (
    <div
      className="prova-web-spiral-mockup"
      role="img"
      aria-label="Mockup 3D com espiral"
    >
      <p className="prova-web-spiral-mockup__hint">
        Folheia automaticamente no início · arraste para girar · scroll para
        folhear · Ctrl+scroll ou botões para zoom · espiral na{" "}
        {edge === "left" ? "esquerda" : "borda superior"}
      </p>
      <div
        ref={stageRef}
        className="prova-web-spiral-mockup__stage"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <canvas
          ref={canvasRef}
          className="prova-web-spiral-mockup__canvas"
          aria-hidden
        />
        {!ready && !error && (
          <p className="prova-web-spiral-mockup__loading">Carregando mockup…</p>
        )}
        {error && (
          <p className="prova-web-spiral-mockup__error">{error}</p>
        )}
      </div>
      <div className="prova-web-spiral-mockup__toolbar">
        <button
          type="button"
          onClick={goPrev}
          disabled={!ready || sheetIndex <= 0}
          title="Folha anterior"
          aria-label="Folha anterior"
        >
          <ChevronLeft className="size-3.5" aria-hidden />
        </button>
        <span className="prova-web-spiral-mockup__meta tabular-nums">
          {current
            ? `Folha ${sheetIndex + 1} / ${totalSheets}`
            : "—"}
        </span>
        <button
          type="button"
          onClick={goNext}
          disabled={!ready || sheetIndex >= totalSheets - 1}
          title="Próxima folha"
          aria-label="Próxima folha"
        >
          <ChevronRight className="size-3.5" aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            engage();
            nudgeZoom(-1);
          }}
          title="Diminuir zoom"
          aria-label="Diminuir zoom"
          disabled={!ready || zoom <= ZOOM_MIN + 0.001}
        >
          <ZoomOut className="size-3.5" aria-hidden />
        </button>
        <span className="prova-web-spiral-mockup__zoom-label tabular-nums">
          {Math.round(zoom * 100)}%
        </span>
        <button
          type="button"
          onClick={() => {
            engage();
            nudgeZoom(1);
          }}
          title="Aumentar zoom"
          aria-label="Aumentar zoom"
          disabled={!ready || zoom >= ZOOM_MAX - 0.001}
        >
          <ZoomIn className="size-3.5" aria-hidden />
        </button>
        <button type="button" onClick={reset} title="Resetar vista">
          <span className="inline-flex items-center gap-1.5">
            <RotateCcw className="size-3.5" aria-hidden />
            Vista
          </span>
        </button>
        <span className="prova-web-spiral-mockup__meta">
          {current?.front.page != null
            ? current.back
              ? `pág. ${current.front.page}+${current.back.page}`
              : `pág. ${current.front.page}`
            : ""}
          {" · "}
          {spiralMockup.holeCount} furos
        </span>
      </div>
    </div>
  );
}
