import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const EstoquePage = lazy(() =>
  import("@/features/estoque/components/EstoquePage").then((m) => ({
    default: m.EstoquePage,
  })),
);

export const Route = createFileRoute("/_authenticated/estoque")({
  component: EstoqueRoute,
});

function EstoqueRoute() {
  return (
    <AuthGuard requiredAnyPermission={["sb_estoque", "sb_estoque_gerente"]}>
      <Suspense fallback={<RoutePageFallback />}>
        <EstoquePage />
      </Suspense>
    </AuthGuard>
  );
}
