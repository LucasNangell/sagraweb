import { createFileRoute } from "@tanstack/react-router";

import { ClienteContasPanel } from "@/features/cliente/components/ClienteContasPanel";
import { ClientePortalBreadcrumb } from "@/features/cliente/components/ClientePortalBreadcrumb";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/contas")({
  component: ClienteContasRoute,
});

function ClienteContasRoute() {
  return (
    <ClienteAuthenticatedLayout>
      <ClientePortalBreadcrumb
        items={[
          { label: "Visão Geral", to: "/cliente" },
          { label: "Contas" },
        ]}
      />
      <h1 className="mb-4 text-xl font-bold text-secondary-blue">Contas do gabinete</h1>
      <p className="mb-6 text-sm text-neutral-600">
        Gerencie subcontas com acesso ao portal do seu gabinete.
      </p>
      <ClienteContasPanel />
    </ClienteAuthenticatedLayout>
  );
}
