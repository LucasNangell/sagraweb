import { Outlet } from "@tanstack/react-router";

/** Layout público — sem AppShell / sidebar autenticada */
export function PortalLayout() {
  return (
    <div className="h-full overflow-y-auto bg-sagra-bg text-sagra-text">
      <Outlet />
    </div>
  );
}
