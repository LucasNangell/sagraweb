import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";
import type { AnaliseSearchParams } from "@/features/analise/types";

const AnalisePage = lazy(() =>
  import("@/features/analise/components/AnalisePage").then((m) => ({
    default: m.AnalisePage,
  })),
);

export const Route = createFileRoute("/_authenticated/analise")({
  validateSearch: (search: Record<string, unknown>): AnaliseSearchParams => ({
    ano: typeof search.ano === "string" ? search.ano : undefined,
    id: typeof search.id === "string" ? search.id : undefined,
  }),
  component: AnaliseRoute,
});

function AnaliseRoute() {
  const search = Route.useSearch();
  return (
    <AuthGuard requiredPermission="sb_analise">
      <Suspense fallback={<RoutePageFallback />}>
        <AnalisePage search={search} />
      </Suspense>
    </AuthGuard>
  );
}
