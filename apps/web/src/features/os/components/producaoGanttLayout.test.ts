import { describe, expect, it } from "vitest";

import type { FluxoResumo } from "@/api/osFluxoProducao";

import {
  barLayout,
  buildHourColumns,
  buildTicks,
  buildTimeWindow,
  dateToPct,
  formatDesvioLabel,
  ganttMetaWidthPx,
  statusGeralLabel,
  timelineWidthPx,
  zoomForOneDay,
} from "./producaoGanttLayout";

const baseResumo: FluxoResumo = {
  os: { nr_os: 1392, ano: 2026 },
  status_geral: "atrasada",
  agora: "2026-06-15T12:20:00",
  desvio_total_min: 50,
  escala: "horas",
  janela: { inicio: "2026-06-15T08:00:00", fim: "2026-06-15T17:00:00" },
  tick_min: 60,
  expediente: { abertura_hora: 6, fechamento_hora: 22 },
  inicio_producao_em: "2026-06-15T08:00:00",
};

describe("producaoGanttLayout", () => {
  it("formata desvio atrasado e adiantado", () => {
    expect(formatDesvioLabel(50)).toBe("50 min atrasado");
    expect(formatDesvioLabel(70)).toBe("1h10 atrasado");
    expect(formatDesvioLabel(-70)).toBe("1h10 adiantado");
    expect(formatDesvioLabel(0)).toBe("no prazo");
  });

  it("rótulos de status geral", () => {
    expect(statusGeralLabel("atrasada")).toContain("atraso");
    expect(statusGeralLabel("pausada_cliente")).toContain("Pausada");
  });

  it("converte tempo em percentual na janela", () => {
    const w = buildTimeWindow(baseResumo)!;
    const mid = dateToPct(new Date("2026-06-15T12:30:00"), w.start, w.end);
    expect(mid).toBeGreaterThan(40);
    expect(mid).toBeLessThan(60);
  });

  it("calcula layout de barra", () => {
    const w = buildTimeWindow(baseResumo)!;
    const layout = barLayout(
      "2026-06-15T08:00:00",
      "2026-06-15T09:00:00",
      w.start,
      w.end,
    );
    expect(layout).not.toBeNull();
    expect(layout!.leftPct).toBe(0);
    expect(layout!.widthPct).toBeCloseTo(100 / 9, 0);
  });

  it("janela começa em inicio_producao_em", () => {
    const w = buildTimeWindow(baseResumo)!;
    expect(w.start.getFullYear()).toBe(2026);
    expect(w.start.getMonth()).toBe(5);
    expect(w.start.getDate()).toBe(15);
    expect(w.start.getHours()).toBe(8);
    expect(w.start.getMinutes()).toBe(0);
  });

  it("zoom padrão de um dia e ticks em horas", () => {
    const start = new Date("2026-06-15T08:00:00");
    const end = new Date("2026-06-17T08:00:00");
    expect(zoomForOneDay(start, end)).toBe(2);
    const ticks = buildTicks(start, end, "horas", 60);
    expect(ticks.length).toBeGreaterThan(20);
    expect(ticks.some((t) => t.label.includes(":"))).toBe(true);
  });

  it("monta uma coluna visual por hora", () => {
    const start = new Date("2026-06-15T08:20:00");
    const end = new Date("2026-06-15T11:00:00");
    const cols = buildHourColumns(start, end);
    expect(cols.length).toBe(3);
    expect(cols[0].widthPx).toBe(64);
    expect(timelineWidthPx(cols)).toBe(192);
    expect(cols[0].label).toMatch(/08:00/);
    expect(ganttMetaWidthPx()).toBe(220 + 80 + 80 + 150);
  });
});
