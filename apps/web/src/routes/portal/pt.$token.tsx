import { createFileRoute } from "@tanstack/react-router";

import { PortalPtPage } from "@/features/portal/PortalPtPage";

export const Route = createFileRoute("/portal/pt/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    os: Number(search.os) || 0,
    ano: Number(search.ano) || 0,
  }),
  component: PortalPtRoute,
});

function PortalPtRoute() {
  const { token } = Route.useParams();
  const { os, ano } = Route.useSearch();
  return <PortalPtPage token={token} osId={os} ano={ano} />;
}
