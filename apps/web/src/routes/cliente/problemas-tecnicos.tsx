import { createFileRoute } from "@tanstack/react-router";

import { ClientePendenciasListPage } from "@/features/cliente/components/ClientePendenciasListPage";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/problemas-tecnicos")({
  component: ClienteProblemasTecnicosRoute,
});

function ClienteProblemasTecnicosRoute() {
  return (
    <ClienteAuthenticatedLayout>
      <ClientePendenciasListPage
        sectionKind="pendencias_pt"
        breadcrumbLabel="Problemas Técnicos"
        breadcrumbPath="/cliente/problemas-tecnicos"
      />
    </ClienteAuthenticatedLayout>
  );
}
