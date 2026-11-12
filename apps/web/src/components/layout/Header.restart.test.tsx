import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useAuthStore } from "@/features/auth/authStore";
import { parsePermissionsFromApi } from "@/features/auth/permissions";
import { homeTestIds } from "@/lib/testId";

import { Header } from "./Header";

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/features/sync-andamentos/useSyncAndamentosServiceAlert", () => ({
  useSyncAndamentosServiceAlert: () => false,
}));

vi.mock("@/features/support/components/NotificationCenter", () => ({
  NotificationCenter: () => <div data-testid="notifications-stub" />,
}));

describe("Header restart button", () => {
  beforeEach(() => {
    useAuthStore.setState({
      isAuthenticated: true,
      isHydrating: false,
      user: { ponto: 1, nome: "Admin", ip: "127.0.0.1" },
      permissions: parsePermissionsFromApi({ sb_inicio: true }),
    });
  });

  it("não mostra o botão sem sb_reiniciar_sistema", () => {
    render(<Header />);
    expect(screen.queryByTestId(homeTestIds.headerRestartSystem)).toBeNull();
  });

  it("mostra o botão com sb_reiniciar_sistema", () => {
    useAuthStore.setState({
      permissions: parsePermissionsFromApi({
        sb_inicio: true,
        sb_reiniciar_sistema: true,
      }),
    });
    render(<Header />);
    expect(screen.getByTestId(homeTestIds.headerRestartSystem)).toBeInTheDocument();
  });
});
