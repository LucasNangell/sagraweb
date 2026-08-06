import { cn } from "@sagra/ui";

export type ProofUiStatus =
  | "pending"
  | "approved"
  | "adjustment_requested"
  | "unavailable"
  | "error";

const LABELS: Record<ProofUiStatus, string> = {
  pending: "Aguardando aprovação",
  approved: "Aprovada",
  adjustment_requested: "Ajuste solicitado",
  unavailable: "Indisponível",
  error: "Erro ao carregar",
};

const STYLES: Record<ProofUiStatus, string> = {
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  approved: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  adjustment_requested: "bg-red-50 text-red-800 ring-red-200",
  unavailable: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  error: "bg-red-50 text-red-800 ring-red-200",
};

interface ClienteProofStatusBadgeProps {
  status: ProofUiStatus;
  className?: string;
}

export function ClienteProofStatusBadge({
  status,
  className,
}: ClienteProofStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ring-inset",
        STYLES[status],
        className,
      )}
    >
      {LABELS[status]}
    </span>
  );
}
