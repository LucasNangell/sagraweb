import { createFileRoute } from "@tanstack/react-router";

import { ClienteLoginPage } from "@/features/cliente/components/ClienteLoginPage";

export const Route = createFileRoute("/cliente/login/")({
  component: ClienteLoginPage,
});
