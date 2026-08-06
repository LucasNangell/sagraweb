import { createFileRoute } from "@tanstack/react-router";

import { AuthGuard } from "@/components/auth/AuthGuard";
import { UsuariosPage } from "@/features/usuarios/components/UsuariosPage";

export const Route = createFileRoute("/_authenticated/usuarios")({
  component: UsuariosRoute,
});

function UsuariosRoute() {
  return (
    <AuthGuard requiredPermission="sb_usuarios">
      <UsuariosPage />
    </AuthGuard>
  );
}
