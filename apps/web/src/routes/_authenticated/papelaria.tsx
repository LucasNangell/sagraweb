import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { PapelariaPage } from "@/features/papelaria/components/PapelariaPage";

export const Route = createFileRoute("/_authenticated/papelaria")({
  component: PapelariaRoute,
});

function PapelariaRoute() {
  return (
    <AuthGuard requiredPermission="sb_papelaria">
      <PapelariaPage />
    </AuthGuard>
  );
}
