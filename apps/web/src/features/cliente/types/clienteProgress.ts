export type StepVisualState = "done" | "current" | "pending" | "warning" | "final";

export type SectionKind =
  | "pendencias_pt"
  | "pendencias_aprovacao"
  | "pendencias_envio_arquivo"
  | "pendencias_usuario"
  | "em_andamento";

export interface ProgressStepView {
  index: number;
  label: string;
  shortLabel: string;
  fullTitle: string;
  state: StepVisualState;
  isEstimated: boolean;
}

export const PROGRESS_STEP_COUNT = 7;

export const STEP_SHORT_LABELS = [
  "Ent.",
  "Pré-imp.",
  "Prep.",
  "Impr.",
  "Acab.",
  "Exp.",
  "Entreg.",
] as const;

export const STEP_DESKTOP_LABELS = [
  "Entrada",
  "Pré-impressão",
  "Preparação",
  "Impressão",
  "Acabamento",
  "Expedição",
  "Entregue",
] as const;
