import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const ManipularImagemPage = lazy(() =>
  import("@/features/manipular-imagem/components/ManipularImagemPage").then(
    (m) => ({
      default: m.ManipularImagemPage,
    }),
  ),
);

export const Route = createFileRoute("/_authenticated/manipular-imagem")({
  component: ManipularImagemRoute,
});

function ManipularImagemRoute() {
  return (
    <AuthGuard requiredPermission="sb_manipular_imagem">
      <Suspense fallback={<RoutePageFallback />}>
        <ManipularImagemPage />
      </Suspense>
    </AuthGuard>
  );
}
