import { Loader2 } from "lucide-react";

import { useOsFluxoProducao } from "@/features/os/hooks/useOsFluxoProducao";

import { ProducaoGanttChart } from "./ProducaoGanttChart";
import { ProducaoGanttHeader } from "./ProducaoGanttHeader";

interface ProducaoGanttPanelProps {
  ano: number;
  osId: number;
  enabled: boolean;
}

export function ProducaoGanttPanel({
  ano,
  osId,
  enabled,
}: ProducaoGanttPanelProps) {
  const { query, agoraLocal } = useOsFluxoProducao(ano, osId, enabled);

  if (query.isPending) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-slate-600">
        <Loader2 className="size-4 animate-spin" />
        Carregando fluxo de produção…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
        Não foi possível carregar o fluxo de produção.
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  const { resumo, etapas } = data;

  if (resumo.status_geral === "nao_iniciada") {
    return (
      <div className="flex h-full flex-col gap-3 p-1">
        <ProducaoGanttHeader resumo={resumo} agoraLocal={agoraLocal} />
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-700">
          A OS ainda não entrou em produção (SEFOC, SIELT, SEIMP ou SEPAC). O
          Gantt começa a partir do primeiro andamento nesses setores.
        </div>
        {(resumo.avisos || []).length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500">
            {resumo.avisos!.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-1">
      <ProducaoGanttHeader resumo={resumo} agoraLocal={agoraLocal} />
      <ProducaoGanttChart
        ano={ano}
        osId={osId}
        resumo={resumo}
        etapas={etapas}
        agoraLocal={agoraLocal}
      />
      {(resumo.avisos || []).length > 0 ? (
        <ul className="list-disc space-y-0.5 pl-5 text-[11px] text-slate-500">
          {resumo.avisos!.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
