import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AdminForceRefreshListener } from "@/hooks/useAdminForceRefreshReload";

/** Painéis TV/monitor — sem AppShell; acesso conforme permissões IP/usuário. */
export const Route = createFileRoute("/painel")({
  component: PainelLayout,
});

function PainelLayout() {
  return (
    <div className="painel-standalone h-dvh w-full overflow-hidden">
      <AdminForceRefreshListener />
      <Outlet />
    </div>
  );
}
