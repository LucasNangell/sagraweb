import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { useAuthStore } from "@/features/auth/authStore";
import { hasPainelTabletAccess } from "@/features/auth/permissions";

interface TabletAccessGuardProps {
  children: ReactNode;
  /** Rota de retorno após login (tablet, celular ou gravação). */
  loginRedirect?: "/painel/tablet" | "/painel/celular" | "/painel/gravacao";
}

/** Exige sessão autenticada com `sb_dashboard_tablet` (sem acesso só por IP). */
export function TabletAccessGuard({
  children,
  loginRedirect = "/painel/tablet",
}: TabletAccessGuardProps) {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const permissions = useAuthStore((s) => s.permissions);

  if (isHydrating) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-neutral-400">
        <div className="size-10 animate-spin rounded-full border-4 border-primary-green border-t-transparent" />
        <p className="text-sm">Verificando acesso ao painel…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <Navigate
        to="/login"
        search={{ redirect: loginRedirect }}
        replace
      />
    );
  }

  if (!hasPainelTabletAccess(permissions)) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-semibold text-sagra-danger">Acesso negado</p>
        <p className="max-w-md text-sm text-neutral-400">
          O painel tablet não está liberado para este usuário. Solicite a
          permissão em Usuários (administrador) e faça login novamente.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
