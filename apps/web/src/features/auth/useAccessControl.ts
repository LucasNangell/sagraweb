import { useMemo } from "react";

import { getVisibleNavItems } from "@/components/layout/nav-config";
import { getVisibleContextMenuItems } from "@/features/os/contextMenuActions";
import type { OsSearchRow } from "@/features/os/types";

import { hasPermission } from "./permissions";
import { useAuthStore } from "./authStore";
import type { PermissionKey } from "./types";

/**
 * Controle de acesso reativo — inscreve em `permissions` (não só em hasPermission)
 * para o menu lateral e contexto atualizarem após login/hidratação.
 */
export function useAccessControl() {
  const permissions = useAuthStore((s) => s.permissions);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isHydrating = useAuthStore((s) => s.isHydrating);

  const isReady = isAuthenticated && !isHydrating;

  const can = useMemo(
    () =>
      (key: PermissionKey): boolean => {
        if (!isReady) {
          return false;
        }
        return hasPermission(permissions, key);
      },
    [isReady, permissions],
  );

  const navItems = useMemo(
    () => getVisibleNavItems(permissions, isReady),
    [permissions, isReady],
  );

  const contextMenuForRow = useMemo(
    () => (row: OsSearchRow | null) => getVisibleContextMenuItems(can, row),
    [can],
  );

  return {
    permissions,
    isAuthenticated,
    isHydrating,
    isReady,
    can,
    navItems,
    contextMenuForRow,
  };
}
