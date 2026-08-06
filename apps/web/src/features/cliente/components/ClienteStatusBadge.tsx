import type { ReactNode } from "react";

import { cn } from "@sagra/ui";

import type { SectionKind } from "../types/clienteProgress";

type BadgeVariant = "default" | "pendencia" | "andamento" | "setor" | "situacao";

interface ClienteStatusBadgeProps {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

const variantClasses: Record<BadgeVariant, string> = {
  default: "bg-neutral-100 text-neutral-700",
  pendencia: "bg-amber-50 text-amber-800 ring-1 ring-amber-200/90",
  andamento: "bg-emerald-50 text-emerald-800 ring-1 ring-emerald-200",
  setor: "bg-slate-100 text-slate-600",
  situacao: "bg-secondary-blue/10 text-secondary-blue",
};

export function ClienteStatusBadge({
  children,
  variant = "default",
  className,
}: ClienteStatusBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2.5 py-0.5 text-xs font-medium",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function pendenciaBadgeLabel(
  pendenciaTipo: string | null | undefined,
  versao?: string,
): string {
  switch (pendenciaTipo) {
    case "problema_tecnico":
      return "Problema técnico";
    case "aprovacao_prova":
      return versao ? `Aprovação da prova v${versao}` : "Aprovação da prova";
    case "envio_arquivo":
      return "Envio de arquivo";
    default:
      return "Pendência";
  }
}

export function sectionAccentClass(kind: SectionKind): string {
  switch (kind) {
    case "pendencias_pt":
      return "border-l-amber-500";
    case "pendencias_aprovacao":
      return "border-l-amber-600";
    case "pendencias_envio_arquivo":
      return "border-l-amber-400";
    case "pendencias_usuario":
      return "border-l-sky-500";
    case "em_andamento":
      return "border-l-primary-green";
    default:
      return "border-l-sagra-border";
  }
}
