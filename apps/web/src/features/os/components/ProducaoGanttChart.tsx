import { useEffect, useRef, useState, type ReactNode } from "react";
import { Minus, Plus, Maximize2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { cn } from "@sagra/ui";

import type { FluxoEtapa, FluxoResumo } from "@/api/osFluxoProducao";

import { ProducaoGanttLegend } from "./ProducaoGanttLegend";
import {
  barClassForStatus,
  barLayout,
  buildTicks,
  buildTimeWindow,
  dateToPct,
  etapaStatusLabel,
  formatClock,
  parseFluxoDate,
  zoomForOneDay,
} from "./producaoGanttLayout";

interface ProducaoGanttChartProps {
  ano: number;
  osId: number;
  resumo: FluxoResumo;
  etapas: FluxoEtapa[];
  agoraLocal?: string | null;
}

const ZOOM_MIN = 0.5;
const ZOOM_STEP = 0.25;

function ZoomButton({
  onClick,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded border border-sagra-border bg-white px-2 text-[11px] text-slate-700",
        "hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40",
      )}
    >
      {children}
    </button>
  );
}

export function ProducaoGanttChart({
  ano,
  osId,
  resumo,
  etapas,
  agoraLocal,
}: ProducaoGanttChartProps) {
  const navigate = useNavigate();
  const window = buildTimeWindow(resumo);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const dayZoom = window ? zoomForOneDay(window.start, window.end) : 1;
  const zoomMax = Math.max(8, Math.ceil(dayZoom * 2));
  /** 1 = fluxo inteiro; dayZoom ≈ um dia na largura do viewport. */
  const [zoom, setZoom] = useState(dayZoom);
  const janelaKey = `${resumo.janela?.inicio ?? ""}|${resumo.janela?.fim ?? ""}`;

  useEffect(() => {
    setZoom(dayZoom);
  }, [janelaKey, dayZoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setContainerWidth(el.clientWidth);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (!window) {
    return (
      <p className="text-xs text-slate-600">
        Janela temporal indisponível para desenhar o Gantt.
      </p>
    );
  }

  const { start, end } = window;
  // Escala padrão: horas (um dia dividido em horas).
  const escala = "horas";
  const ticks = buildTicks(start, end, escala, resumo.tick_min || 60);
  const agora = parseFluxoDate(agoraLocal || resumo.agora);
  const agoraPct = agora ? dateToPct(agora, start, end) : null;
  const contentWidth =
    containerWidth > 0 ? Math.max(Math.round(containerWidth * zoom), 320) : undefined;

  const bumpZoom = (delta: number) => {
    setZoom((z) =>
      Math.min(zoomMax, Math.max(ZOOM_MIN, Math.round((z + delta) * 100) / 100)),
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-end gap-1">
        <span className="mr-auto text-[11px] text-slate-500">
          Escala em horas
          {Math.abs(zoom - dayZoom) < 0.05 ? " · visão ~1 dia" : ""}
        </span>
        <span className="mr-1 text-[11px] text-slate-500">
          Zoom {Math.round(zoom * 100)}%
        </span>
        <ZoomButton
          title="Diminuir zoom (ver mais tempo)"
          disabled={zoom <= ZOOM_MIN}
          onClick={() => bumpZoom(-ZOOM_STEP)}
        >
          <Minus className="size-3.5" />
        </ZoomButton>
        <ZoomButton
          title="Aumentar zoom (mais detalhe)"
          disabled={zoom >= zoomMax}
          onClick={() => bumpZoom(ZOOM_STEP)}
        >
          <Plus className="size-3.5" />
        </ZoomButton>
        <ZoomButton
          title="Exibir cerca de um dia dividido em horas"
          disabled={Math.abs(zoom - dayZoom) < 0.01}
          onClick={() => setZoom(dayZoom)}
        >
          1 dia
        </ZoomButton>
        <ZoomButton
          title="Abrir visão completa do fluxo"
          onClick={() => {
            void navigate({
              to: "/os/$ano/$id/fluxo-producao",
              params: { ano: String(ano), id: String(osId) },
            });
          }}
        >
          <Maximize2 className="size-3.5" />
          Ver tudo
        </ZoomButton>
      </div>

      <div
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto rounded-md border border-sagra-border"
      >
        <div style={contentWidth ? { width: contentWidth } : { width: "100%" }}>
          <div className="sticky top-0 z-10 grid grid-cols-[minmax(200px,240px)_1fr] border-b border-sagra-border bg-slate-50 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            <div className="grid grid-cols-[1.4fr_0.7fr_0.7fr_0.9fr] gap-1 px-2 py-2">
              <span>Etapa</span>
              <span>Início</span>
              <span>Fim</span>
              <span>Status</span>
            </div>
            <div className="relative px-2 py-2">
              {ticks.map((t) => (
                <span
                  key={t.at.toISOString()}
                  className="absolute top-2 -translate-x-1/2"
                  style={{ left: `${t.pct}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          <div className="relative">
            {etapas.map((etapa) => {
              const previsto = barLayout(
                etapa.previsto_inicio,
                etapa.previsto_fim,
                start,
                end,
              );
              const real = barLayout(
                etapa.real_inicio,
                etapa.real_fim ||
                  (etapa.real_inicio ? agoraLocal || resumo.agora : null),
                start,
                end,
              );
              return (
                <div
                  key={etapa.id}
                  className="grid grid-cols-[minmax(200px,240px)_1fr] border-b border-slate-100 text-xs"
                >
                  <div className="grid grid-cols-[1.4fr_0.7fr_0.7fr_0.9fr] gap-1 px-2 py-2">
                    <div className="font-medium text-slate-800">
                      <span className="text-slate-400">
                        {Math.round(etapa.ordem / 10)}.{" "}
                      </span>
                      {etapa.rotulo}
                      {etapa.medicao === "estimada" ? (
                        <span className="ml-1 text-[10px] text-slate-400">
                          (est.)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-slate-600">
                      {formatClock(etapa.previsto_inicio)}
                    </div>
                    <div className="text-slate-600">
                      {formatClock(etapa.previsto_fim)}
                    </div>
                    <div className="text-slate-700">
                      {etapaStatusLabel(etapa.status)}
                      {etapa.progresso_pct != null ? (
                        <span className="ml-1 text-[10px] text-sky-700">
                          {etapa.progresso_pct}%
                          {etapa.progresso_estimado ? "*" : ""}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="relative h-10 bg-[linear-gradient(to_right,rgba(148,163,184,0.12)_1px,transparent_1px)] bg-[length:40px_100%]">
                    {agoraPct != null ? (
                      <div
                        className="pointer-events-none absolute bottom-0 top-0 z-[4] border-l border-dashed border-sky-600/80"
                        style={{ left: `${agoraPct}%` }}
                      />
                    ) : null}
                    {previsto ? (
                      <div
                        className="absolute top-2 h-6 rounded-sm border border-dashed border-slate-400/80 bg-transparent"
                        style={{
                          left: `${previsto.leftPct}%`,
                          width: `${previsto.widthPct}%`,
                        }}
                        title="Previsto pelo sistema"
                      />
                    ) : null}
                    {real ? (
                      <div
                        className={cn(
                          "absolute top-2.5 z-[2] h-5 rounded-sm",
                          barClassForStatus(etapa.status, etapa.medicao),
                        )}
                        style={{
                          left: `${real.leftPct}%`,
                          width: `${real.widthPct}%`,
                        }}
                      >
                        {etapa.progresso_pct != null &&
                        etapa.status === "em_execucao" ? (
                          <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white">
                            {etapa.progresso_pct}%
                          </span>
                        ) : null}
                      </div>
                    ) : previsto &&
                      (etapa.status === "pendente" ||
                        etapa.status === "atrasado") ? (
                      <div
                        className={cn(
                          "absolute top-2.5 z-[2] h-5 rounded-sm",
                          barClassForStatus(etapa.status, etapa.medicao),
                        )}
                        style={{
                          left: `${previsto.leftPct}%`,
                          width: `${previsto.widthPct}%`,
                        }}
                      />
                    ) : null}
                    {(etapa.pausas || []).map((p, idx) => {
                      const band = barLayout(p.inicio, p.fim, start, end);
                      if (!band) return null;
                      return (
                        <div
                          key={`${etapa.id}-pausa-${idx}`}
                          className="absolute top-1 z-[3] h-8 rounded-sm bg-[repeating-linear-gradient(135deg,#fde68a_0_4px,#fbbf24_4px_8px)] opacity-70"
                          style={{
                            left: `${band.leftPct}%`,
                            width: `${band.widthPct}%`,
                          }}
                          title={`Pausa: ${p.situacao || "cliente"}`}
                        />
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
          {agoraPct != null ? (
            <div className="px-2 pb-1 text-[10px] font-semibold text-sky-700">
              Agora – {formatClock(agoraLocal || resumo.agora)}
            </div>
          ) : null}
        </div>

        <ProducaoGanttLegend />
      </div>
    </div>
  );
}
