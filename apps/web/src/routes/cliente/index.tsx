import { createFileRoute } from "@tanstack/react-router";

import { ClienteDashboardPage } from "@/features/cliente/components/ClienteDashboardPage";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/")({
  component: ClienteHomeRoute,
});

function ClienteHomeRoute() {
  return (
    <ClienteAuthenticatedLayout>
      <ClienteDashboardPage />
    </ClienteAuthenticatedLayout>
  );
}
