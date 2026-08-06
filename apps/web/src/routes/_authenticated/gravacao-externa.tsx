import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const GravacaoExternaPage = lazy(() =>
  import("@/features/gravacao-externa/components/GravacaoExternaPage").then((m) => ({
    default: m.GravacaoExternaPage,
  })),
);

export const Route = createFileRoute("/_authenticated/gravacao-externa")({
  component: GravacaoExternaRoute,
});

function GravacaoExternaRoute() {
  return (
    <AuthGuard requiredAnyPermission={["sb_gravacao_externa", "sb_gravacao_pendente"]}>
      <Suspense fallback={<RoutePageFallback />}>
        <GravacaoExternaPage />
      </Suspense>
    </AuthGuard>
  );
}
