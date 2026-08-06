import { useQuery } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useCallback, useState } from "react";

import { useClienteStore } from "@/features/cliente/clienteStore";

import { clienteDashboardQueryOptions } from "../hooks/clienteDashboardQuery";
import {
  useClienteDashboardStats,
  resolveVinculoDisplay,
} from "../hooks/useClienteDashboardStats";
import type { SectionKind } from "../types/clienteProgress";
import { ClienteCollapsibleWorkBoard } from "./ClienteCollapsibleWorkBoard";
import { ClienteDashboardSkeleton } from "./ClienteDashboardSkeleton";
import { ClientePortalHero } from "./ClientePortalHero";

export function ClienteDashboardPage() {
  const user = useClienteStore((s) => s.user);
  const dashboardQuery = useQuery(clienteDashboardQueryOptions());

  const [navigateToSection, setNavigateToSection] = useState<SectionKind | null>(null);

  const data = dashboardQuery.data;
  const stats = useClienteDashboardStats(data, dashboardQuery.dataUpdatedAt);
  const vinculo = resolveVinculoDisplay(data, user);

  const handleSectionNavigate = useCallback((kind: SectionKind) => {
    setNavigateToSection(kind);
  }, []);

  const sanitizedErrorMessage = (() => {
    if (!dashboardQuery.isError) {
      return "";
    }
    const message =
      dashboardQuery.error instanceof Error ? dashboardQuery.error.message : "";
    const normalized = message.trim().toLowerCase();
    if (
      !message ||
      normalized.includes("network") ||
      normalized.includes("timeout") ||
      normalized.includes("failed") ||
      normalized.includes("request")
    ) {
      return "Não foi possível atualizar o painel agora. Verifique a conexão e tente novamente.";
    }
    return message;
  })();

  return (
    <>
      {dashboardQuery.isLoading ? (
        <ClienteDashboardSkeleton />
      ) : dashboardQuery.isError ? (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-4 text-sm text-red-800 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="inline-flex items-start gap-2">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>{sanitizedErrorMessage || "Erro ao carregar dados."}</span>
            </p>
            <button
              type="button"
              onClick={() => void dashboardQuery.refetch()}
              className="inline-flex min-h-11 items-center justify-center rounded-xl border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      ) : data ? (
        <div className="space-y-6 motion-safe:animate-[fadeIn_280ms_ease-out]">
          <ClientePortalHero
            stats={stats}
            onSectionNavigate={handleSectionNavigate}
          />
          <ClienteCollapsibleWorkBoard
            data={data}
            vinculoLabel={vinculo.primaryLabel}
            navigateToSection={navigateToSection}
            onNavigateHandled={() => setNavigateToSection(null)}
          />
        </div>
      ) : null}
    </>
  );
}
