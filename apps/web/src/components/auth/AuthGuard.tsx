import { Navigate } from "@tanstack/react-router";

import type { ReactNode } from "react";



import { useAuthStore } from "@/features/auth/authStore";

import { hasPermission as checkPermission } from "@/features/auth/permissions";

import type { PermissionKey } from "@/features/auth/types";



interface AuthGuardProps {
  children: ReactNode;
  /** Permissão de sidebar exigida para a rota (ex.: sb_inicio). */
  requiredPermission?: PermissionKey;
  /** Aceita se o usuário tiver qualquer uma das permissões listadas. */
  requiredAnyPermission?: PermissionKey[];
}



export function AuthGuard({ children, requiredPermission, requiredAnyPermission }: AuthGuardProps) {

  const isHydrating = useAuthStore((s) => s.isHydrating);

  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const permissions = useAuthStore((s) => s.permissions);



  if (isHydrating) {

    return (

      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-neutral-600">

        <div className="size-10 animate-spin rounded-full border-4 border-primary-green border-t-transparent" />

        <p className="text-sm">Validando sessão…</p>

      </div>

    );

  }



  if (!isAuthenticated) {

    return <Navigate to="/login" replace />;

  }



  const hasRequired =
    !requiredPermission && (!requiredAnyPermission || requiredAnyPermission.length === 0)
      ? true
      : requiredAnyPermission && requiredAnyPermission.length > 0
        ? requiredAnyPermission.some((perm) => checkPermission(permissions, perm))
        : requiredPermission
          ? checkPermission(permissions, requiredPermission)
          : true;

  if (!hasRequired) {

    return (

      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-2 p-6 text-center">

        <p className="text-lg font-semibold text-sagra-danger">Acesso negado</p>

        <p className="text-sm text-neutral-600">

          Sua sessão não tem permissão para este módulo. Solicite acesso ao

          administrador.

        </p>

      </div>

    );

  }



  return <>{children}</>;

}

