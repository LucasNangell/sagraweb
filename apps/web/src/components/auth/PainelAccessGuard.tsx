import { useEffect, useState, type ReactNode } from "react";

import { fetchPainelScopePermissions } from "@/features/auth/api";
import { useAuthStore } from "@/features/auth/authStore";
import {
  canAccessPainelRoute,
  parsePermissionsFromApi,
} from "@/features/auth/permissions";
import type { Permissions } from "@/features/auth/types";

type PainelRoute = "/painel/global" | "/painel/setor";

interface PainelAccessGuardProps {
  route: PainelRoute;
  children: ReactNode;
}

export function PainelAccessGuard({ route, children }: PainelAccessGuardProps) {
  const isHydrating = useAuthStore((s) => s.isHydrating);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const sessionPermissions = useAuthStore((s) => s.permissions);
  const [ipPermissions, setIpPermissions] = useState<Permissions | null>(null);
  const [ipCheckState, setIpCheckState] = useState<
    "idle" | "loading" | "ready" | "denied"
  >("idle");

  useEffect(() => {
    if (isHydrating || isAuthenticated) {
      return;
    }

    let cancelled = false;
    setIpCheckState("loading");

    void fetchPainelScopePermissions()
      .then((raw) => {
        if (cancelled) {
          return;
        }
        setIpPermissions(parsePermissionsFromApi(raw));
        setIpCheckState("ready");
      })
      .catch(() => {
        if (!cancelled) {
          setIpCheckState("denied");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isHydrating]);

  if (isHydrating || (!isAuthenticated && ipCheckState === "loading")) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-neutral-400">
        <div className="size-10 animate-spin rounded-full border-4 border-primary-green border-t-transparent" />
        <p className="text-sm">Verificando permissões do painel…</p>
      </div>
    );
  }

  const effectivePermissions = isAuthenticated ? sessionPermissions : ipPermissions;
  const allowed =
    effectivePermissions != null && canAccessPainelRoute(effectivePermissions, route);

  if (!allowed) {
    const label = route === "/painel/global" ? "Painel global" : "Painel setor";
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-2 p-6 text-center">
        <p className="text-lg font-semibold text-sagra-danger">Acesso negado</p>
        <p className="max-w-md text-sm text-neutral-400">
          {label} não está liberado para este terminal ou usuário. Solicite a
          permissão em Admin IPs ou Usuários.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
