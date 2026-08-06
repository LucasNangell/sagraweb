import { useQuery } from "@tanstack/react-query";
import { ChevronDown, MessageCircle } from "lucide-react";

import type { ClienteOsItem } from "@/api/cliente-portal";
import { fetchClienteSupportSettings } from "@/api/cliente-support";
import { queryKeys } from "@/api/query-keys";
import { cn } from "@sagra/ui";
import { formatDateTimeBr } from "@/lib/format";

import { useClienteOsTimeline } from "../hooks/useClienteOsTimeline";
import type { SectionKind } from "../types/clienteProgress";
import { resolveProgressSteps } from "../utils/clienteProgressMapper";
import { ClienteOsTimeline } from "./ClienteOsTimeline";
import { useClienteSupportUiStore } from "../clienteSupportUiStore";
import { ClienteOsActionButton } from "./ClienteOsActionButton";
import { ClienteProgressStepper } from "./ClienteProgressStepper";
import {
  ClienteStatusBadge,
  pendenciaBadgeLabel,
  sectionAccentClass,
} from "./ClienteStatusBadge";

interface ClienteCompactOsCardProps {
  item: ClienteOsItem;
  sectionKind: SectionKind;
  vinculoLabel: string;
  showPendenciaButton?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  animationIndex?: number;
}

function osKey(item: ClienteOsItem) {
  return `${item.ano}-${item.nr_os}`;
}

export function ClienteCompactOsCard({
  item,
  sectionKind,
  vinculoLabel,
  showPendenciaButton = false,
  expanded,
  onToggleExpand,
  animationIndex = 0,
}: ClienteCompactOsCardProps) {
  const key = osKey(item);
  const openChat = useClienteSupportUiStore((s) => s.openChat);
  const settingsQuery = useQuery({
    queryKey: queryKeys.support.clienteSettings,
    queryFn: fetchClienteSupportSettings,
    staleTime: 60_000,
  });
  const clienteChatEnabled = settingsQuery.data?.cliente_chat_enabled ?? true;
  const timelineEnabled = expanded;

  const timelineQuery = useClienteOsTimeline(item.ano, item.nr_os, {
    enabled: timelineEnabled,
  });

  const { steps, isEstimated, loading: stepperLoading } = resolveProgressSteps(
    item,
    timelineQuery.data?.steps,
    timelineQuery.isLoading && timelineEnabled && !timelineQuery.data,
  );

  const hasPendencia = Boolean(item.pendencia_tipo);
  const detailPanelId = `cliente-os-detail-${key}`;
  const timelineId = `cliente-os-timeline-${key}`;

  return (
    <article
      style={{ animationDelay: `${Math.min(animationIndex * 50, 300)}ms` }}
      className={cn(
        "overflow-hidden rounded-xl border border-sagra-border bg-white shadow-sm",
        "motion-safe:animate-[fadeIn_280ms_ease-out_both] motion-reduce:animate-none",
        "border-l-[3px]",
        sectionAccentClass(sectionKind),
        hasPendencia && sectionKind !== "em_andamento" && "bg-amber-50/20",
      )}
    >
      {/* Modo compacto */}
      <div className="p-3 sm:p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <h3 className="text-base font-bold tabular-nums text-secondary-blue sm:text-lg">
                OS {item.nr_os}/{item.ano}
              </h3>
              {item.produto ? (
                <ClienteStatusBadge variant="default" className="text-[10px]">
                  {item.produto}
                </ClienteStatusBadge>
              ) : null}
            </div>
            <p className="mt-0.5 line-clamp-1 text-sm font-medium text-neutral-800">
              {item.titulo || "—"}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">{vinculoLabel}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {item.situacao ? (
                <ClienteStatusBadge variant="situacao" className="text-[10px]">
                  {item.situacao}
                </ClienteStatusBadge>
              ) : null}
              {item.setor ? (
                <ClienteStatusBadge variant="setor" className="text-[10px]">
                  {item.setor}
                </ClienteStatusBadge>
              ) : null}
              {hasPendencia ? (
                <ClienteStatusBadge variant="pendencia" className="text-[10px]">
                  {pendenciaBadgeLabel(item.pendencia_tipo, item.versao)}
                </ClienteStatusBadge>
              ) : null}
            </div>
            {item.data_andamento ? (
              <p className="mt-1.5 text-[11px] text-neutral-500">
                Atualizado{" "}
                <time dateTime={String(item.data_andamento)}>
                  {formatDateTimeBr(item.data_andamento)}
                </time>
              </p>
            ) : null}
          </div>

          <div className="flex shrink-0 flex-col gap-2 sm:items-end">
            {sectionKind === "pendencias_pt" && clienteChatEnabled ? (
              <button
                type="button"
                onClick={() =>
                  openChat({
                    ano: item.ano,
                    nrOs: item.nr_os,
                    versao: item.versao ?? null,
                  })
                }
                className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-secondary-blue/30 bg-white px-3 py-2 text-sm font-medium text-secondary-blue hover:bg-secondary-blue/5 sm:w-auto"
              >
                <MessageCircle className="size-4" aria-hidden />
                Tirar dúvidas
              </button>
            ) : null}
            <ClienteOsActionButton
              item={item}
              showPendenciaButton={showPendenciaButton}
              sectionKind={sectionKind}
              size="sm"
            />
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={expanded}
              aria-controls={detailPanelId}
              className={cn(
                "inline-flex min-h-11 w-full items-center justify-center gap-1 rounded-lg border border-sagra-border sm:w-auto",
                "bg-white px-3 py-2 text-sm font-medium text-secondary-blue",
                "transition-colors hover:bg-slate-50",
                "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue",
              )}
            >
              Detalhes
              <ChevronDown
                className={cn(
                  "size-4 transition-transform duration-200 motion-reduce:transition-none",
                  expanded && "rotate-180",
                )}
                aria-hidden
              />
            </button>
          </div>
        </div>

        {/* Stepper compacto no modo listado */}
        {!expanded ? (
          <div className="mt-3 border-t border-sagra-border/50 pt-3">
            <ClienteProgressStepper
              steps={steps}
              loading={stepperLoading && !isEstimated}
              isEstimated={isEstimated}
              compact
            />
          </div>
        ) : null}
      </div>

      {/* Painel expandido: stepper completo + timeline */}
      <div
        id={detailPanelId}
        className={cn(
          "grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div className="overflow-hidden">
          <div className="border-t border-sagra-border/60 bg-slate-50/50 px-3 py-4 sm:px-4">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500">
              Progresso da publicação
            </p>
            <div className="hidden md:block">
              <ClienteProgressStepper
                steps={steps}
                loading={stepperLoading}
                isEstimated={isEstimated}
              />
            </div>
            <div className="md:hidden">
              <ClienteProgressStepper
                steps={steps}
                loading={stepperLoading}
                isEstimated={isEstimated}
                compact
              />
            </div>
          </div>
          <div
            id={timelineId}
            className={cn(
              "grid transition-[grid-template-rows] duration-300 motion-reduce:transition-none",
              expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
            )}
          >
            <div className="overflow-hidden">
              <ClienteOsTimeline
                ano={item.ano}
                nrOs={item.nr_os}
                expanded={expanded}
                timelineQuery={timelineQuery}
              />
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
