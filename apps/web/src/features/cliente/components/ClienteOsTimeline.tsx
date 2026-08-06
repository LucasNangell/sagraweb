import type { UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Check, Circle, ExternalLink, Loader2 } from "lucide-react";

import type { ClienteOsTimelineResponse } from "@/api/cliente-portal";
import { cn } from "@sagra/ui";
import { formatDateTimeBr } from "@/lib/format";

import { useClienteOsTimeline } from "../hooks/useClienteOsTimeline";
import {
  getProofApprovalRoute,
  isProofTimelineMovement,
  PROOF_VIEW_LABEL,
} from "../utils/proofApprovalUtils";

interface ClienteOsTimelineProps {
  ano: number;
  nrOs: number;
  expanded: boolean;
  timelineQuery?: UseQueryResult<ClienteOsTimelineResponse, Error>;
}

export function ClienteOsTimeline({
  ano,
  nrOs,
  expanded,
  timelineQuery: externalQuery,
}: ClienteOsTimelineProps) {
  const internalQuery = useClienteOsTimeline(ano, nrOs, {
    enabled: expanded && externalQuery === undefined,
  });
  const timelineQuery = externalQuery ?? internalQuery;

  if (!expanded) {
    return null;
  }

  if (timelineQuery.isLoading) {
    return (
      <div className="flex items-center gap-2 border-t border-sagra-border/60 bg-slate-50 px-4 py-4 text-sm text-neutral-500 sm:px-6">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        Carregando linha do tempo…
      </div>
    );
  }

  if (timelineQuery.isError) {
    return (
      <div className="border-t border-sagra-border/60 bg-red-50/70 px-4 py-3 text-sm text-red-700 sm:px-6">
        Não foi possível carregar a linha do tempo neste momento.
      </div>
    );
  }

  const data = timelineQuery.data;
  const steps = data?.steps ?? [];

  if (!steps.length) {
    return (
      <div className="border-t border-sagra-border/60 bg-slate-50 px-4 py-4 text-sm text-neutral-500 sm:px-6">
        Nenhum andamento registrado.
      </div>
    );
  }

  const lastCompletedIndex = steps.reduce(
    (acc, step, index) => (step.concluido ? index : acc),
    -1,
  );

  return (
    <div className="rounded-b-2xl border-t border-sagra-border/60 bg-slate-50 px-4 py-4 sm:px-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Linha do tempo detalhada
        </p>
        {data?.produto || data?.maquina ? (
          <p className="text-[11px] text-neutral-400">
            {[data.produto, data.maquina].filter(Boolean).join(" · ")}
          </p>
        ) : null}
      </div>
      <ol className="relative space-y-0">
        {steps.map((step, index) => {
          const isLast = index === steps.length - 1;
          const isCompleted = step.concluido;
          const hasPendencia = Boolean(step.pendencia_label || step.pendencia_mensagem);
          const showProofViewButton =
            isProofTimelineMovement(step) && Boolean(step.pendencia_label);
          const isCurrent =
            hasPendencia || index === lastCompletedIndex + 1 || (index === 0 && !isCompleted);
          const showAsActive = hasPendencia || (!isCompleted && isCurrent);
          const connectorCompleted = isCompleted;

          return (
            <li
              key={`${step.ordem}-${step.situacao}-${index}`}
              className="relative flex gap-3 pb-4 last:pb-0"
            >
              {!isLast ? (
                <span
                  className={cn(
                    "absolute left-[11px] top-6 h-[calc(100%-12px)] w-0.5",
                    connectorCompleted ? "bg-primary-green" : "bg-sagra-border",
                  )}
                  aria-hidden
                />
              ) : null}
              <span
                className={cn(
                  "relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-2",
                  hasPendencia
                    ? "border-amber-500 bg-amber-50 text-amber-600"
                    : isCompleted
                      ? "border-primary-green bg-primary-green text-white"
                      : "border-neutral-300 bg-white text-neutral-300",
                  showAsActive && !hasPendencia && "ring-2 ring-primary-green/25",
                  hasPendencia && "ring-2 ring-amber-300/60",
                )}
                aria-hidden
              >
                {hasPendencia ? (
                  <AlertTriangle className="size-3.5 stroke-[2.5]" />
                ) : isCompleted ? (
                  <Check className="size-3.5 stroke-[3]" />
                ) : (
                  <Circle className="size-2.5 fill-current" />
                )}
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <p
                  className={cn(
                    "text-sm font-medium",
                    hasPendencia
                      ? "text-amber-800"
                      : isCompleted
                        ? "text-secondary-blue"
                        : "text-neutral-400",
                  )}
                >
                  {step.situacao || "—"}
                </p>
                <p
                  className={cn(
                    "text-xs",
                    hasPendencia
                      ? "text-amber-700"
                      : isCompleted
                        ? "text-neutral-600"
                        : "text-neutral-400",
                  )}
                >
                  {step.setor || "—"}
                  {isCompleted && step.data ? (
                    <>
                      {" "}
                      ·{" "}
                      <time dateTime={step.data}>{formatDateTimeBr(step.data)}</time>
                    </>
                  ) : !isCompleted && !hasPendencia ? (
                    <span className="italic"> · aguardando</span>
                  ) : null}
                </p>
                {hasPendencia ? (
                  <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    <p className="text-xs font-medium text-amber-800">
                      {step.pendencia_mensagem || "Há pendências a serem resolvidas"}
                    </p>
                    {showProofViewButton ? (
                      <Link
                        {...getProofApprovalRoute(ano, nrOs)}
                        className={cn(
                          "inline-flex min-h-9 items-center gap-1 rounded-lg border border-secondary-blue/30 bg-secondary-blue px-2.5 py-1 text-xs font-medium text-white hover:bg-secondary-blue/90",
                        )}
                      >
                        {PROOF_VIEW_LABEL}
                      </Link>
                    ) : step.pendencia_url ? (
                      <a
                        href={step.pendencia_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "inline-flex items-center gap-1 rounded border font-medium text-white hover:opacity-90",
                          "border-amber-600 bg-amber-600 px-2.5 py-1 text-xs",
                        )}
                      >
                        {step.pendencia_label || "Resolver pendência"}
                        <ExternalLink className="size-3" aria-hidden />
                      </a>
                    ) : (
                      <span className="text-xs text-amber-700">
                        {step.pendencia_label || "Aguardando ação do cliente"}
                      </span>
                    )}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
