import { createFileRoute } from "@tanstack/react-router";

import { PortalProvaPage } from "@/features/portal/PortalProvaPage";

export const Route = createFileRoute("/portal/prova/$token")({
  validateSearch: (search: Record<string, unknown>) => ({
    os: Number(search.os) || 0,
    ano: Number(search.ano) || 0,
  }),
  component: PortalProvaRoute,
});

function PortalProvaRoute() {
  const { token } = Route.useParams();
  const { os, ano } = Route.useSearch();
  return <PortalProvaPage token={token} osId={os} ano={ano} />;
}
