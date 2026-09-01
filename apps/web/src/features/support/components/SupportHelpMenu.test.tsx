import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { queryKeys } from "@/api/query-keys";
import { useGuidedTourStore } from "@/features/guided-tour/tourStore";

import { SupportHelpMenu } from "./SupportHelpMenu";

const navigate = vi.hoisted(() => vi.fn());

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

vi.mock("@/api/support", () => ({
  fetchSupportSettings: vi.fn(async () => ({ usuario_chat_enabled: false })),
  userManualUrl: () => "/manual",
}));

function renderMenu() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  client.setQueryData(queryKeys.support.settings, {
    usuario_chat_enabled: false,
  });
  return render(
    <QueryClientProvider client={client}>
      <SupportHelpMenu variant="mobile-nav" />
    </QueryClientProvider>,
  );
}

describe("SupportHelpMenu tutorial guiado", () => {
  afterEach(() => {
    navigate.mockReset();
    useGuidedTourStore.getState().stop();
  });

  it("mostra Tutorial guiado e inicia Como fazer andamentos?", () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Ajuda" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Tutorial guiado/i }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Como fazer andamentos?" }),
    );

    expect(navigate).toHaveBeenCalledWith({ to: "/" });
    expect(useGuidedTourStore.getState().tourId).toBe("andamentos");
  });
});
