import { Loader2 } from "lucide-react";

import { PortalOsArquivosPage } from "@/features/portal/PortalOsArquivosPage";
import { useClienteStore } from "@/features/cliente/clienteStore";
import { resolveVinculoDisplay } from "@/features/cliente/hooks/useClienteDashboardStats";

import { useClienteDashboardOs } from "../hooks/useClienteDashboardOs";
import { ClienteLinkUnavailable } from "./ClienteLinkUnavailable";
import { ClienteOsContextHeader } from "./ClienteOsContextHeader";
import { ClientePortalBreadcrumb } from "./ClientePortalBreadcrumb";

interface ClienteArquivosBridgePageProps {
  ano: number;
  nrOs: number;
}

export function ClienteArquivosBridgePage({ ano, nrOs }: ClienteArquivosBridgePageProps) {
  const user = useClienteStore((s) => s.user);
  const { dashboardQuery, item, portalLink } = useClienteDashboardOs(ano, nrOs);
  const vinculo = resolveVinculoDisplay(dashboardQuery.data, user);

  if (dashboardQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-20 text-neutral-500">
        <Loader2 className="size-8 animate-spin" aria-hidden />
      </div>
    );
  }

  if (!item) {
    return (
      <ClienteLinkUnavailable
        title="OS não encontrada"
        message="Esta ordem de serviço não está vinculada ao seu gabinete."
        onRefresh={() => void dashboardQuery.refetch()}
        isRefreshing={dashboardQuery.isFetching}
      />
    );
  }

  if (!portalLink || portalLink.type !== "arquivos" || !portalLink.token) {
    return (
      <>
        <ClientePortalBreadcrumb
          items={[
            { label: "Visão Geral", to: "/cliente" },
            { label: `OS ${nrOs}/${ano}` },
          ]}
        />
        <ClienteOsContextHeader item={item} vinculoLabel={vinculo.primaryLabel} />
        <div className="mt-4">
          <ClienteLinkUnavailable
            title="Envio indisponível"
            message="O link para envio de arquivos ainda não foi gerado. Atualize o painel ou aguarde contato da equipe gráfica."
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
          { label: `OS ${nrOs}/${ano} — Arquivos` },
        ]}
      />
      <PortalOsArquivosPage token={portalLink.token} osId={nrOs} ano={ano} />
    </>
  );
}
