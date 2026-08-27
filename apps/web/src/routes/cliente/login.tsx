import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout das rotas públicas do portal do cliente (/cliente/login, /cliente/login/activate). */
export const Route = createFileRoute("/cliente/login")({
  component: ClienteLoginLayout,
});

function ClienteLoginLayout() {
  return (
    <div className="h-full overflow-y-auto">
      <Outlet />
    </div>
  );
}
