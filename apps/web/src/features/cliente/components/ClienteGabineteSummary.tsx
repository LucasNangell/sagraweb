import { Building2, Mail, User } from "lucide-react";

import type { ClienteDashboardResponse } from "@/api/cliente-portal";
import type { ClienteUser } from "@/api/cliente-portal";
import { formatPonto } from "@/lib/format";

import {
  resolveVinculoDisplay,
  type ClienteDashboardStats,
} from "../hooks/useClienteDashboardStats";

interface ClienteGabineteSummaryProps {
  data: ClienteDashboardResponse;
  user: ClienteUser | null | undefined;
  stats: ClienteDashboardStats;
}

export function ClienteGabineteSummary({
  data,
  user,
  stats,
}: ClienteGabineteSummaryProps) {
  const vinculo = resolveVinculoDisplay(data, user);
  const gabinetePonto = (data.gabinete || user?.gabinete || "").trim();
  const pontoFormatted = gabinetePonto ? formatPonto(gabinetePonto) : "";

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex items-start gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary-blue/10 text-secondary-blue">
          <Building2 className="size-5" aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
            {vinculo.tipoLabel} vinculado
          </p>
          <p className="mt-0.5 truncate text-lg font-bold text-secondary-blue sm:text-xl">
            {vinculo.primaryLabel}
          </p>
          {vinculo.secondaryLabel ? (
            <p className="mt-0.5 line-clamp-2 text-sm text-neutral-600">
              {vinculo.secondaryLabel}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        {user?.nome ? (
          <div className="flex items-center gap-2 text-neutral-700">
            <User className="size-4 shrink-0 text-neutral-400" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">Usuário logado</dt>
              <dd className="truncate">
                <span className="font-medium">{user.nome}</span>
                {user.is_principal ? (
                  <span className="ml-1.5 rounded bg-secondary-blue/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-secondary-blue">
                    Principal
                  </span>
                ) : (
                  <span className="ml-1.5 text-xs text-neutral-500">Subconta</span>
                )}
              </dd>
            </div>
          </div>
        ) : null}

        {pontoFormatted ? (
          <div className="flex items-center gap-2 text-neutral-700">
            <dt className="text-xs font-semibold uppercase text-neutral-400">
              {user?.tipo_conta === "orgao" ? "Órgão" : "Gabinete"}
            </dt>
            <dd className="font-medium tabular-nums">{pontoFormatted}</dd>
          </div>
        ) : null}

        {user?.email ? (
          <div className="flex items-center gap-2 text-neutral-700 sm:col-span-2">
            <Mail className="size-4 shrink-0 text-neutral-400" aria-hidden />
            <div className="min-w-0">
              <dt className="sr-only">E-mail</dt>
              <dd className="truncate">{user.email}</dd>
            </div>
          </div>
        ) : null}
      </dl>

      {stats.lastUpdatedLabel ? (
        <p className="text-xs text-neutral-500">
          Dados atualizados{" "}
          <time dateTime={stats.lastDataAndamento ?? undefined}>
            {stats.lastUpdatedLabel}
          </time>
        </p>
      ) : null}
    </div>
  );
}
