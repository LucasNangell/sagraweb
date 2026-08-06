import { createFileRoute } from "@tanstack/react-router";

import { PortalAprovacaoPage } from "@/features/portal/PortalAprovacaoPage";

export const Route = createFileRoute("/portal/aprovacao/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    os: Number(search.os) || 0,
    ano: Number(search.ano) || 0,
  }),
  component: PortalAprovacaoRoute,
});

function PortalAprovacaoRoute() {
  const { token } = Route.useParams();
  const { os, ano } = Route.useSearch();
  return <PortalAprovacaoPage token={token} osId={os} ano={ano} />;
}
