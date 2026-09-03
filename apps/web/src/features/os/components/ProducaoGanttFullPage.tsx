import { ArrowLeft, Loader2 } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";

import { useDevFeature } from "@/features/configuracoes/hooks/useDevFeature";
import { useOsFluxoProducao } from "@/features/os/hooks/useOsFluxoProducao";

import { ProducaoGanttFullChart } from "./ProducaoGanttFullChart";
import { ProducaoGanttHeader } from "./ProducaoGanttHeader";

interface ProducaoGanttFullPageProps {
  ano: number;
  osId: number;
}

export function ProducaoGanttFullPage({ ano, osId }: ProducaoGanttFullPageProps) {
  const navigate = useNavigate();
  const enabled = useDevFeature("fluxo_producao");
  const { query, agoraLocal } = useOsFluxoProducao(ano, osId, enabled);

  const goBack = () => {
    if (window.history.length > 1) {
      window.history.back();
      return;
    }
    void navigate({ to: "/gerencia" });
  };

  if (!Number.isFinite(ano) || !Number.isFinite(osId) || ano <= 0 || osId <= 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-semibold text-sagra-danger">Parâmetros inválidos</p>
        <p className="text-sm text-neutral-600">
          Informe ano e número da OS válidos na URL.
        </p>
        <button
          type="button"
          className="mt-2 text-sm text-secondary-blue underline"
          onClick={goBack}
        >
          Voltar
        </button>
      </div>
    );
  }

  if (!enabled) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-sm font-medium text-slate-800">
          Fluxo de produção não está habilitado.
        </p>
        <button
          type="button"
          className="mt-2 text-sm text-secondary-blue underline"
          onClick={goBack}
        >
          Voltar
        </button>
      </div>
    );
  }

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
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6">
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          Não foi possível carregar o fluxo de produção.
        </div>
        <button
          type="button"
          className="text-sm text-secondary-blue underline"
          onClick={goBack}
        >
          Voltar
        </button>
      </div>
    );
  }

  const data = query.data;
  if (!data) return null;

  const { resumo, etapas } = data;

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={goBack}
          className="inline-flex h-8 items-center gap-1 rounded border border-sagra-border bg-white px-2 text-xs text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft className="size-3.5" />
          Voltar
        </button>
        <h1 className="text-sm font-semibold text-secondary-blue">
          Fluxo de produção
        </h1>
      </div>

      <ProducaoGanttHeader resumo={resumo} agoraLocal={agoraLocal} />

      {resumo.status_geral === "nao_iniciada" ? (
        <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-4 text-sm text-slate-700">
          A OS ainda não entrou em produção (SEFOC, SIELT, SEIMP ou SEPAC). O
          Gantt começa a partir do primeiro andamento nesses setores.
        </div>
      ) : (
        <ProducaoGanttFullChart
          resumo={resumo}
          etapas={etapas}
          agoraLocal={agoraLocal}
        />
      )}
    </div>
  );
}
