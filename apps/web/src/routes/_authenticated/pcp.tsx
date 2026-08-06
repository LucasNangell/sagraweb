import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const PcpPage = lazy(() =>
  import("@/features/pcp/components/PcpPage").then((m) => ({
    default: m.PcpPage,
  })),
);

export const Route = createFileRoute("/_authenticated/pcp")({
  component: PcpRoute,
});

function PcpRoute() {
  return (
    <AuthGuard requiredPermission="sb_pcp">
      <Suspense fallback={<RoutePageFallback />}>
        <PcpPage />
      </Suspense>
    </AuthGuard>
  );
}
