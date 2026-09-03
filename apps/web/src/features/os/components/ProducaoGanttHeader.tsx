import { cn } from "@sagra/ui";

import type { FluxoResumo } from "@/api/osFluxoProducao";

import {
  formatClock,
  formatDesvioLabel,
  statusGeralLabel,
} from "./producaoGanttLayout";

interface ProducaoGanttHeaderProps {
  resumo: FluxoResumo;
  agoraLocal?: string | null;
}

export function ProducaoGanttHeader({
  resumo,
  agoraLocal,
}: ProducaoGanttHeaderProps) {
  const desvio = Number(resumo.desvio_total_min || 0);
  const desvioLabel = formatDesvioLabel(desvio);
  const status = resumo.status_geral;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold text-secondary-blue">
          Gráfico de Gantt — Fluxo de Produção
        </h3>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
          OS {String(resumo.os.nr_os).padStart(4, "0")}/{String(resumo.os.ano).slice(-2)}
        </span>
        {Math.abs(desvio) > 1 ? (
          <span
            className={cn(
              "rounded px-2 py-0.5 text-xs font-semibold",
              desvio > 0
                ? "bg-red-50 text-red-700"
                : "bg-emerald-50 text-emerald-700",
            )}
          >
            {desvioLabel}
          </span>
        ) : null}
        {resumo.pausa_cliente?.ativa ? (
          <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">
            Aguardando cliente
            {resumo.pausa_cliente.situacao
              ? ` — ${resumo.pausa_cliente.situacao}`
              : ""}
          </span>
        ) : null}
      </div>

      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div
          className={cn(
            "rounded-md border px-2.5 py-2 text-xs",
            status === "atrasada"
              ? "border-orange-300 bg-orange-50"
              : status === "adiantada"
                ? "border-sky-300 bg-sky-50"
                : status === "pausada_cliente"
                  ? "border-amber-300 bg-amber-50"
                  : "border-sagra-border bg-slate-50",
          )}
        >
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Status geral
          </div>
          <div className="mt-0.5 font-semibold text-secondary-blue">
            {statusGeralLabel(status)}
          </div>
        </div>
        <div className="rounded-md border border-sagra-border bg-slate-50 px-2.5 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Horário atual
          </div>
          <div className="mt-0.5 font-semibold text-secondary-blue">
            {formatClock(agoraLocal || resumo.agora)}
          </div>
        </div>
        <div className="rounded-md border border-orange-200 bg-orange-50/70 px-2.5 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Etapa atual
          </div>
          <div className="mt-0.5 font-semibold text-secondary-blue">
            {resumo.etapa_atual?.rotulo || "—"}
          </div>
        </div>
        <div className="rounded-md border border-sagra-border bg-slate-50 px-2.5 py-2 text-xs">
          <div className="text-[10px] uppercase tracking-wide text-slate-500">
            Previsão de término
          </div>
          <div className="mt-0.5 font-semibold text-secondary-blue">
            {formatClock(resumo.previsao_termino)}
          </div>
        </div>
      </div>
    </div>
  );
}
