import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { ProvaWebPage } from "@/features/prova-web/ProvaWebPage";

export const Route = createFileRoute("/prova-web/$ano/$id")({
  component: ProvaWebRoute,
});

function ProvaWebRoute() {
  const { ano, id } = Route.useParams();
  return (
    <AuthGuard requiredPermission="ctx_prova_web">
      <ProvaWebPage ano={Number(ano)} osId={Number(id)} />
    </AuthGuard>
  );
}
