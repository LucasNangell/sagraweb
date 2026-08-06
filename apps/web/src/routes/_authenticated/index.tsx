import { createFileRoute, Navigate } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { resolveDefaultAppRoute } from "@/components/layout/nav-config";
import { useAuthStore } from "@/features/auth/authStore";
import { hasPermission } from "@/features/auth/permissions";
import { OsHomePage } from "@/features/os/components/OsHomePage";

export const Route = createFileRoute("/_authenticated/")({
  component: HomeRoute,
});

function HomeRoute() {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const permissions = useAuthStore((s) => s.permissions);

  if (isHydrating) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-neutral-600">
        <div className="size-10 animate-spin rounded-full border-4 border-primary-green border-t-transparent" />
        <p className="text-sm">Validando sessão…</p>
      </div>
    );
  }

  if (isAuthenticated && !hasPermission(permissions, "sb_inicio")) {
    const fallback = resolveDefaultAppRoute(permissions);
    if (fallback !== "/") {
      return <Navigate to={fallback} replace />;
    }
  }

  return (
    <AuthGuard requiredPermission="sb_inicio">
      <OsHomePage />
    </AuthGuard>
  );
}
