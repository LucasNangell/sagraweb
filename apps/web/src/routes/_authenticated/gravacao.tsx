import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const GravacaoPage = lazy(() =>
  import("@/features/gravacao/components/GravacaoPage").then((m) => ({
    default: m.GravacaoPage,
  })),
);

export const Route = createFileRoute("/_authenticated/gravacao")({
  component: GravacaoRoute,
});

function GravacaoRoute() {
  return (
    <AuthGuard requiredPermission="sb_gravacao">
      <Suspense fallback={<RoutePageFallback />}>
        <GravacaoPage />
      </Suspense>
    </AuthGuard>
  );
}
