import { Link } from "@tanstack/react-router";
import { AlertCircle } from "lucide-react";

import type { ClienteOsItem } from "@/api/cliente-portal";
import { cn } from "@sagra/ui";

import {
  getClienteOsActionLabel,
  getClienteOsActionParams,
  getClienteOsActionPath,
} from "../utils/pendenciaBridge";
import { isProofApprovalPending, PROOF_VIEW_LABEL } from "../utils/proofApprovalUtils";
import type { SectionKind } from "../types/clienteProgress";
import { ClientePendingAction } from "./ClientePendingAction";

interface ClienteOsActionButtonProps {
  item: ClienteOsItem;
  showPendenciaButton?: boolean;
  sectionKind?: SectionKind;
  size?: "sm" | "md";
  className?: string;
}

export function ClienteOsActionButton({
  item,
  showPendenciaButton = false,
  sectionKind,
  size = "sm",
  className,
}: ClienteOsActionButtonProps) {
  const proofPending = isProofApprovalPending(item, sectionKind);
  const pendenciaTipo = item.pendencia_tipo ?? (proofPending ? "aprovacao_prova" : null);

  if (!showPendenciaButton || !pendenciaTipo) {
    return null;
  }

  const routeTemplate = getClienteOsActionPath({ ...item, pendencia_tipo: pendenciaTipo });
  const label =
    pendenciaTipo === "aprovacao_prova"
      ? PROOF_VIEW_LABEL
      : getClienteOsActionLabel(pendenciaTipo);

  const isProofAction = pendenciaTipo === "aprovacao_prova";

  if (routeTemplate) {
    return (
      <Link
        to={routeTemplate}
        params={getClienteOsActionParams(item)}
        className={cn(
          "inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl font-medium text-white shadow-sm",
          "w-full sm:w-auto",
          "transition-all duration-200 active:scale-[0.98]",
          "motion-reduce:transition-none motion-reduce:active:scale-100",
          isProofAction
            ? "bg-secondary-blue hover:bg-secondary-blue/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue"
            : "bg-primary-green hover:bg-primary-green/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-green",
          size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm",
          className,
        )}
      >
        <span className="truncate">{label}</span>
      </Link>
    );
  }

  if (item.pendencia_url) {
    return (
      <ClientePendingAction href={item.pendencia_url} label={label} size={size} className={className} />
    );
  }

  return (
    <span
      className={cn(
        "inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800",
        className,
      )}
      role="status"
    >
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      Aguardando geração do link
    </span>
  );
}
