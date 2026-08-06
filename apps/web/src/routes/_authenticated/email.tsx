import { createFileRoute } from "@tanstack/react-router";
import { lazy, Suspense } from "react";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { RoutePageFallback } from "@/components/RoutePageFallback";

const EmailPage = lazy(() =>
  import("@/features/email/components/EmailPage").then((m) => ({
    default: m.EmailPage,
  })),
);

export const Route = createFileRoute("/_authenticated/email")({
  component: EmailRoute,
});

function EmailRoute() {
  return (
    <AuthGuard requiredPermission="sb_email">
      <Suspense fallback={<RoutePageFallback />}>
        <EmailPage />
      </Suspense>
    </AuthGuard>
  );
}
