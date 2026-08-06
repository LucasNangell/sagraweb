import { createFileRoute } from "@tanstack/react-router";

import { ClientePendenciasListPage } from "@/features/cliente/components/ClientePendenciasListPage";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/pendencia-usuario")({
  component: ClientePendenciaUsuarioRoute,
});

function ClientePendenciaUsuarioRoute() {
  return (
    <ClienteAuthenticatedLayout>
      <ClientePendenciasListPage
        sectionKind="pendencias_usuario"
        breadcrumbLabel="Pendência usuário"
        breadcrumbPath="/cliente/pendencia-usuario"
      />
    </ClienteAuthenticatedLayout>
  );
}
