import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
  /** Move um slot (apenas posicionamento manual). */
  onMove: (id: number, x: number, y: number) => void;
  /** URL da miniatura do PDF de marcas (fundo). */
  backgroundUrl?: string | null;
};

const SNAP_MM = 0.5;

function snap(n: number): number {
  return arredondarMm(Math.round(n / SNAP_MM) * SNAP_MM);
}

function rulerStep(maxSide: number): number {
  if (maxSide > 600) return 100;
  if (maxSide > 250) return 50;
  return 25;
}

export function PerfilImposicaoPreview({
  perfil,
  face,
  selectedId,
  onSelect,
  onMove,
  backgroundUrl,
}: Props) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [bgOk, setBgOk] = useState(true);
  const [drag, setDrag] = useState<{
    id: number;
    dx: number;
    dy: number;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => setBgOk(true), [backgroundUrl]);

  const folha = folhaMm(perfil);
  const estimate = perfil.pagina.fonte === "pdf" ? estimarPaginaPelaGrade(perfil) : null;
  const slots = useMemo(() => resolverSlots(perfil, face, estimate), [perfil, face, estimate]);
  const problemas = useMemo(
    () => problemasDeSlots(perfil, face, estimate),
    [perfil, face, estimate],
  );
  const manual = perfil.posicionamento === "manual";

  const toMm = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }, []);

  if (!folha) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        Informe o tamanho da folha para ver o preview.
      </div>
    );
  }

  const maxSide = Math.max(folha.w, folha.h);
  const margin = maxSide * 0.06;
  const step = rulerStep(maxSide);
  const stroke = maxSide * 0.0025;
  const fontRuler = maxSide * 0.022;
  const ticksX = Array.from({ length: Math.floor(folha.w / step) + 1 }, (_, i) => i * step);
  const ticksY = Array.from({ length: Math.floor(folha.h / step) + 1 }, (_, i) => i * step);
  const sangria = perfil.sangria_mm || 0;

  const handlePointerDown = (e: React.PointerEvent, id: number, x: number, y: number) => {
    e.stopPropagation();
    onSelect(id);
    if (!manual) return;
    const p = toMm(e.clientX, e.clientY);
    if (!p) return;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    setDrag({ id, dx: p.x - x, dy: p.y - y, x, y });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!drag) return;
    const p = toMm(e.clientX, e.clientY);
    if (!p) return;
    setDrag({ ...drag, x: snap(p.x - drag.dx), y: snap(p.y - drag.dy) });
  };

  const handlePointerUp = () => {
    if (!drag) return;
    onMove(drag.id, drag.x, drag.y);
    setDrag(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!manual || selectedId == null) return;
    const delta = e.shiftKey ? 1 : 0.1;
    const slot = slots.find((s) => s.id === selectedId);
    if (!slot) return;
    let { x_mm: x, y_mm: y } = slot;
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
    <div className="flex flex-col gap-1.5">
      <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-100 p-2">
        <svg
          ref={svgRef}
          viewBox={`${-margin} ${-margin} ${folha.w + margin * 1.4} ${folha.h + margin * 1.4}`}
          className="mx-auto block w-full max-h-[62vh] touch-none select-none outline-none focus-visible:ring-2 focus-visible:ring-secondary-blue/40"
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
          {/* Réguas */}
          <g fill="#64748b" fontSize={fontRuler}>
            {ticksX.map((t) => (
              <g key={`rx-${t}`}>
                <line x1={t} x2={t} y1={-margin * 0.35} y2={0} stroke="#94a3b8" strokeWidth={stroke} />
                <text x={t} y={-margin * 0.45} textAnchor="middle">
                  {t}
                </text>
              </g>
            ))}
            {ticksY.map((t) => (
              <g key={`ry-${t}`}>
                <line x1={-margin * 0.35} x2={0} y1={t} y2={t} stroke="#94a3b8" strokeWidth={stroke} />
                <text x={-margin * 0.45} y={t} textAnchor="end" dominantBaseline="central">
                  {t}
                </text>
              </g>
            ))}
          </g>

          {/* Folha */}
          <rect x={0} y={0} width={folha.w} height={folha.h} fill="#ffffff" stroke="#64748b" strokeWidth={stroke} />
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
            const x = moving ? moving.x : slot.x_mm;
            const y = moving ? moving.y : slot.y_mm;
            const prob = problemas.get(slot.id);
            const selected = selectedId === slot.id;
            const color = prob === "fora" ? "#dc2626" : prob === "sobrepoe" ? "#d97706" : face === "verso" ? "#7c3aed" : "#2563eb";
            const cx = x + slot.largura_mm / 2;
            const cy = y + slot.altura_mm / 2;
            const font = Math.min(slot.largura_mm, slot.altura_mm) * 0.22;
            return (
              <g
                key={`${face}-${slot.id}`}
                className={manual ? "cursor-move" : "cursor-pointer"}
                onPointerDown={(e) => handlePointerDown(e, slot.id, slot.x_mm, slot.y_mm)}
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
                    strokeDasharray={`${stroke * 4}`}
                    strokeWidth={stroke}
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
                  strokeWidth={selected ? stroke * 2.4 : stroke * 1.2}
                />
                <text
                  x={cx}
                  y={cy}
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
                  y={cy + font * 0.95}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize={font * 0.42}
                  fill={color}
                  className="pointer-events-none"
                >
                  pág. {slot.pagina}
                  {slot.rotacao ? ` · ${slot.rotacao}°` : ""}
                </text>
                {/* Seta indicando o topo da arte (rotação) */}
                <g transform={`rotate(${-slot.rotacao} ${cx} ${cy})`} className="pointer-events-none">
                  <path
                    d={`M ${cx} ${cy - font * 1.55} l ${font * 0.3} ${font * 0.4} h ${-font * 0.6} z`}
                    fill={color}
                    fillOpacity={0.8}
                  />
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-[10px] text-slate-500">
        {manual
          ? "Arraste para mover (encaixe 0,5 mm). Com o slot selecionado: setas movem 0,1 mm, Shift + setas 1 mm."
          : "Posições calculadas pela grade. Para arrastar, mude o posicionamento para manual."}
        {perfil.pagina.fonte === "pdf" ? " Tamanho da página estimado: o real vem do PDF na geração." : ""}
        {drag ? ` X ${formatMm(drag.x)} · Y ${formatMm(drag.y)} mm` : ""}
      </p>
    </div>
  );
}
