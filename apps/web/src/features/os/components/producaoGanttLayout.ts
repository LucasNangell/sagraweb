import type { FluxoEtapa, FluxoResumo } from "@/api/osFluxoProducao";

export function parseFluxoDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function formatClock(value?: string | null): string {
  const d = parseFluxoDate(value);
  if (!d) return "—";
  return d.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  });
}

export function formatDesvioLabel(minutos: number): string {
  const abs = Math.abs(minutos);
  const h = Math.floor(abs / 60);
  const m = Math.round(abs % 60);
  const body =
    h > 0 ? (m > 0 ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`) : `${m} min`;
  if (minutos > 1) return `${body} atrasado`;
  if (minutos < -1) return `${body} adiantado`;
  return "no prazo";
}

export function statusGeralLabel(status?: string | null): string {
  switch (status) {
    case "nao_iniciada":
      return "Não iniciada";
    case "no_prazo":
      return "Em produção";
    case "adiantada":
      return "Em produção adiantada";
    case "atrasada":
      return "Em produção com atraso";
    case "pausada_cliente":
      return "Pausada (cliente)";
    case "concluida":
      return "Concluída";
    case "cancelada":
      return "Cancelada";
    case "sem_roteiro":
      return "Sem roteiro (marcos)";
    default:
      return status || "—";
  }
}

export function etapaStatusLabel(status?: string | null): string {
  switch (status) {
    case "concluido":
      return "Concluído";
    case "concluido_antecipado":
      return "Concluído antes do previsto";
    case "em_execucao":
      return "Em execução";
    case "pausado":
      return "Pausado";
    case "atrasado":
      return "Atrasado";
    case "adiantado":
      return "Adiantado";
    case "pendente":
      return "Pendente";
    default:
      return status || "—";
  }
}

export interface GanttTick {
  at: Date;
  label: string;
  pct: number;
}

export interface GanttBarLayout {
  leftPct: number;
  widthPct: number;
}

export function buildTimeWindow(resumo: FluxoResumo): {
  start: Date;
  end: Date;
} | null {
  const start =
    parseFluxoDate(resumo.janela?.inicio) ||
    parseFluxoDate(resumo.inicio_producao_em);
  const end = parseFluxoDate(resumo.janela?.fim);
  if (!start || !end || end <= start) return null;
  return { start, end };
}

export function dateToPct(date: Date, start: Date, end: Date): number {
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, ((date.getTime() - start.getTime()) / total) * 100));
}

export function barLayout(
  inicio?: string | null,
  fim?: string | null,
  start?: Date | null,
  end?: Date | null,
): GanttBarLayout | null {
  if (!start || !end) return null;
  const a = parseFluxoDate(inicio);
  const b = parseFluxoDate(fim);
  if (!a || !b || b <= a) return null;
  const leftPct = dateToPct(a, start, end);
  const rightPct = dateToPct(b, start, end);
  return { leftPct, widthPct: Math.max(rightPct - leftPct, 0.4) };
}

export function buildTicks(
  start: Date,
  end: Date,
  escala: string,
  tickMin: number,
): GanttTick[] {
  const ticks: GanttTick[] = [];
  const totalMin = Math.max((end.getTime() - start.getTime()) / 60_000, 1);

  let stepMin: number;
  if (escala === "dias") {
    stepMin = Math.max(tickMin, 24 * 60);
  } else {
    // Escala em horas: preferir 1h; se a janela for muito longa, espaça para ~24 rótulos.
    const preferred = Math.max(tickMin || 60, 60);
    stepMin =
      totalMin / preferred > 36
        ? Math.max(preferred, Math.ceil(totalMin / 24 / 60) * 60)
        : preferred;
  }

  const stepMs = stepMin * 60_000;
  let cursor = new Date(start);
  cursor.setSeconds(0, 0);
  if (escala === "dias") {
    cursor.setHours(0, 0, 0, 0);
  } else {
    // Alinha à hora cheia (ou ao múltiplo do passo).
    const minutes = cursor.getMinutes();
    const align = stepMin >= 60 ? 60 : stepMin;
    if (minutes > 0 || cursor.getSeconds() > 0) {
      cursor.setMinutes(0, 0, 0);
      cursor = new Date(cursor.getTime() + align * 60_000);
    }
  }

  const maxTicks = escala === "horas" ? 400 : 48;
  let lastDayKey = "";
  while (cursor <= end && ticks.length < maxTicks) {
    const dayKey = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    const showDate = escala === "dias" || dayKey !== lastDayKey;
    lastDayKey = dayKey;
    ticks.push({
      at: new Date(cursor),
      label:
        escala === "dias"
          ? cursor.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
          : showDate
            ? cursor.toLocaleString("pt-BR", {
                day: "2-digit",
                month: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })
            : cursor.toLocaleTimeString("pt-BR", {
                hour: "2-digit",
                minute: "2-digit",
              }),
      pct: dateToPct(cursor, start, end),
    });
    cursor = new Date(cursor.getTime() + stepMs);
  }
  return ticks;
}

/** Zoom em que ~1 dia de calendário preenche a largura do viewport. */
export function zoomForOneDay(start: Date, end: Date, dayMs = 24 * 60 * 60 * 1000): number {
  const total = end.getTime() - start.getTime();
  if (total <= 0) return 1;
  return Math.max(1, Math.round((total / dayMs) * 100) / 100);
}

export const GANTT_PX_PER_HOUR = 64;
export const GANTT_COL_ETAPA_PX = 220;
export const GANTT_COL_INICIO_PX = 80;
export const GANTT_COL_FIM_PX = 80;
export const GANTT_COL_STATUS_PX = 150;

export function ganttMetaWidthPx(): number {
  return (
    GANTT_COL_ETAPA_PX +
    GANTT_COL_INICIO_PX +
    GANTT_COL_FIM_PX +
    GANTT_COL_STATUS_PX
  );
}

export function alignHourGrid(
  start: Date,
  end: Date,
): { start: Date; end: Date } {
  const gridStart = new Date(start);
  gridStart.setMinutes(0, 0, 0);
  const gridEnd = new Date(end);
  gridEnd.setMinutes(0, 0, 0);
  if (gridEnd.getTime() < end.getTime()) {
    gridEnd.setHours(gridEnd.getHours() + 1);
  }
  if (gridEnd <= gridStart) {
    gridEnd.setTime(gridStart.getTime() + 60 * 60 * 1000);
  }
  return { start: gridStart, end: gridEnd };
}

export interface GanttHourColumn {
  at: Date;
  label: string;
  leftPx: number;
  widthPx: number;
}

export function buildHourColumns(
  start: Date,
  end: Date,
  pxPerHour = GANTT_PX_PER_HOUR,
): GanttHourColumn[] {
  const grid = alignHourGrid(start, end);
  const cols: GanttHourColumn[] = [];
  let cursor = new Date(grid.start);
  let lastDayKey = "";
  let i = 0;
  const max = 24 * 21;
  while (cursor < grid.end && i < max) {
    const dayKey = `${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`;
    const showDate = dayKey !== lastDayKey;
    lastDayKey = dayKey;
    const time = cursor.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const date = cursor.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
    });
    cols.push({
      at: new Date(cursor),
      label: showDate ? `${date} ${time}` : time,
      leftPx: i * pxPerHour,
      widthPx: pxPerHour,
    });
    cursor = new Date(cursor.getTime() + 60 * 60 * 1000);
    i += 1;
  }
  return cols;
}

export function timelineWidthPx(columns: GanttHourColumn[]): number {
  if (columns.length === 0) return 0;
  const last = columns[columns.length - 1];
  return last.leftPx + last.widthPx;
}

export interface GanttBarPx {
  leftPx: number;
  widthPx: number;
}

export function barLayoutPx(
  inicio: string | null | undefined,
  fim: string | null | undefined,
  start: Date,
  end: Date,
  timelineWidth: number,
): GanttBarPx | null {
  const layout = barLayout(inicio, fim, start, end);
  if (!layout || timelineWidth <= 0) return null;
  return {
    leftPx: (layout.leftPct / 100) * timelineWidth,
    widthPx: Math.max((layout.widthPct / 100) * timelineWidth, 3),
  };
}

export function barClassForStatus(
  status?: string | null,
  medicao?: string | null,
): string {
  const estimated = medicao === "estimada";
  switch (status) {
    case "concluido":
    case "concluido_antecipado":
      return estimated
        ? "bg-emerald-400/70 border border-dashed border-emerald-700"
        : "bg-emerald-500";
    case "em_execucao":
      return "bg-sky-500";
    case "adiantado":
      return "bg-[repeating-linear-gradient(135deg,#38bdf8_0_6px,#0284c7_6px_12px)]";
    case "atrasado":
      return "border-2 border-dashed border-orange-500 bg-orange-50";
    case "pausado":
      return "bg-amber-200 border border-amber-500";
    case "pendente":
    default:
      return "bg-slate-300";
  }
}

export function collectPausaBands(
  etapas: FluxoEtapa[],
  start: Date,
  end: Date,
): GanttBarLayout[] {
  const bands: GanttBarLayout[] = [];
  for (const etapa of etapas) {
    for (const p of etapa.pausas || []) {
      const layout = barLayout(p.inicio, p.fim || undefined, start, end);
      if (layout) bands.push(layout);
    }
  }
  return bands;
}
