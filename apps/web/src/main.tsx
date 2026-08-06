import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { AuthBootstrap } from "@/components/auth/AuthBootstrap";
import { PwaProvider } from "@/components/pwa/PwaUpdatePrompt";
import { AppErrorBoundary } from "@/components/ui/AppErrorBoundary";
import { queryClient } from "@/lib/query-client";
import { routeTree } from "./routeTree.gen";
import "./index.css";

const routerBasepath =
  import.meta.env.BASE_URL === "/"
    ? undefined
    : import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createRouter({
  routeTree,
  basepath: routerBasepath,
  context: {
    queryClient,
  },
  defaultPreload: "intent",
  defaultNotFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-sagra-bg p-6 text-center">
      <p className="text-lg font-semibold text-secondary-blue">Página não encontrada</p>
      <a
        href={`${import.meta.env.BASE_URL}login`}
        className="text-sm text-primary-green underline"
      >
        Ir para o login
      </a>
    </div>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Elemento #root não encontrado");
}

createRoot(rootEl).render(
  <StrictMode>
    <AppErrorBoundary>
      <PwaProvider>
        <QueryClientProvider client={queryClient}>
          <AuthBootstrap>
            <RouterProvider router={router} />
          </AuthBootstrap>
        </QueryClientProvider>
      </PwaProvider>
    </AppErrorBoundary>
  </StrictMode>,
);
