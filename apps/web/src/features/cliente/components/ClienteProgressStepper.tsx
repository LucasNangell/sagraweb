import { AlertTriangle, Check, Circle, Loader2, PackageCheck } from "lucide-react";

import { cn } from "@sagra/ui";

import type { ProgressStepView } from "../types/clienteProgress";
import { progressPercent } from "../utils/clienteProgressMapper";

interface ClienteProgressStepperProps {
  steps: ProgressStepView[];
  loading?: boolean;
  compact?: boolean;
  isEstimated?: boolean;
}

function StepIcon({ state }: { state: ProgressStepView["state"] }) {
  switch (state) {
    case "done":
      return <Check className="size-3 stroke-[3]" aria-hidden />;
    case "final":
      return <PackageCheck className="size-3 stroke-[2.5]" aria-hidden />;
    case "warning":
      return <AlertTriangle className="size-3 stroke-[2.5]" aria-hidden />;
    case "current":
      return <Circle className="size-2 fill-current" aria-hidden />;
    default:
      return <Circle className="size-2 fill-current opacity-40" aria-hidden />;
  }
}

function stepCircleClasses(state: ProgressStepView["state"]): string {
  switch (state) {
    case "done":
      return "border-primary-green bg-primary-green text-white";
    case "final":
      return "border-primary-green bg-primary-green text-white ring-2 ring-primary-green/20";
    case "warning":
      return "border-amber-500 bg-amber-50 text-amber-600 ring-2 ring-amber-300/70";
    case "current":
      return "scale-110 border-secondary-blue bg-white text-secondary-blue ring-2 ring-secondary-blue/25";
    default:
      return "border-neutral-300 bg-white text-neutral-300";
  }
}

function connectorClasses(leftState: ProgressStepView["state"]): string {
  if (leftState === "done" || leftState === "final") {
    return "bg-primary-green";
  }
  if (leftState === "warning" || leftState === "current") {
    return "bg-gradient-to-r from-primary-green to-sagra-border";
  }
  return "bg-sagra-border";
}

export function ClienteProgressStepper({
  steps,
  loading = false,
  compact = false,
  isEstimated = false,
}: ClienteProgressStepperProps) {
  const percent = progressPercent(steps);
  const currentStep = steps.find(
    (s) => s.state === "current" || s.state === "warning",
  );
  const currentLabel = currentStep?.fullTitle ?? currentStep?.label ?? "—";

  if (compact) {
    return (
      <div className="w-full space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-secondary-blue">
            {loading ? (
              <span className="inline-flex items-center gap-1 text-neutral-500">
                <Loader2 className="size-3 animate-spin" aria-hidden />
                Carregando etapas…
              </span>
            ) : (
              <>
                Etapa {(currentStep?.index ?? 0) + 1} de {steps.length} — {currentLabel}
                {isEstimated ? (
                  <span className="ml-1 text-neutral-400" title="Estimativa">
                    ~
                  </span>
                ) : null}
              </>
            )}
          </span>
          <span className="tabular-nums text-neutral-500">{percent}%</span>
        </div>
        <div
          className="h-2 overflow-hidden rounded-full bg-neutral-200"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Progresso da OS"
        >
          <div
            className="h-full rounded-full bg-primary-green transition-all duration-300 motion-reduce:transition-none"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="flex justify-between gap-1 px-0.5">
          {steps.map((step) => (
            <span
              key={step.index}
              title={step.fullTitle}
              className={cn(
                "size-2.5 rounded-full transition-colors duration-200",
                step.state === "done" || step.state === "final"
                  ? "bg-primary-green"
                  : step.state === "warning"
                    ? "bg-amber-500"
                    : step.state === "current"
                      ? "bg-secondary-blue"
                      : "bg-neutral-300",
              )}
              aria-hidden
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-w-0">
      {isEstimated && !loading ? (
        <p className="mb-2 text-[10px] text-neutral-400">Progresso estimado</p>
      ) : null}
      <div className="overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:thin] md:overflow-visible">
        <ol
          className="flex min-w-[520px] items-start gap-0 md:min-w-0"
          aria-label="Etapas de progresso da ordem de serviço"
        >
          {steps.map((step, index) => {
            const isLast = index === steps.length - 1;
            return (
              <li
                key={step.index}
                className="flex min-w-0 flex-1 flex-col items-center"
                title={step.fullTitle}
              >
                <div className="flex w-full items-center">
                  {index > 0 ? (
                    <span
                      className={cn(
                        "h-[2px] flex-1 transition-colors duration-200",
                        connectorClasses(steps[index - 1].state),
                      )}
                      aria-hidden
                    />
                  ) : (
                    <span className="flex-1" aria-hidden />
                  )}
                  <span
                    className={cn(
                      "relative z-10 flex size-8 shrink-0 items-center justify-center rounded-full border-2 transition-all duration-200 motion-reduce:transition-none",
                      stepCircleClasses(step.state),
                      loading && "opacity-60",
                    )}
                    aria-hidden
                  >
                    {loading && index === 0 ? (
                      <Loader2 className="size-3 animate-spin" aria-hidden />
                    ) : (
                      <StepIcon state={step.state} />
                    )}
                  </span>
                  {!isLast ? (
                    <span
                      className={cn(
                        "h-[2px] flex-1 transition-colors duration-200",
                        connectorClasses(step.state),
                      )}
                      aria-hidden
                    />
                  ) : (
                    <span className="flex-1" aria-hidden />
                  )}
                </div>
                <span
                  className={cn(
                    "mt-1.5 max-w-[4.5rem] truncate text-center text-[10px] font-medium leading-tight sm:max-w-none sm:text-[11px]",
                    step.state === "warning"
                      ? "text-amber-700"
                      : step.state === "current"
                        ? "text-secondary-blue"
                        : step.state === "done" || step.state === "final"
                          ? "text-primary-green"
                          : "text-neutral-400",
                  )}
                >
                  <span className="hidden lg:inline">{step.label}</span>
                  <span className="lg:hidden">{step.shortLabel}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
