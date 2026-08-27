import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";
import { searchParamAsString } from "@/lib/search-params";

const OrcamentoPage = lazy(() =>
  import("@/features/orcamento/components/OrcamentoPage").then((m) => ({
    default: m.OrcamentoPage,
  })),
);

type OrcamentoSearch = {
  ano?: string;
  id?: string;
};

export const Route = createFileRoute("/_authenticated/orcamento")({
  validateSearch: (search: Record<string, unknown>): OrcamentoSearch => ({
    ano: searchParamAsString(search.ano),
    id: searchParamAsString(search.id),
  }),
  component: OrcamentoRoute,
});

function OrcamentoRoute() {
  const search = Route.useSearch();
  return (
    <AuthGuard requiredPermission="ctx_orcamento">
      <Suspense fallback={<RoutePageFallback />}>
        <OrcamentoPage ano={search.ano} id={search.id} />
      </Suspense>
    </AuthGuard>
  );
}
