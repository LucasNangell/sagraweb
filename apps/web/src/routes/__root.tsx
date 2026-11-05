import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";

import type { QueryClient } from "@tanstack/react-query";

import { OsNotificationHandler } from "@/features/os/components/OsNotificationHandler";

export interface RouterContext {
  queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<RouterContext>()({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      <Outlet />
      <OsNotificationHandler />
    </>
  );
}
