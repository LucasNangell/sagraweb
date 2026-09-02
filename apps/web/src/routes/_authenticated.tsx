import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { AppShell } from "@/components/layout/AppShell";
import { AdminForceRefreshListener } from "@/hooks/useAdminForceRefreshReload";

export const Route = createFileRoute("/_authenticated")({
  component: AuthenticatedLayout,
});

function AuthenticatedLayout() {
  return (
    <AuthGuard>
      <AdminForceRefreshListener />
      <AppShell />
    </AuthGuard>
  );
}
