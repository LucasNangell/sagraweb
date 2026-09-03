import type { ReactNode } from "react";
import { cn } from "@sagra/ui";

import type { FluxoEtapa, FluxoResumo } from "@/api/osFluxoProducao";

import { ProducaoGanttLegend } from "./ProducaoGanttLegend";
import {
  GANTT_COL_ETAPA_PX,
  GANTT_COL_FIM_PX,
  GANTT_COL_INICIO_PX,
  GANTT_COL_STATUS_PX,
  GANTT_PX_PER_HOUR,
  alignHourGrid,
  barClassForStatus,
  barLayoutPx,
  buildHourColumns,
  dateToPct,
  etapaStatusLabel,
  formatClock,
  ganttMetaWidthPx,
  parseFluxoDate,
  timelineWidthPx,
} from "./producaoGanttLayout";

interface ProducaoGanttFullChartProps {
  resumo: FluxoResumo;
  etapas: FluxoEtapa[];
  agoraLocal?: string | null;
}

function MetaCells({
  etapa,
  inicio,
  fim,
  status,
  header,
}: {
  etapa: ReactNode;
  inicio: ReactNode;
  fim: ReactNode;
  status: ReactNode;
  header?: boolean;
}) {
  const cell = header
    ? "flex items-center px-2 py-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500"
    : "flex items-center px-2 py-1.5 text-xs";
  return (
    <div
      className="grid h-full"
      style={{
        gridTemplateColumns: `${GANTT_COL_ETAPA_PX}px ${GANTT_COL_INICIO_PX}px ${GANTT_COL_FIM_PX}px ${GANTT_COL_STATUS_PX}px`,
        width: ganttMetaWidthPx(),
      }}
    >
      <div className={cn(cell, "min-w-0 border-r border-slate-200")}>{etapa}</div>
      <div className={cn(cell, "tabular-nums text-slate-600 border-r border-slate-200")}>
        {inicio}
      </div>
      <div className={cn(cell, "tabular-nums text-slate-600 border-r border-slate-200")}>
        {fim}
      </div>
      <div className={cn(cell, "min-w-0 text-slate-700")}>{status}</div>
    </div>
  );
}

export function ProducaoGanttFullChart({
  resumo,
  etapas,
  agoraLocal,
}: ProducaoGanttFullChartProps) {
  const window = (() => {
    const start =
      parseFluxoDate(resumo.janela?.inicio) ||
      parseFluxoDate(resumo.inicio_producao_em);
    const end = parseFluxoDate(resumo.janela?.fim);
    if (!start || !end || end <= start) return null;
    return alignHourGrid(start, end);
  })();

  if (!window) {
    return (
      <p className="text-xs text-slate-600">
        Janela temporal indisponível para desenhar o Gantt.
      </p>
    );
  }

  const { start, end } = window;
  const hours = buildHourColumns(start, end);
  const timelineW = timelineWidthPx(hours);
  const metaW = ganttMetaWidthPx();
  const agora = parseFluxoDate(agoraLocal || resumo.agora);
  const agoraPct = agora ? dateToPct(agora, start, end) : null;
  const agoraLeft = agoraPct != null ? (agoraPct / 100) * timelineW : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-md border border-sagra-border bg-white">
      <div className="min-h-0 flex-1 overflow-auto">
        <div style={{ minWidth: metaW + timelineW }}>
          <div className="sticky top-0 z-30 flex border-b border-sagra-border">
            <div
              className="sticky left-0 z-40 shrink-0 bg-slate-50 shadow-[2px_0_6px_rgba(15,23,42,0.08)]"
              style={{ width: metaW }}
            >
              <MetaCells header etapa="Etapa" inicio="Início" fim="Fim" status="Status" />
            </div>
            <div className="flex bg-slate-50" style={{ width: timelineW }}>
              {hours.map((h) => {
                const parts = h.label.split(" ");
                const time = parts.length > 1 ? parts[1] : parts[0];
                const date = parts.length > 1 ? parts[0] : null;
                return (
                  <div
                    key={h.at.toISOString()}
                    className="flex shrink-0 flex-col items-center justify-center border-r border-slate-200 px-0.5 py-1 text-center font-semibold tabular-nums text-slate-600"
                    style={{ width: h.widthPx }}
                    title={h.label}
                  >
                    {date ? (
                      <span className="text-[9px] font-medium text-slate-400">{date}</span>
                    ) : null}
                    <span className="text-[10px]">{time}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {etapas.map((etapa) => {
            const previsto = barLayoutPx(
              etapa.previsto_inicio,
              etapa.previsto_fim,
              start,
              end,
              timelineW,
            );
            const real = barLayoutPx(
              etapa.real_inicio,
              etapa.real_fim ||
                (etapa.real_inicio ? agoraLocal || resumo.agora : null),
              start,
              end,
              timelineW,
            );
            return (
              <div
                key={etapa.id}
                className="flex border-b border-slate-100"
                style={{ minHeight: 44 }}
              >
                <div
                  className="sticky left-0 z-20 shrink-0 bg-white shadow-[2px_0_6px_rgba(15,23,42,0.06)]"
                  style={{ width: metaW }}
                >
                  <MetaCells
                    etapa={
                      <span className="truncate font-medium text-slate-800" title={etapa.rotulo}>
                        <span className="text-slate-400">
                          {Math.round(etapa.ordem / 10)}.{" "}
                        </span>
                        {etapa.rotulo}
                        {etapa.medicao === "estimada" ? (
                          <span className="ml-1 text-[10px] text-slate-400">(est.)</span>
                        ) : null}
                      </span>
                    }
                    inicio={formatClock(etapa.previsto_inicio)}
                    fim={formatClock(etapa.previsto_fim)}
                    status={
                      <span className="truncate" title={etapaStatusLabel(etapa.status)}>
                        {etapaStatusLabel(etapa.status)}
                        {etapa.progresso_pct != null ? (
                          <span className="ml-1 text-[10px] text-sky-700">
                            {etapa.progresso_pct}%
                            {etapa.progresso_estimado ? "*" : ""}
                          </span>
                        ) : null}
                      </span>
                    }
                  />
                </div>
                <div
                  className="relative"
                  style={{
                    width: timelineW,
                    backgroundImage: `repeating-linear-gradient(to right, rgba(148,163,184,0.18) 0, rgba(148,163,184,0.18) 1px, transparent 1px, transparent ${GANTT_PX_PER_HOUR}px)`,
                  }}
                >
                  {agoraLeft != null ? (
                    <div
                      className="pointer-events-none absolute bottom-0 top-0 z-[4] border-l border-dashed border-sky-600/80"
                      style={{ left: agoraLeft }}
                    />
                  ) : null}
                  {previsto ? (
                    <div
                      className="absolute top-2 h-7 rounded-sm border border-dashed border-slate-400/80 bg-transparent"
                      style={{
                        left: previsto.leftPx,
                        width: previsto.widthPx,
                      }}
                      title="Previsto pelo sistema"
                    />
                  ) : null}
                  {real ? (
                    <div
                      className={cn(
                        "absolute top-2.5 z-[2] h-6 rounded-sm",
                        barClassForStatus(etapa.status, etapa.medicao),
                      )}
                      style={{ left: real.leftPx, width: real.widthPx }}
                    >
                      {etapa.progresso_pct != null &&
                      etapa.status === "em_execucao" ? (
                        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold text-white">
                          {etapa.progresso_pct}%
                        </span>
                      ) : null}
                    </div>
                  ) : previsto &&
                    (etapa.status === "pendente" || etapa.status === "atrasado") ? (
                    <div
                      className={cn(
                        "absolute top-2.5 z-[2] h-6 rounded-sm",
                        barClassForStatus(etapa.status, etapa.medicao),
                      )}
                      style={{ left: previsto.leftPx, width: previsto.widthPx }}
                    />
                  ) : null}
                  {(etapa.pausas || []).map((p, idx) => {
                    const band = barLayoutPx(p.inicio, p.fim, start, end, timelineW);
                    if (!band) return null;
                    return (
                      <div
                        key={`${etapa.id}-pausa-${idx}`}
                        className="absolute top-1 z-[3] h-9 rounded-sm bg-[repeating-linear-gradient(135deg,#fde68a_0_4px,#fbbf24_4px_8px)] opacity-70"
                        style={{ left: band.leftPx, width: band.widthPx }}
                        title={`Pausa: ${p.situacao || "cliente"}`}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="shrink-0">
        <ProducaoGanttLegend />
      </div>
    </div>
  );
}
