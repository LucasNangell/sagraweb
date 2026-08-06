import { Outlet } from "@tanstack/react-router";

/** Layout público — sem AppShell / sidebar autenticada */
export function PortalLayout() {
  return (
    <div className="min-h-screen bg-sagra-bg text-sagra-text">
      <Outlet />
    </div>
  );
}
