import type { ClienteOsItem, ClienteTimelineStep } from "@/api/cliente-portal";

import {
  PROGRESS_STEP_COUNT,
  STEP_DESKTOP_LABELS,
  STEP_SHORT_LABELS,
  type ProgressStepView,
  type StepVisualState,
} from "../types/clienteProgress";

export function lastCompletedIndex(steps: ClienteTimelineStep[]): number {
  return steps.reduce((acc, step, index) => (step.concluido ? index : acc), -1);
}

export function deriveStepVisualState(
  step: ClienteTimelineStep,
  index: number,
  steps: ClienteTimelineStep[],
): StepVisualState {
  const completedIdx = lastCompletedIndex(steps);
  const hasPendencia = Boolean(step.pendencia_label || step.pendencia_url);

  if (hasPendencia) {
    return "warning";
  }
  if (step.concluido) {
    if (index === steps.length - 1) {
      return "final";
    }
    return "done";
  }
  const isCurrent =
    index === completedIdx + 1 || (index === 0 && completedIdx < 0 && !step.concluido);
  if (isCurrent) {
    return "current";
  }
  return "pending";
}

export function estimateStepIndexFromOsItem(item: ClienteOsItem): number {
  const situacao = String(item.situacao || "").trim();
  const setor = String(item.setor || "").trim().toUpperCase();

  if (situacao === "Entregue") {
    return 6;
  }
  if (situacao === "Saída p/") {
    if (setor === "SEFOC") return 1;
    if (setor === "SIELT" || setor === "SEIMP") return 3;
    if (setor === "SEPAC" || setor === "ENCADERNAÇÃO" || setor === "ENCADERNACAO") return 4;
    if (
      setor === "EXPEDIÇÃO" ||
      setor === "EXPEDICAO" ||
      setor === "CORRESPONDÊNCIA" ||
      setor === "CORRESPONDENCIA" ||
      setor === "SEDIR"
    ) {
      return 5;
    }
  }
  if (
    situacao === "Entrada Inicial" ||
    (situacao === "Pendência Usuário" && setor !== "SEFOC")
  ) {
    return 0;
  }
  if (
    situacao === "Em Execução" ||
    situacao === "Recebido" ||
    situacao === "Problemas Técnicos" ||
    situacao === "Aguard. Aprovação" ||
    situacao === "Pendência Usuário" ||
    situacao === "Encam. de Docum." ||
    situacao === "Tramit. de Prévia p/" ||
    situacao === "Gravação"
  ) {
    return 2;
  }
  return 0;
}

function buildEstimatedSteps(currentIndex: number): ProgressStepView[] {
  return Array.from({ length: PROGRESS_STEP_COUNT }, (_, index) => {
    let state: StepVisualState = "pending";
    if (index < currentIndex) {
      state = "done";
    } else if (index === currentIndex) {
      state = "current";
    }
    if (index === PROGRESS_STEP_COUNT - 1 && index <= currentIndex) {
      state = "final";
    }
    return {
      index,
      label: STEP_DESKTOP_LABELS[index],
      shortLabel: STEP_SHORT_LABELS[index],
      fullTitle: STEP_DESKTOP_LABELS[index],
      state,
      isEstimated: true,
    };
  });
}

export function mapTimelineToProgressSteps(steps: ClienteTimelineStep[]): ProgressStepView[] {
  if (!steps.length) {
    return [];
  }
  return steps.map((step, index) => ({
    index,
    label: STEP_DESKTOP_LABELS[index] ?? step.situacao,
    shortLabel: STEP_SHORT_LABELS[index] ?? String(index + 1),
    fullTitle: step.situacao || STEP_DESKTOP_LABELS[index],
    state: deriveStepVisualState(step, index, steps),
    isEstimated: false,
  }));
}

export function mapOsItemToProgressSteps(item: ClienteOsItem): ProgressStepView[] {
  const currentIndex = estimateStepIndexFromOsItem(item);
  const steps = buildEstimatedSteps(currentIndex);

  if (item.pendencia_tipo) {
    const pendenciaIndex = Math.min(currentIndex, PROGRESS_STEP_COUNT - 2);
    if (steps[pendenciaIndex]) {
      steps[pendenciaIndex] = { ...steps[pendenciaIndex], state: "warning" };
    }
  }

  return steps;
}

export function resolveProgressSteps(
  item: ClienteOsItem,
  timelineSteps: ClienteTimelineStep[] | undefined,
  timelineLoading: boolean,
): { steps: ProgressStepView[]; isEstimated: boolean; loading: boolean } {
  if (timelineLoading) {
    return {
      steps: mapOsItemToProgressSteps(item),
      isEstimated: true,
      loading: true,
    };
  }
  if (timelineSteps?.length) {
    return {
      steps: mapTimelineToProgressSteps(timelineSteps),
      isEstimated: false,
      loading: false,
    };
  }
  return {
    steps: mapOsItemToProgressSteps(item),
    isEstimated: true,
    loading: false,
  };
}

export function progressPercent(steps: ProgressStepView[]): number {
  if (!steps.length) return 0;
  const doneCount = steps.filter((s) => s.state === "done" || s.state === "final").length;
  const currentCount = steps.some((s) => s.state === "current" || s.state === "warning") ? 0.5 : 0;
  return Math.round(((doneCount + currentCount) / steps.length) * 100);
}
