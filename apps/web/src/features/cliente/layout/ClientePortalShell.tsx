import type { CSSProperties, ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import { PortalSystemHeader } from "@/components/portal/PortalSystemHeader";
import { cn } from "@sagra/ui";

import { ClientePortalContextBar } from "../components/ClientePortalContextBar";
import { ClientePortalNav } from "../components/ClientePortalNav";
import { useClienteStore } from "../clienteStore";
import { clienteDashboardQueryOptions } from "../hooks/clienteDashboardQuery";

interface ClientePortalShellProps {
  children: ReactNode;
  showNav?: boolean;
  /** Conteúdo em largura total (ex.: visualização de prova). */
  fullWidth?: boolean;
}

export function ClientePortalShell({
  children,
  showNav = true,
  fullWidth = false,
}: ClientePortalShellProps) {
  const navigate = useNavigate();
  const user = useClienteStore((s) => s.user);
  const logout = useClienteStore((s) => s.logout);
  const dashboardQuery = useQuery({
    ...clienteDashboardQueryOptions(),
    enabled: showNav,
  });

  const handleLogout = async () => {
    await logout();
    await navigate({ to: "/cliente/login" });
  };

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-sagra-bg",
        fullWidth && "max-h-dvh",
      )}
    >
      <PortalSystemHeader subtitle="Portal do Cliente — Acompanhamento de OSs" />
      {showNav ? (
        <ClientePortalContextBar
          data={dashboardQuery.data}
          user={user}
          isFetching={dashboardQuery.isFetching}
          onRefresh={() => void dashboardQuery.refetch()}
          onLogout={() => void handleLogout()}
        />
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        {showNav ? (
          <aside
            className={cn(
              "sagra-sidebar-nav z-40 shrink-0 border-sagra-border bg-white",
              "fixed inset-x-0 bottom-0 border-t pb-[env(safe-area-inset-bottom,0px)]",
              "md:relative md:inset-auto md:w-52 md:border-r md:border-t-0 md:pb-0",
            )}
          >
            <ClientePortalNav />
          </aside>
        ) : null}
        <main
          className={cn(
            "flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden",
            fullWidth
              ? "overflow-hidden p-0 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:pb-0"
              : "overflow-y-auto p-3 pb-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:p-4 md:pb-4 lg:p-5",
          )}
          style={
            fullWidth
              ? ({ "--preview-chrome-extra": "18rem" } satisfies CSSProperties)
              : undefined
          }
        >
          {children}
        </main>
      </div>
    </div>
  );
}
