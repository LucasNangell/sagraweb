import { createFileRoute } from "@tanstack/react-router";

import { ClientePtBridgePage } from "@/features/cliente/components/ClientePtBridgePage";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/os/$ano/$nrOs/problemas-tecnicos")({
  component: ClienteOsPtRoute,
});

function ClienteOsPtRoute() {
  const { ano, nrOs } = Route.useParams();
  const anoNum = Number.parseInt(ano, 10);
  const nrOsNum = Number.parseInt(nrOs, 10);

  return (
    <ClienteAuthenticatedLayout>
      <ClientePtBridgePage ano={anoNum} nrOs={nrOsNum} />
    </ClienteAuthenticatedLayout>
  );
}
