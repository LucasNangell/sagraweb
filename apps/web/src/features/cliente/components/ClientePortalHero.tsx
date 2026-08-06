import type { ClienteDashboardStats } from "../hooks/useClienteDashboardStats";
import type { SectionKind } from "../types/clienteProgress";
import { ClientePortalStats } from "./ClientePortalStats";

interface ClientePortalHeroProps {
  stats: ClienteDashboardStats;
  onSectionNavigate?: (kind: SectionKind) => void;
}

export function ClientePortalHero({
  stats,
  onSectionNavigate,
}: ClientePortalHeroProps) {
  return (
    <section
      className="overflow-hidden rounded-2xl border border-sagra-border bg-white shadow-sm"
      aria-labelledby="cliente-portal-hero-title"
    >
      <div className="border-b border-sagra-border/70 bg-gradient-to-br from-secondary-blue/[0.04] to-primary-green/[0.06] px-4 py-4 sm:px-6">
        <h1
          id="cliente-portal-hero-title"
          className="text-lg font-bold tracking-tight text-secondary-blue sm:text-xl"
        >
          Visão geral das ordens de serviço
        </h1>
        <p className="mt-1 text-sm text-neutral-600">
          Pendências, provas aguardando aprovação e publicações em andamento.
        </p>
        {stats.lastUpdatedLabel ? (
          <p className="mt-1 text-xs text-neutral-400">
            Dados atualizados {stats.lastUpdatedLabel}
          </p>
        ) : null}
      </div>

      <div className="p-4 sm:p-6">
        <ClientePortalStats stats={stats} onSectionNavigate={onSectionNavigate} />
      </div>
    </section>
  );
}
