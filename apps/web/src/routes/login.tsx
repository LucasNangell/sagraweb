import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";

import { resolveDefaultAppRoute } from "@/components/layout/nav-config";
import { useAuthStore } from "@/features/auth/authStore";

/** Layout das rotas públicas de autenticação (/login, /login/activate, etc.). */
export const Route = createFileRoute("/login")({
  beforeLoad: ({ location }) => {
    const path = location.pathname;
    if (
      path.includes("/activate") ||
      path.includes("/forgot") ||
      path.includes("/reset")
    ) {
      return;
    }
    const { isAuthenticated, isHydrating, permissions } = useAuthStore.getState();
    if (!isHydrating && isAuthenticated) {
      throw redirect({ to: resolveDefaultAppRoute(permissions) });
    }
  },
  component: LoginLayout,
});

function LoginLayout() {
  return (
    <div className="h-full overflow-y-auto">
      <Outlet />
    </div>
  );
}
