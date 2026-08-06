import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";
import { searchParamAsString } from "@/lib/search-params";

const GerenciaPage = lazy(() =>
  import("@/features/gerencia/components/GerenciaPage").then((m) => ({
    default: m.GerenciaPage,
  })),
);

type GerenciaSearch = {
  ano?: string;
  id?: string;
  action?: string;
  type?: string;
  modo?: string;
};

export const Route = createFileRoute("/_authenticated/gerencia")({
  validateSearch: (search: Record<string, unknown>): GerenciaSearch => ({
    ano: searchParamAsString(search.ano),
    id: searchParamAsString(search.id),
    action: searchParamAsString(search.action),
    type: searchParamAsString(search.type),
    modo: searchParamAsString(search.modo),
  }),
  component: GerenciaRoute,
});

function GerenciaRoute() {
  const search = Route.useSearch();
  return (
    <AuthGuard requiredPermission="sb_gerencia">
      <Suspense fallback={<RoutePageFallback />}>
        <GerenciaPage search={search} />
      </Suspense>
    </AuthGuard>
  );
}
