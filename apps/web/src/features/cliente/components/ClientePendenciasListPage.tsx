import { useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useCallback, useState } from "react";

import { fetchClienteDashboard } from "@/api/cliente-portal";

import { resolveVinculoDisplay } from "../hooks/useClienteDashboardStats";
import type { SectionKind } from "../types/clienteProgress";
import { CLIENTE_SECTIONS } from "../utils/clienteSectionConfig";
import { useClienteStore } from "../clienteStore";
import { ClienteCompactOsCard } from "./ClienteCompactOsCard";
import { ClientePortalBreadcrumb } from "./ClientePortalBreadcrumb";
import { ClienteSectionEmptyState } from "./ClienteSectionEmptyState";

function osKey(item: { ano: number; nr_os: number }) {
  return `${item.ano}-${item.nr_os}`;
}

interface ClientePendenciasListPageProps {
  sectionKind: SectionKind;
  breadcrumbLabel: string;
  breadcrumbPath: string;
}

export function ClientePendenciasListPage({
  sectionKind,
  breadcrumbLabel,
  breadcrumbPath,
}: ClientePendenciasListPageProps) {
  const user = useClienteStore((s) => s.user);
  const config = CLIENTE_SECTIONS.find((s) => s.kind === sectionKind)!;

  const dashboardQuery = useQuery({
    queryKey: ["cliente", "dashboard"],
    queryFn: fetchClienteDashboard,
    staleTime: 60_000,
  });

  const [expandedOsKeys, setExpandedOsKeys] = useState<Set<string>>(() => new Set());

  const toggleOsExpand = useCallback((key: string) => {
    setExpandedOsKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const data = dashboardQuery.data;
  const vinculo = resolveVinculoDisplay(data, user);
  const items = data ? config.getItems(data) : [];

  return (
    <>
      <ClientePortalBreadcrumb
        items={[
          { label: "Visão Geral", to: "/cliente" },
          { label: breadcrumbLabel, to: breadcrumbPath },
        ]}
      />
      <h1 className="mb-4 text-xl font-bold text-secondary-blue">{config.title}</h1>
      <p className="mb-6 text-sm text-neutral-600">{config.description}</p>

      {dashboardQuery.isLoading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="size-8 animate-spin text-neutral-400" />
        </div>
      ) : !items.length ? (
        <ClienteSectionEmptyState message={config.emptyMessage} />
      ) : (
        <ul className="space-y-3">
          {items.map((item, index) => {
            const key = osKey(item);
            return (
              <li key={key}>
                <ClienteCompactOsCard
                  item={item}
                  sectionKind={sectionKind}
                  vinculoLabel={vinculo.primaryLabel}
                  showPendenciaButton={config.showPendenciaButton}
                  expanded={expandedOsKeys.has(key)}
                  onToggleExpand={() => toggleOsExpand(key)}
                  animationIndex={index}
                />
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
