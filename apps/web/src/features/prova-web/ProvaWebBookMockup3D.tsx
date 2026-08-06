import { RotateCcw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ProvaWebBookMockupMeta, ProvaWebPageMeta } from "@/api/provaWeb";

import { useIdleYawSpin } from "./useIdleYawSpin";
import "./prova-web-book-mockup.css";

const DEFAULT_ROT_Y = -28;
const DEFAULT_ROT_X = 12;
const MAX_ROT_X = 25;

export interface ProvaWebBookMockup3DProps {
  pages: ProvaWebPageMeta[];
  bookMockup: ProvaWebBookMockupMeta;
  pageUrl: (page: ProvaWebPageMeta) => string;
  spineUrl?: string | null;
}

export function ProvaWebBookMockup3D({
  pages,
  bookMockup,
  pageUrl,
  spineUrl,
}: ProvaWebBookMockup3DProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    rotY: number;
    rotX: number;
  } | null>(null);

  const [rotY, setRotY] = useState(DEFAULT_ROT_Y);
  const [rotX, setRotX] = useState(DEFAULT_ROT_X);
  const [size, setSize] = useState({ width: 280, height: 400, depth: 24 });
  const rotYRef = useRef(DEFAULT_ROT_Y);
  rotYRef.current = rotY;

  const front = useMemo(
    () => pages.find((p) => p.role === "cover-front" && !p.blank) ?? null,
    [pages],
  );
  const back = useMemo(
    () => pages.find((p) => p.role === "cover-back" && !p.blank) ?? null,
    [pages],
  );

  const frontUrl = front ? pageUrl(front) : null;
  const backUrl = back ? pageUrl(back) : null;

  const { engage } = useIdleYawSpin({
    speedPerSec: 18, // graus/s
    onTick: (dDeg) => {
      setRotY((y) => y + dDeg);
    },
  });

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const measure = () => {
      const availW = Math.max(160, el.clientWidth - 48);
      const availH = Math.max(200, el.clientHeight - 24);
      const pageW = Math.max(40, bookMockup.pageWidthMm);
      const pageH = Math.max(40, bookMockup.pageHeightMm);
      const lombada = Math.max(0.5, bookMockup.lombadaMm);
      // Escala para a face caber na viewport; espessura sobra à parte.
      const scale = Math.min(availW / (pageW + lombada), availH / pageH);
      setSize({
        width: Math.round(pageW * scale),
        height: Math.round(pageH * scale),
        depth: Math.max(4, Math.round(lombada * scale)),
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [bookMockup.lombadaMm, bookMockup.pageHeightMm, bookMockup.pageWidthMm]);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      engage();
      event.currentTarget.setPointerCapture(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        rotY: rotYRef.current,
        rotX,
      };
    },
    [engage, rotX],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    setRotY(drag.rotY + dx * 0.45);
    setRotX(Math.max(-MAX_ROT_X, Math.min(MAX_ROT_X, drag.rotX - dy * 0.35)));
  }, []);

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
    },
    [engage],
  );

  const reset = () => {
    setRotY(DEFAULT_ROT_Y);
    setRotX(DEFAULT_ROT_X);
  };

  const { width: w, height: h, depth: d } = size;
  const halfD = d / 2;

  return (
    <div className="prova-web-book-mockup" role="img" aria-label="Mockup 3D do livro">
      <p className="prova-web-book-mockup__hint">
        Clique ou scroll para interagir · arraste para girar · lombada{" "}
        {bookMockup.lombadaMm.toFixed(1)} mm
      </p>
      <div
        ref={stageRef}
        className="prova-web-book-mockup__stage"
        style={{ perspective: 1200, perspectiveOrigin: "50% 42%" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onWheel={onWheel}
      >
        <div
          className="prova-web-book-mockup__scene"
          style={{
            width: w,
            height: h,
            transform: `rotateX(${rotX}deg) rotateY(${rotY}deg)`,
          }}
        >
          {/* Frente (capa 1) */}
          <div
            className="prova-web-book-mockup__face prova-web-book-mockup__face--front"
            style={{
              width: w,
              height: h,
              transform: `translateZ(${halfD}px)`,
              backgroundImage: frontUrl ? `url("${frontUrl}")` : undefined,
            }}
            title="Capa"
          />
          {/* Fundo (capa 4) — normal aponta para -Z; imagem não espelhada no verso físico */}
          <div
            className="prova-web-book-mockup__face prova-web-book-mockup__face--back"
            style={{
              width: w,
              height: h,
              transform: `rotateY(180deg) translateZ(${halfD}px)`,
              backgroundImage: backUrl ? `url("${backUrl}")` : undefined,
            }}
            title="Contracapa"
          />
          {/* Lombada */}
          <div
            className={
              spineUrl
                ? "prova-web-book-mockup__face prova-web-book-mockup__face--spine"
                : "prova-web-book-mockup__face prova-web-book-mockup__face--spine prova-web-book-mockup__face--spine-solid"
            }
            style={{
              width: d,
              height: h,
              left: w / 2 - halfD,
              transform: `rotateY(-90deg) translateZ(${w / 2}px)`,
              backgroundImage: spineUrl ? `url("${spineUrl}")` : undefined,
            }}
            title="Lombada"
          />
          {/* Corte miolo (lado oposto à lombada) */}
          <div
            className="prova-web-book-mockup__face prova-web-book-mockup__face--block"
            style={{
              width: d,
              height: h,
              left: w / 2 - halfD,
              transform: `rotateY(90deg) translateZ(${w / 2}px)`,
            }}
            title="Miolo"
          />
          {/* Topo */}
          <div
            className="prova-web-book-mockup__face prova-web-book-mockup__face--edge"
            style={{
              width: w,
              height: d,
              top: h / 2 - halfD,
              transform: `rotateX(90deg) translateZ(${h / 2}px)`,
            }}
          />
          {/* Base */}
          <div
            className="prova-web-book-mockup__face prova-web-book-mockup__face--edge"
            style={{
              width: w,
              height: d,
              top: h / 2 - halfD,
              transform: `rotateX(-90deg) translateZ(${h / 2}px)`,
            }}
          />
        </div>
      </div>
      <div className="prova-web-book-mockup__toolbar">
        <button type="button" onClick={reset}>
          <span className="inline-flex items-center gap-1.5">
            <RotateCcw className="size-3.5" aria-hidden />
            Resetar vista
          </span>
        </button>
        <span className="prova-web-book-mockup__meta">
          {bookMockup.pageWidthMm.toFixed(0)}×{bookMockup.pageHeightMm.toFixed(0)}{" "}
          mm
        </span>
      </div>
    </div>
  );
}
