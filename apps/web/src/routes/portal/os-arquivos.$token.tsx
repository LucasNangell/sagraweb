import { createFileRoute } from "@tanstack/react-router";

import { PortalOsArquivosPage } from "@/features/portal/PortalOsArquivosPage";

export const Route = createFileRoute("/portal/os-arquivos/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    os: Number(search.os) || 0,
    ano: Number(search.ano) || 0,
  }),
  component: PortalOsArquivosRoute,
});

function PortalOsArquivosRoute() {
  const { token } = Route.useParams();
  const { os, ano } = Route.useSearch();
  return <PortalOsArquivosPage token={token} osId={os} ano={ano} />;
}
