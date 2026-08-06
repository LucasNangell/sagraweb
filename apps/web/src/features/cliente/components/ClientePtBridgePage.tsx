import { useNavigate } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";

import { PortalPtPage } from "@/features/portal/PortalPtPage";
import { resolveVinculoDisplay } from "@/features/cliente/hooks/useClienteDashboardStats";
import { useClienteStore } from "@/features/cliente/clienteStore";

import { useClienteSupportUiStore } from "../clienteSupportUiStore";
import { useClienteDashboardOs } from "../hooks/useClienteDashboardOs";
import { ClienteLinkUnavailable } from "./ClienteLinkUnavailable";
import { ClienteOsContextHeader } from "./ClienteOsContextHeader";
import { ClientePortalBreadcrumb } from "./ClientePortalBreadcrumb";

interface ClientePtBridgePageProps {
  ano: number;
  nrOs: number;
}

export function ClientePtBridgePage({ ano, nrOs }: ClientePtBridgePageProps) {
  const navigate = useNavigate();
  const user = useClienteStore((s) => s.user);
  const { dashboardQuery, item, portalLink } = useClienteDashboardOs(ano, nrOs);

  const vinculo = resolveVinculoDisplay(dashboardQuery.data, user);
  const setFabContext = useClienteSupportUiStore((s) => s.setFabContext);

  useEffect(() => {
    if (!item) {
      return;
    }
    setFabContext({
      ano,
      nrOs,
      versao: item.versao ?? null,
    });
  }, [item, ano, nrOs, setFabContext]);

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500">
        <Loader2 className="size-8 animate-spin" aria-hidden />
        <span className="sr-only">Carregando…</span>
      </div>
    );
  }

  if (!item) {
    return (
      <ClienteLinkUnavailable
        title="OS não encontrada"
        message="Esta ordem de serviço não está vinculada ao seu gabinete ou não foi localizada no painel."
        onRefresh={() => void dashboardQuery.refetch()}
        isRefreshing={dashboardQuery.isFetching}
      />
    );
  }

  if (!portalLink || portalLink.type !== "pt" || !portalLink.token) {
    return (
      <>
        <ClientePortalBreadcrumb
          items={[
            { label: "Visão Geral", to: "/cliente" },
            { label: "Problemas Técnicos", to: "/cliente/problemas-tecnicos" },
            { label: `OS ${nrOs}/${ano}` },
          ]}
        />
        <ClienteOsContextHeader item={item} vinculoLabel={vinculo.primaryLabel} />
        <div className="mt-4">
          <ClienteLinkUnavailable
            title="Link ainda indisponível"
            message="O link para tratamento dos problemas técnicos ainda não foi gerado. Atualize o painel em alguns instantes ou entre em contato com a coordenação gráfica."
            onRefresh={() => void dashboardQuery.refetch()}
            isRefreshing={dashboardQuery.isFetching}
          />
        </div>
      </>
    );
  }

  return (
    <>
      <ClientePortalBreadcrumb
        items={[
          { label: "Visão Geral", to: "/cliente" },
          { label: "Problemas Técnicos", to: "/cliente/problemas-tecnicos" },
          { label: `OS ${nrOs}/${ano}` },
        ]}
      />
      <PortalPtPage
        token={portalLink.token}
        osId={nrOs}
        ano={ano}
        embedded
        onBack={() => void navigate({ to: "/cliente" })}
      />
    </>
  );
}
