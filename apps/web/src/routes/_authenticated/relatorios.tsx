import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const RelatorioPage = lazy(() =>
  import("@/features/relatorio/components/RelatorioPage").then((m) => ({
    default: m.RelatorioPage,
  })),
);

export const Route = createFileRoute("/_authenticated/relatorios")({
  component: RelatoriosRoute,
});

function RelatoriosRoute() {
  return (
    <AuthGuard requiredPermission="sb_relatorio">
      <Suspense fallback={<RoutePageFallback />}>
        <RelatorioPage />
      </Suspense>
    </AuthGuard>
  );
}
