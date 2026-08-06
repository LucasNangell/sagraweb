import { createFileRoute } from "@tanstack/react-router";

import { ClientePendenciasListPage } from "@/features/cliente/components/ClientePendenciasListPage";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/provas")({
  component: ClienteProvasRoute,
});

function ClienteProvasRoute() {
  return (
    <ClienteAuthenticatedLayout>
      <ClientePendenciasListPage
        sectionKind="pendencias_aprovacao"
        breadcrumbLabel="Provas"
        breadcrumbPath="/cliente/provas"
      />
    </ClienteAuthenticatedLayout>
  );
}
