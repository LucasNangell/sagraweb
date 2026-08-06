import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const CotasGrafPage = lazy(() =>
  import("@/features/cotas-graf/components/CotasGrafPage").then((m) => ({
    default: m.CotasGrafPage,
  })),
);

export const Route = createFileRoute("/_authenticated/cotas-graf")({
  component: CotasGrafRoute,
});

function CotasGrafRoute() {
  return (
    <AuthGuard requiredPermission="sb_cotas_graf">
      <Suspense fallback={<RoutePageFallback />}>
        <CotasGrafPage />
      </Suspense>
    </AuthGuard>
  );
}
