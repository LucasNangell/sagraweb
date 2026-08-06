import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";

import { useClienteStore } from "@/features/cliente/clienteStore";
import { resolveVinculoDisplay } from "@/features/cliente/hooks/useClienteDashboardStats";

import { useClienteDashboardOs } from "../hooks/useClienteDashboardOs";
import { ClienteLinkUnavailable } from "./ClienteLinkUnavailable";
import { ClienteOsContextHeader } from "./ClienteOsContextHeader";
import { ClientePortalBreadcrumb } from "./ClientePortalBreadcrumb";
import { ClienteProofPage } from "./proof/ClienteProofPage";

interface ClienteProofBridgePageProps {
  ano: number;
  nrOs: number;
}

export function ClienteProofBridgePage({ ano, nrOs }: ClienteProofBridgePageProps) {
  const navigate = useNavigate();
  const user = useClienteStore((s) => s.user);
  const { dashboardQuery, item, portalLink } = useClienteDashboardOs(ano, nrOs);
  const vinculo = resolveVinculoDisplay(dashboardQuery.data, user);

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center py-20 text-neutral-500">
        <Loader2 className="size-8 animate-spin" aria-hidden />
      </div>
    );
  }

  if (!item) {
    return (
      <div className="p-4 lg:p-5">
        <ClienteLinkUnavailable
          title="OS não encontrada"
          message="Esta ordem de serviço não está vinculada ao seu gabinete."
          onRefresh={() => void dashboardQuery.refetch()}
          isRefreshing={dashboardQuery.isFetching}
        />
      </div>
    );
  }

  if (!portalLink || portalLink.type !== "aprovacao" || !portalLink.token) {
    return (
      <div className="space-y-4 p-4 lg:p-5">
        <ClientePortalBreadcrumb
          items={[
            { label: "Visão Geral", to: "/cliente" },
            { label: "Provas", to: "/cliente/provas" },
            { label: `OS ${nrOs}/${ano}` },
          ]}
        />
        <ClienteOsContextHeader item={item} vinculoLabel={vinculo.primaryLabel} />
        <ClienteLinkUnavailable
          title="Prova indisponível"
          message="O link da prova ainda não está disponível. Aguarde o envio pela equipe gráfica ou atualize o painel."
          onRefresh={() => void dashboardQuery.refetch()}
          isRefreshing={dashboardQuery.isFetching}
        />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-sagra-border/80 bg-white px-4 py-3 lg:px-5">
        <ClientePortalBreadcrumb
          items={[
            { label: "Visão Geral", to: "/cliente" },
            { label: "Provas", to: "/cliente/provas" },
            { label: `OS ${nrOs}/${ano}` },
          ]}
        />
      </div>
      <ClienteProofPage
        token={portalLink.token}
        osId={nrOs}
        ano={ano}
        embedded
        hideStatusHeader
        fillHeight
        leftPanel={
          <ClienteOsContextHeader item={item} vinculoLabel={vinculo.primaryLabel} />
        }
        onBack={() => void navigate({ to: "/cliente/provas" })}
      />
    </div>
  );
}
