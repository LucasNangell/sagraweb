import { createFileRoute } from "@tanstack/react-router";

import { ClienteProofBridgePage } from "@/features/cliente/components/ClienteProofBridgePage";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/os/$ano/$nrOs/prova")({
  component: ClienteOsProvaRoute,
});

function ClienteOsProvaRoute() {
  const { ano, nrOs } = Route.useParams();
  const anoNum = Number.parseInt(ano, 10);
  const nrOsNum = Number.parseInt(nrOs, 10);

  return (
    <ClienteAuthenticatedLayout>
      <ClienteProofBridgePage ano={anoNum} nrOs={nrOsNum} />
    </ClienteAuthenticatedLayout>
  );
}
