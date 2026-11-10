import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { UsuarioRecord } from "@/features/usuarios/types";

import { ConfirmProvider } from "./ConfirmDialog";
import { FeedbackProvider } from "./Feedback";
import { UserDrawer } from "./UserDrawer";

const api = vi.hoisted(() => ({
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
  useSetoresLookup: () => ({ data: ["SEFOC", "CGRAF"], isLoading: false }),
}));
vi.mock("@/api/hooks/useAdminIpsQueries", () => ({
  useAdminIpList: () => ({ data: [] }),
}));
vi.mock("@/features/dashboard-tablet/api", () => ({
  deleteUserFace: vi.fn(),
  enrollUserFace: vi.fn(),
  fetchUserFaceStatus: vi.fn().mockResolvedValue({ has_face: false }),
}));

const internetUser: UsuarioRecord = {
  Ponto: 123,
  Nome: "Fulano",
  Setor: "SEFOC",
  Fornecedor: 0,
  UltimoAcesso: null,
  Email: "fulano@camara.leg.br",
  EmailVerified: 1,
  AuthAtivo: 0,
  ContaInternet: 1,
};

function wrap(ui: ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <FeedbackProvider>
        <ConfirmProvider>{ui}</ConfirmProvider>
      </FeedbackProvider>
    </QueryClientProvider>,
  );
}

describe("UserDrawer", () => {
  beforeEach(() => {
    for (const fn of Object.values(api)) fn.mockReset();
    api.fetchUserIps.mockResolvedValue({ ponto: 123, ips: [{ id: 1, ip: "10.1.1.5" }] });
    api.fetchUserPermissions.mockResolvedValue({
      ip: "user:123",
      sb_inicio: true,
      sb_dashboard_setor: true,
      painel_setores: ["SEFOC"],
    });
    api.updateUserPermissions.mockResolvedValue(undefined);
    api.updateUserProfile.mockResolvedValue(undefined);
    api.updateUserIps.mockResolvedValue(undefined);
    api.deleteAuthUser.mockResolvedValue(undefined);
  });

  it("conta inativa abre desmarcada e salvar permissões não reativa a conta", async () => {
    const onChanged = vi.fn();
    wrap(
      <UserDrawer
        ponto={123}
        user={internetUser}
        allUsers={[internetUser]}
        onClose={vi.fn()}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByText("Acesso internet"));
    expect(screen.getByRole("checkbox", { name: /Conta ativa/ })).not.toBeChecked();

    fireEvent.click(screen.getByText("Permissões"));
    const gerencia = await screen.findByRole("checkbox", { name: /Gerência/ });
    fireEvent.click(gerencia);
    fireEvent.click(screen.getByRole("button", { name: /Salvar permissões/ }));

    await waitFor(() => expect(api.updateUserPermissions).toHaveBeenCalledTimes(1));
    const [ponto, payload] = api.updateUserPermissions.mock.calls[0]!;
    expect(ponto).toBe(123);
    expect(payload).not.toHaveProperty("auth_ativo");
    expect(payload).toMatchObject({
      sb_inicio: true,
      sb_gerencia: true,
      sb_dashboard_setor: true,
      painel_setores: ["SEFOC"],
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("salva perfil com IPs normalizados", async () => {
    wrap(
      <UserDrawer
        ponto={123}
        user={internetUser}
        allUsers={[internetUser]}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    const ips = await screen.findByLabelText("IPs vinculados ao usuário");
    fireEvent.change(ips, { target: { value: "10.1.1.5\n10.1.1.6, 10.1.1.5" } });
    fireEvent.click(screen.getByRole("button", { name: /Salvar perfil/ }));

    await waitFor(() => expect(api.updateUserIps).toHaveBeenCalledWith(123, ["10.1.1.5", "10.1.1.6"]));
    expect(api.updateUserProfile).toHaveBeenCalledWith(123, {
      nome: "Fulano",
      setor: "SEFOC",
      fornecedor: false,
    });
  });

  it("excluir pede confirmação e só exclui ao confirmar", async () => {
    const onClose = vi.fn();
    wrap(
      <UserDrawer
        ponto={123}
        user={internetUser}
        allUsers={[internetUser]}
        onClose={onClose}
        onChanged={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Excluir usuário/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(api.deleteAuthUser).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Excluir usuário/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Excluir" }));
    await waitFor(() => expect(api.deleteAuthUser).toHaveBeenCalledWith(123));
    expect(onClose).toHaveBeenCalled();
  });

  it("usuário só da rede local sem permissões próprias não mostra o editor", async () => {
    api.fetchUserPermissions.mockResolvedValue({ ip: "user:9", painel_setores: [] });
    const local: UsuarioRecord = { ...internetUser, Email: null, ContaInternet: 0, Ponto: 9 };
    wrap(
      <UserDrawer ponto={9} user={local} allUsers={[local]} onClose={vi.fn()} onChanged={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Permissões"));
    expect(
      await screen.findByText(/sem conta internet e sem permissões próprias/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Salvar permissões/ })).not.toBeInTheDocument();
  });
});
