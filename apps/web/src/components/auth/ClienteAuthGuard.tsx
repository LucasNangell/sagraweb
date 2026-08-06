import { Navigate } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useEffect } from "react";

import { useClienteStore } from "@/features/cliente/clienteStore";

interface ClienteAuthGuardProps {
  children: ReactNode;
}

export function ClienteAuthGuard({ children }: ClienteAuthGuardProps) {
  const isHydrating = useClienteStore((s) => s.isHydrating);
  const isAuthenticated = useClienteStore((s) => s.isAuthenticated);
  const hydrate = useClienteStore((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  if (isHydrating) {
    return (
      <div className="flex min-h-[50vh] flex-col items-center justify-center gap-3 text-neutral-600">
        <div className="size-10 animate-spin rounded-full border-4 border-primary-green border-t-transparent" />
        <p className="text-sm">Validando sessão…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/cliente/login" replace />;
  }

  return <>{children}</>;
}
