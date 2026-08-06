import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { AdminIpsPage } from "@/features/admin-ips/components/AdminIpsPage";

export const Route = createFileRoute("/_authenticated/admin/ips")({
  component: AdminIpsRoute,
});

function AdminIpsRoute() {
  return (
    <AuthGuard requiredPermission="sb_admin_ips">
      <AdminIpsPage />
    </AuthGuard>
  );
}
