import { Link } from "@tanstack/react-router";

import { PermissionGate } from "@/components/auth/PermissionGate";
import { cn } from "@sagra/ui";

export function orcamentoOsSearch(
  ano: string | number | undefined,
  osId: string | number | undefined,
): { ano: string; id: string } | null {
  const year = parseInt(String(ano ?? "").trim(), 10);
  const id = parseInt(String(osId ?? "").trim(), 10);
  if (!Number.isFinite(year) || !Number.isFinite(id) || year <= 0 || id <= 0) {
    return null;
  }
  return { ano: String(year), id: String(id) };
}

const buttonClass =
  "inline-flex items-center rounded-md border border-secondary-blue/30 bg-white px-2 py-1 text-xs font-semibold text-secondary-blue shadow-sm transition hover:border-secondary-blue/50 hover:bg-slate-50";

export function OrcamentoCotaHeaderButton({
  ano,
  osId,
  className,
}: {
  ano?: string | number;
  osId?: string | number;
  className?: string;
}) {
  const search = orcamentoOsSearch(ano, osId);
  return (
    <PermissionGate permission="ctx_orcamento">
      {search ? (
        <Link
          to="/orcamento"
          search={search}
          className={cn(buttonClass, className)}
        >
          Orçamento
        </Link>
      ) : (
        <span
          className={cn(buttonClass, "cursor-not-allowed opacity-40", className)}
          title="Informe o número e o ano da OS para abrir o orçamento"
        >
          Orçamento
        </span>
      )}
    </PermissionGate>
  );
}
