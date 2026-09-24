import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserAdminProvider, UserCadastroForm, UserRowActions } from "./UserAdminPanel";

const api = vi.hoisted(() => ({
  createAuthUser: vi.fn(),
  deleteAuthUser: vi.fn(),
  fetchUserIps: vi.fn(),
  fetchUserPermissions: vi.fn(),
  generatePasswordLink: vi.fn(),
  resendActivation: vi.fn(),
  updateUserIps: vi.fn(),
  updateUserPermissions: vi.fn(),
  updateUserProfile: vi.fn(),
}));

vi.mock("@/api/adminUsers", () => api);
vi.mock("@/api/hooks/useAuxLookups", () => ({
  useSetoresLookup: () => ({ data: ["SEFOC"], isLoading: false }),
}));
vi.mock("@/features/dashboard-tablet/api", () => ({
  deleteUserFace: vi.fn(),
  enrollUserFace: vi.fn(),
  fetchUserFaceStatus: vi.fn().mockResolvedValue({ has_face: false }),
}));
vi.mock("@/api/email", () => ({ fetchGalResolve: vi.fn() }));

describe("UserCadastroForm", () => {
  beforeEach(() => {
    api.createAuthUser.mockReset();
  });

  it("cadastra sem e-mail e exibe o link para definir senha", async () => {
    const link = "http://cgrafsysvm/login/activate?token=abc";
    api.createAuthUser.mockResolvedValue({
      status: "ok",
      ponto: 123,
      email: null,
      activation_link: link,
    });
    const onSuccess = vi.fn();
    const onError = vi.fn();
    render(<UserCadastroForm onSuccess={onSuccess} onError={onError} />);

    fireEvent.change(screen.getByLabelText("Ponto (apenas números)"), {
      target: { value: "123" },
    });
    fireEvent.change(screen.getByLabelText("Nome completo"), {
      target: { value: "Fulano de Tal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cadastrar" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue(link)).toBeInTheDocument();
    });
    expect(api.createAuthUser).toHaveBeenCalledWith(
      expect.objectContaining({ ponto: 123, nome: "Fulano de Tal", email: null }),
    );
    expect(onError).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Copiar" })).toBeInTheDocument();
  });
});

describe("Modal de edição — Redefinir senha", () => {
  beforeEach(() => {
    api.generatePasswordLink.mockReset();
    api.fetchUserIps.mockResolvedValue({ ponto: 55, ips: [] });
  });

  it("gera e exibe o link de redefinição", async () => {
    const link = "http://cgrafsysvm/login/reset?token=xyz";
    api.generatePasswordLink.mockResolvedValue({
      status: "ok",
      ponto: 55,
      tipo: "reset",
      link,
    });

    render(
      <UserAdminProvider onSuccess={vi.fn()} onError={vi.fn()}>
        <UserRowActions ponto={55} nome="Beltrano" setor="SEFOC" contaInternet={1} />
      </UserAdminProvider>,
    );

    expect(screen.getByRole("button", { name: "Permissões" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Editar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Redefinir senha" }));

    await waitFor(() => {
      expect(screen.getByDisplayValue(link)).toBeInTheDocument();
    });
    expect(api.generatePasswordLink).toHaveBeenCalledWith(55);
    expect(screen.getByText("Link de redefinição de senha")).toBeInTheDocument();
  });
});
