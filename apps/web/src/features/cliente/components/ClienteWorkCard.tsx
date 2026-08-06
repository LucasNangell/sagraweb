import { ChevronDown } from "lucide-react";

import type { ClienteOsItem } from "@/api/cliente-portal";
import { cn } from "@sagra/ui";
import { formatDateTimeBr } from "@/lib/format";

import { useClienteOsTimeline } from "../hooks/useClienteOsTimeline";
import { useInViewport } from "../hooks/useInViewport";
import type { SectionKind } from "../types/clienteProgress";
import { resolveProgressSteps } from "../utils/clienteProgressMapper";
import { ClienteOsTimeline } from "./ClienteOsTimeline";
import { ClientePendingAction } from "./ClientePendingAction";
import { ClienteProgressStepper } from "./ClienteProgressStepper";
import {
  ClienteStatusBadge,
  pendenciaBadgeLabel,
  sectionAccentClass,
} from "./ClienteStatusBadge";

interface ClienteWorkCardProps {
  item: ClienteOsItem;
  sectionKind: SectionKind;
  showPendenciaButton?: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  animationIndex?: number;
}

function osKey(item: ClienteOsItem) {
  return `${item.ano}-${item.nr_os}`;
}

export function ClienteWorkCard({
  item,
  sectionKind,
  showPendenciaButton = false,
  expanded,
  onToggleExpand,
  animationIndex = 0,
}: ClienteWorkCardProps) {
  const key = osKey(item);
  const { ref, isVisible } = useInViewport<HTMLElement>();
  const timelineEnabled = isVisible || expanded;

  const timelineQuery = useClienteOsTimeline(item.ano, item.nr_os, {
    enabled: timelineEnabled,
  });

  const { steps, isEstimated, loading: stepperLoading } = resolveProgressSteps(
    item,
    timelineQuery.data?.steps,
    timelineQuery.isLoading && timelineEnabled && !timelineQuery.data,
  );

  const hasPendencia = Boolean(item.pendencia_tipo);
  const timelineId = `cliente-os-timeline-${key}`;

  return (
    <article
      ref={ref}
      style={{ animationDelay: `${Math.min(animationIndex * 70, 420)}ms` }}
      className={cn(
        "overflow-hidden rounded-2xl border border-sagra-border bg-white shadow-sm",
        "transition-all duration-200 motion-safe:hover:-translate-y-0.5 motion-safe:hover:shadow-lg motion-reduce:transition-none",
        "motion-safe:animate-[fadeIn_320ms_ease-out_both]",
        "border-l-4",
        sectionAccentClass(sectionKind),
        hasPendencia && "bg-amber-50/30 ring-1 ring-amber-100",
      )}
    >
      <div className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-center lg:gap-6">
        {/* Identificação */}
        <div className="min-w-0 shrink-0 lg:w-[260px] xl:w-[300px]">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-bold tabular-nums tracking-tight text-secondary-blue sm:text-xl">
              OS {item.nr_os}/{item.ano}
            </h3>
          </div>
          <p className="mt-1 line-clamp-2 text-sm font-medium text-neutral-800">
            {item.titulo || "—"}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.produto ? (
              <ClienteStatusBadge variant="default">{item.produto}</ClienteStatusBadge>
            ) : null}
            {item.setor ? (
              <ClienteStatusBadge variant="setor">{item.setor}</ClienteStatusBadge>
            ) : null}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.situacao ? (
              <ClienteStatusBadge variant="situacao" className="text-xs font-semibold">
                {item.situacao}
              </ClienteStatusBadge>
            ) : null}
            {hasPendencia ? (
              <ClienteStatusBadge variant="pendencia">
                {pendenciaBadgeLabel(item.pendencia_tipo, item.versao)}
              </ClienteStatusBadge>
            ) : (
              <ClienteStatusBadge variant="andamento">Em andamento</ClienteStatusBadge>
            )}
          </div>
          {item.data_andamento ? (
            <p className="mt-2 text-xs text-neutral-500">
              Atualizado{" "}
              <time dateTime={String(item.data_andamento)}>
                {formatDateTimeBr(item.data_andamento)}
              </time>
            </p>
          ) : null}
        </div>

        {/* Stepper — desktop/tablet horizontal */}
        <div className="hidden min-w-0 flex-1 lg:border-l lg:border-sagra-border/70 lg:pl-5 md:block">
          <ClienteProgressStepper
            steps={steps}
            loading={stepperLoading}
            isEstimated={isEstimated}
          />
        </div>

        {/* Stepper — mobile compact */}
        <div className="border-t border-sagra-border/60 pt-3 md:hidden">
          <ClienteProgressStepper
            steps={steps}
            loading={stepperLoading}
            isEstimated={isEstimated}
            compact
          />
        </div>

        {/* Ações */}
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center lg:flex-col lg:items-stretch xl:flex-row xl:items-center">
          {showPendenciaButton && item.pendencia_url ? (
            <ClientePendingAction
              href={item.pendencia_url}
              label={item.pendencia_label || "Ver pendência"}
              size="sm"
            />
          ) : null}
          <button
            type="button"
            onClick={onToggleExpand}
            aria-expanded={expanded}
            aria-controls={timelineId}
            aria-label={`${
              expanded ? "Ocultar" : "Mostrar"
            } detalhes da OS ${item.nr_os}/${item.ano}`}
            className={cn(
              "inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-sagra-border sm:w-auto",
              "bg-white px-4 py-2 text-sm font-medium text-secondary-blue",
              "transition-colors duration-200 hover:bg-slate-50",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue",
            )}
          >
            Detalhes
            <ChevronDown
              className={cn(
                "size-4 transition-transform duration-200",
                expanded && "rotate-180",
              )}
              aria-hidden
            />
          </button>
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
    </article>
  );
}
