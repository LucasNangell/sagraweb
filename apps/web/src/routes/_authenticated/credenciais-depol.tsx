import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const CredenciaisDepolPage = lazy(() =>
  import("@/features/credenciais-depol/components/CredenciaisDepolPage").then(
    (m) => ({ default: m.CredenciaisDepolPage }),
  ),
);

export const Route = createFileRoute("/_authenticated/credenciais-depol")({
  component: CredenciaisDepolRoute,
});

function CredenciaisDepolRoute() {
  return (
    <AuthGuard requiredPermission="sb_credenciais_depol">
      <Suspense fallback={<RoutePageFallback />}>
        <CredenciaisDepolPage />
      </Suspense>
    </AuthGuard>
  );
}
