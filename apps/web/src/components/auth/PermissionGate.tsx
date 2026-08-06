import type { ReactNode } from "react";

import { useAuthStore } from "@/features/auth/authStore";
import { hasPermission as checkPermission } from "@/features/auth/permissions";
import type { PermissionKey } from "@/features/auth/types";

interface PermissionGateProps {
  permission: PermissionKey;
  children: ReactNode;
  fallback?: ReactNode;
}

/** Renderiza filhos apenas se a permissão estiver explicitamente concedida. */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: PermissionGateProps) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const permissions = useAuthStore((s) => s.permissions);

  if (!isAuthenticated || !checkPermission(permissions, permission)) {
    return <>{fallback}</>;
  }
  return <>{children}</>;
}
