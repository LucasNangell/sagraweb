import { LogOut, RefreshCw, User } from "lucide-react";

import type { ClienteDashboardResponse, ClienteUser } from "@/api/cliente-portal";
import { formatPonto } from "@/lib/format";
import { cn } from "@sagra/ui";

import { resolveClienteContextBar } from "../hooks/useClienteDashboardStats";

interface ClientePortalContextBarProps {
  data: ClienteDashboardResponse | undefined;
  user: ClienteUser | null | undefined;
  isFetching: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}

export function ClientePortalContextBar({
  data,
  user,
  isFetching,
  onRefresh,
  onLogout,
}: ClientePortalContextBarProps) {
  const ctx = resolveClienteContextBar(data, user);
  const gabineteDisplay = ctx.gabinete !== "—" ? formatPonto(ctx.gabinete) : "—";

  return (
    <div className="shrink-0 border-b border-sagra-border/80 bg-white shadow-sm">
      <div className="flex w-full flex-col gap-3 px-4 py-3 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-[0.65rem] font-semibold uppercase tracking-wide text-neutral-500">
            Solicitante
          </p>
          <p className="truncate text-lg font-bold text-secondary-blue sm:text-xl">
            {ctx.solicitante}
          </p>
          <dl className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600">
            <div className="inline-flex items-center gap-1.5">
              <dt className="font-semibold text-neutral-500">{ctx.deputadoOuOrgaoLabel}:</dt>
              <dd className="truncate font-medium">{ctx.deputadoOuOrgao}</dd>
            </div>
            <div className="inline-flex items-center gap-1.5">
              <dt className="font-semibold text-neutral-500">{ctx.gabineteLabel}:</dt>
              <dd className="font-medium tabular-nums">{gabineteDisplay}</dd>
            </div>
            <div className="inline-flex min-w-0 items-center gap-1.5">
              <User className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
              <dt className="sr-only">Usuário logado</dt>
              <dd className="truncate">
                <span className="font-medium">{ctx.usuarioNome}</span>
                {ctx.isPrincipal ? (
                  <span className="ml-1 rounded bg-secondary-blue/10 px-1 py-0.5 text-[10px] font-semibold uppercase text-secondary-blue">
                    Principal
                  </span>
                ) : null}
                {ctx.usuarioEmail ? (
                  <span className="ml-1 hidden text-neutral-500 sm:inline">
                    · {ctx.usuarioEmail}
                  </span>
                ) : null}
              </dd>
            </div>
          </dl>
        </div>

        <div className="flex shrink-0 gap-2 self-end lg:self-auto">
          <button
            type="button"
            onClick={onRefresh}
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-sagra-border bg-white px-3 py-2 text-sm",
              "transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-secondary-blue",
            )}
          >
            <RefreshCw
              className={cn("size-4", isFetching && "motion-safe:animate-spin")}
              aria-hidden
            />
            <span>Atualizar</span>
          </button>
          <button
            type="button"
            onClick={onLogout}
            className={cn(
              "inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-sagra-border bg-white px-3 py-2 text-sm text-red-700",
              "transition-colors hover:bg-red-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500",
            )}
          >
            <LogOut className="size-4" aria-hidden />
            <span>Sair</span>
          </button>
        </div>
      </div>
    </div>
  );
}
