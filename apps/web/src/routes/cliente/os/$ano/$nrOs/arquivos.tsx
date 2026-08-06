import { createFileRoute } from "@tanstack/react-router";

import { ClienteArquivosBridgePage } from "@/features/cliente/components/ClienteArquivosBridgePage";
import { ClienteAuthenticatedLayout } from "@/features/cliente/layout/ClienteAuthenticatedLayout";

export const Route = createFileRoute("/cliente/os/$ano/$nrOs/arquivos")({
  component: ClienteOsArquivosRoute,
});

function ClienteOsArquivosRoute() {
  const { ano, nrOs } = Route.useParams();
  const anoNum = Number.parseInt(ano, 10);
  const nrOsNum = Number.parseInt(nrOs, 10);

  return (
    <ClienteAuthenticatedLayout>
      <ClienteArquivosBridgePage ano={anoNum} nrOs={nrOsNum} />
    </ClienteAuthenticatedLayout>
  );
}
