import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PERMISSION_KEYS } from "@/features/auth/types";

import { AccessSimulator } from "./AccessSimulator";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ apiFetch }));
vi.mock("@/api/hooks/useUsuariosQueries", () => ({
  useUsuariosList: () => ({
    data: [{ Ponto: 123, Nome: "Fulano", IPUltimoAcesso: "10.1.1.5", IpsCadastrados: [] }],
  }),
}));

function renderSim(initialPonto?: number) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AccessSimulator initialPonto={initialPonto} />
    </QueryClientProvider>,
  );
}

describe("AccessSimulator", () => {
  beforeEach(() => apiFetch.mockReset());

  it("exige IP na rede local antes de consultar", () => {
    renderSim(123);
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Informe o IP");
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it("consulta o backend e exibe o resultado com a origem de cada chave", async () => {
    const permissoes = Object.fromEntries(PERMISSION_KEYS.map((k) => [k, k === "sb_inicio"]));
    apiFetch.mockResolvedValue({
      ponto: 123,
      ip: "10.1.1.5",
      origem: "local",
      modo: "local_terminal",
      descricao: "Rede local: valem as permissões do terminal.",
      acesso: true,
      usuario: {
        ponto: 123,
        nome: "Fulano",
        conta_ativa: true,
        email_verificado: true,
        permissoes_proprias: false,
      },
      terminal: {
        privilegiado: false,
        cadastro: { id: 7, ip: "10.1.1.%", descricao: "Rede", grupo: "Sala", curinga: true },
      },
      permissoes,
      painel_setores: [],
      painel_setores_legacy_all: false,
      origem_por_chave: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, "ip"])),
      permissoes_terminal: permissoes,
      permissoes_usuario: null,
    });

    renderSim(123);
    fireEvent.change(screen.getByPlaceholderText("Ex.: 10.120.1.12"), {
      target: { value: " 10.1.1.5 " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));

    const result = await screen.findByTestId("access-simulator-result");
    expect(apiFetch).toHaveBeenCalledWith(
      "/admin/access/preview?ponto=123&ip=10.1.1.5&origem=local",
    );
    expect(within(result).getByText("Acesso permitido")).toBeInTheDocument();
    expect(within(result).getByText(/por curinga/)).toBeInTheDocument();
    expect(within(result).getAllByText("liberado")).toHaveLength(1);
  });

  it("internet não envia IP", async () => {
    apiFetch.mockResolvedValue({
      ponto: 123,
      ip: null,
      origem: "internet",
      modo: "conta_inativa",
      descricao: "Conta inativa",
      acesso: false,
      usuario: null,
      terminal: null,
      permissoes: null,
      painel_setores: [],
      painel_setores_legacy_all: false,
      origem_por_chave: {},
      permissoes_terminal: null,
      permissoes_usuario: null,
    });
    renderSim(123);
    fireEvent.click(screen.getByRole("button", { name: "Internet" }));
    fireEvent.click(screen.getByRole("button", { name: "Simular" }));
    expect(await screen.findByText("Acesso negado")).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith("/admin/access/preview?ponto=123&ip=&origem=internet");
  });
});
