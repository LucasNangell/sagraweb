import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import {
  arredondarMm,
  estimarPaginaPelaGrade,
  folhaMm,
  formatMm,
  problemasDeSlots,
  resolverSlots,
} from "./perfilUtils";
import type { Face, PerfilImposicao } from "./types";

type Props = {
  perfil: PerfilImposicao;
  face: Face;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  /** Move um slot (apenas posicionamento manual): novo CENTRO da página. */
  onMove: (id: number, cx: number, cy: number) => void;
  /** URL da miniatura do PDF de marcas (fundo). */
  backgroundUrl?: string | null;
};

const SNAP_MM = 0.5;
/** Faixa das réguas e folga, em pixels de tela (não escalam com a folha). */
const RULER_PX = 22;
const PAD_PX = 10;
const RULER_FONT_PX = 10;
/** Distância mínima entre rótulos da régua. */
const MIN_TICK_GAP_PX = 44;
const TICK_STEPS_MM = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

function snap(n: number): number {
  return arredondarMm(Math.round(n / SNAP_MM) * SNAP_MM);
}

/** Largura do container e altura útil da janela (para caber a folha inteira). */
function useAvailableSize(ref: React.RefObject<HTMLDivElement | null>, remountKey: unknown) {
  const [size, setSize] = useState({ w: 640, h: 520 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // −2: borda de 1 px dos dois lados da moldura.
      const w = Math.max(160, (el.clientWidth || 642) - 2);
      const top = el.getBoundingClientRect().top;
      const viewport = typeof window !== "undefined" ? window.innerHeight : 800;
      // Altura que cabe na tela a partir do topo do preview (mín. 280 px).
      const h = Math.max(280, Math.min(viewport * 0.78, viewport - Math.max(0, top) - 56));
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [ref, remountKey]);
  return size;
}

export function PerfilImposicaoPreview({
  perfil,
  face,
  selectedId,
  onSelect,
  onMove,
  backgroundUrl,
}: Props) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const sheetRef = useRef<SVGGElement | null>(null);
  const [bgOk, setBgOk] = useState(true);
  const [drag, setDrag] = useState<{
    id: number;
    dx: number;
    dy: number;
    /** Centro durante o arraste. */
    cx: number;
    cy: number;
    w: number;
    h: number;
  } | null>(null);
  const folha = folhaMm(perfil);
  const avail = useAvailableSize(boxRef, Boolean(folha));

  useEffect(() => setBgOk(true), [backgroundUrl]);

  const estimate = perfil.pagina.fonte === "pdf" ? estimarPaginaPelaGrade(perfil) : null;
  const slots = useMemo(() => resolverSlots(perfil, face, estimate), [perfil, face, estimate]);
  const problemas = useMemo(
    () => problemasDeSlots(perfil, face, estimate),
    [perfil, face, estimate],
  );
  const manual = perfil.posicionamento === "manual";

  /** Ponto da tela → mm da folha (usa a transformação do grupo da folha). */
  const toMm = useCallback((clientX: number, clientY: number) => {
    const g = sheetRef.current;
    const svg = g?.ownerSVGElement;
    if (!g || !svg) return null;
    const ctm = g.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  // Escala: a folha inteira cabe na largura e na altura disponíveis.
  const layout = useMemo(() => {
    if (!folha) return null;
    const innerW = Math.max(120, avail.w - RULER_PX - 2 * PAD_PX);
    const innerH = Math.max(120, avail.h - RULER_PX - 2 * PAD_PX);
    const k = Math.min(innerW / folha.w, innerH / folha.h);
    const sheetW = folha.w * k;
    const sheetH = folha.h * k;
    const offX = RULER_PX + PAD_PX + Math.max(0, (innerW - sheetW) / 2);
    const offY = RULER_PX + PAD_PX;
    const step =
      TICK_STEPS_MM.find((s) => s * k >= MIN_TICK_GAP_PX) ?? TICK_STEPS_MM[TICK_STEPS_MM.length - 1]!;
    return {
      k,
      sheetW,
      sheetH,
      offX,
      offY,
      svgW: avail.w,
      svgH: offY + sheetH + PAD_PX,
      step,
    };
  }, [folha, avail.w, avail.h]);

  if (!folha || !layout) {
    return (
      <div ref={boxRef} className="w-full">
        <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
          Informe o tamanho da folha para ver o preview.
        </div>
      </div>
    );
  }

  const { k, offX, offY, sheetW, sheetH, step } = layout;
  /** 1 px de tela em mm (traços finos e nítidos em qualquer zoom). */
  const px = 1 / k;
  const ticksX = Array.from({ length: Math.floor(folha.w / step) + 1 }, (_, i) => i * step);
  const ticksY = Array.from({ length: Math.floor(folha.h / step) + 1 }, (_, i) => i * step);
  const sangria = perfil.sangria_mm || 0;

  const handlePointerDown = (
    e: React.PointerEvent,
    slot: { id: number; cx_mm: number; cy_mm: number; largura_mm: number; altura_mm: number },
  ) => {
    e.stopPropagation();
    onSelect(slot.id);
    if (!manual) return;
    const p = toMm(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({
      id: slot.id,
      dx: p.x - slot.cx_mm,
      dy: p.y - slot.cy_mm,
      cx: slot.cx_mm,
      cy: slot.cy_mm,
      w: slot.largura_mm,
      h: slot.altura_mm,
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toMm(e.clientX, e.clientY);
    if (!p) return;
    setDrag({ ...drag, cx: snap(p.x - drag.dx), cy: snap(p.y - drag.dy) });
  };

  const handlePointerUp = () => {
    if (!drag) return;
    onMove(drag.id, drag.cx, drag.cy);
    setDrag(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!manual || selectedId == null) return;
    const delta = e.shiftKey ? 1 : 0.1;
    const slot = slots.find((s) => s.id === selectedId);
    if (!slot) return;
    let { cx_mm: x, cy_mm: y } = slot;
    if (e.key === "ArrowLeft") x -= delta;
    else if (e.key === "ArrowRight") x += delta;
    else if (e.key === "ArrowUp") y -= delta;
    else if (e.key === "ArrowDown") y += delta;
    else if (e.key === "Escape") {
      onSelect(null);
      return;
    } else return;
    e.preventDefault();
    onMove(slot.id, arredondarMm(x), arredondarMm(y));
  };

  return (
    <div ref={boxRef} className="flex w-full flex-col gap-1.5">
      <div className="w-full overflow-hidden rounded-lg border border-slate-300 bg-slate-100">
        <svg
          width={layout.svgW}
          height={layout.svgH}
          viewBox={`0 0 ${layout.svgW} ${layout.svgH}`}
          className="block touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-secondary-blue/40"
          role="application"
          tabIndex={0}
          aria-label={`Folha ${formatMm(folha.w)} × ${formatMm(folha.h)} mm com ${slots.length} slots (${face}). ${manual ? "Arraste os slots ou use as setas do teclado." : ""}`}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onPointerDown={() => onSelect(null)}
          onKeyDown={handleKeyDown}
          data-testid="perfil-imposicao-preview"
        >
          {/* Réguas (pixels de tela, tamanho fixo) */}
          <g fontSize={RULER_FONT_PX} fill="#64748b" className="pointer-events-none">
            <rect x={offX} y={offY - RULER_PX} width={sheetW} height={RULER_PX - 4} fill="#e2e8f0" />
            <rect x={offX - RULER_PX} y={offY} width={RULER_PX - 4} height={sheetH} fill="#e2e8f0" />
            {ticksX.map((t) => (
              <g key={`rx-${t}`}>
                <line x1={offX + t * k} x2={offX + t * k} y1={offY - 9} y2={offY - 4} stroke="#94a3b8" />
                <text x={offX + t * k} y={offY - 11} textAnchor="middle">
                  {t}
                </text>
              </g>
            ))}
            {/* Régua vertical conta de baixo para cima (Y do usuário). */}
            {ticksY.map((t) => {
              const ty = offY + (folha.h - t) * k;
              return (
                <g key={`ry-${t}`}>
                  <line x1={offX - 9} x2={offX - 4} y1={ty} y2={ty} stroke="#94a3b8" />
                  <text
                    x={offX - 11}
                    y={ty}
                    textAnchor="middle"
                    dominantBaseline="central"
                    transform={`rotate(-90 ${offX - 11} ${ty})`}
                  >
                    {t}
                  </text>
                </g>
              );
            })}
          </g>

          {/* Folha em mm (escala k px/mm) */}
          <g ref={sheetRef} transform={`translate(${offX} ${offY}) scale(${k})`}>
            <rect x={0} y={0} width={folha.w} height={folha.h} fill="#ffffff" stroke="#64748b" strokeWidth={px} />
            {backgroundUrl && bgOk ? (
              <image
                href={backgroundUrl}
                x={0}
                y={0}
                width={folha.w}
                height={folha.h}
                preserveAspectRatio="none"
                opacity={0.55}
                onError={() => setBgOk(false)}
              />
            ) : null}

            {slots.map((slot) => {
              const moving = drag && drag.id === slot.id ? drag : null;
              const x = moving ? moving.cx - moving.w / 2 : slot.x_mm;
              const y = moving ? moving.cy - moving.h / 2 : slot.y_mm;
              const prob = problemas.get(slot.id);
              const selected = selectedId === slot.id;
              const color =
                prob === "fora" ? "#dc2626" : prob === "sobrepoe" ? "#d97706" : face === "verso" ? "#7c3aed" : "#2563eb";
              const cx = x + slot.largura_mm / 2;
              const cy = y + slot.altura_mm / 2;
              // Texto proporcional ao slot, mas legível (entre 9 e 28 px de tela).
              const font = Math.min(28 * px, Math.max(9 * px, Math.min(slot.largura_mm, slot.altura_mm) * 0.2));
              return (
                <g
                  key={`${face}-${slot.id}`}
                  className={manual ? "cursor-move" : "cursor-pointer"}
                  onPointerDown={(e) => handlePointerDown(e, slot)}
                >
                  {sangria > 0 ? (
                    <rect
                      x={x - sangria}
                      y={y - sangria}
                      width={slot.largura_mm + 2 * sangria}
                      height={slot.altura_mm + 2 * sangria}
                      fill="none"
                      stroke={color}
                      strokeOpacity={0.35}
                      strokeDasharray={`${4 * px}`}
                      strokeWidth={px}
                    />
                  ) : null}
                  <rect
                    x={x}
                    y={y}
                    width={slot.largura_mm}
                    height={slot.altura_mm}
                    fill={color}
                    fillOpacity={selected ? 0.24 : 0.12}
                    stroke={color}
                    strokeWidth={selected ? 2.5 * px : 1.25 * px}
                  />
                  {/* Centro da página = referência do X/Y */}
                  <g stroke={color} strokeWidth={1.2 * px} className="pointer-events-none">
                    <line x1={cx - 7 * px} x2={cx + 7 * px} y1={cy} y2={cy} />
                    <line x1={cx} x2={cx} y1={cy - 7 * px} y2={cy + 7 * px} />
                  </g>
                  <text
                    x={cx}
                    y={cy - font * 0.9}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={font}
                    fontWeight={700}
                    fill={color}
                    className="pointer-events-none"
                  >
                    {slot.id}
                  </text>
                  <text
                    x={cx}
                    y={cy + font * 0.85}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={font * 0.5}
                    fill={color}
                    className="pointer-events-none"
                  >
                    pág. {slot.pagina}
                    {slot.rotacao ? ` · ${slot.rotacao}°` : ""}
                  </text>
                  {/* Seta indicando o topo da arte (rotação) */}
                  <g transform={`rotate(${-slot.rotacao} ${cx} ${cy})`} className="pointer-events-none">
                    <path
                      d={`M ${cx} ${cy - font * 2} l ${font * 0.3} ${font * 0.4} h ${-font * 0.6} z`}
                      fill={color}
                      fillOpacity={0.8}
                    />
                  </g>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
      <p className="text-[10px] text-slate-500">
        {manual
          ? "X/Y = centro da página, medido do canto inferior esquerdo da folha (Y para cima). Arraste para mover (encaixe 0,5 mm); com o slot selecionado, setas movem 0,1 mm e Shift + setas 1 mm."
          : "Posições calculadas pela grade. Para arrastar, mude o posicionamento para manual."}
        {perfil.pagina.fonte === "pdf" ? " Tamanho da página estimado: o real vem do PDF na geração." : ""}
        {drag ? ` Centro X ${formatMm(drag.cx)} · Y ${formatMm(folha.h - drag.cy)} mm` : ""}
      </p>
    </div>
  );
}
