import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/hooks/useGravacaoExterna", () => ({
  GRAVACAO_EXTERNA_SAFETY_POLL_MS: 60_000,
  useGravacaoExternaOsList: () => ({
    data: {
      items: [
        {
          nr_os: 1001,
          ano: 2026,
          solicitante: "A",
          gravacao_externa_id: 1,
          gravacao_status: "pendente",
          fornecedor_ponto: "100.001",
          fornecedor_nome: "Zeta Gráfica",
        },
        {
          nr_os: 1002,
          ano: 2026,
          solicitante: "B",
          gravacao_externa_id: 2,
          gravacao_status: "pendente",
          fornecedor_ponto: "100.002",
          fornecedor_nome: "Alfa Birô",
        },
        {
          nr_os: 1003,
          ano: 2026,
          solicitante: "C",
          gravacao_externa_id: 3,
          gravacao_status: "iniciada",
          fornecedor_ponto: "100.001",
          fornecedor_nome: "Zeta Gráfica",
        },
        {
          nr_os: 1004,
          ano: 2026,
          solicitante: "D",
          gravacao_externa_id: null,
          gravacao_status: "sem_sessao",
          fornecedor_ponto: null,
        },
      ],
      total: 4,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGravacaoExternaDetail: () => ({
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGravacaoExternaAguardandoEntrega: () => ({
    data: { items: [], total: 0 },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useIniciarGravacaoExternaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useConcluirGravacaoExternaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useLancarEntregaChapasMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoverOsGravacaoExternaMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

let isFornecedor = false;
vi.mock("@/features/auth/authStore", () => ({
  useAuthStore: (sel: (s: { user: { ponto: number; fornecedor: boolean } }) => unknown) =>
    sel({ user: { ponto: 100001, fornecedor: isFornecedor } }),
}));

vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({ can: () => true }),
}));

vi.mock("@/hooks/useMatchMedia", () => ({
  useMatchMedia: () => false,
}));

vi.mock("@/hooks/useDebouncedValue", () => ({
  useDebouncedValue: <T,>(v: T) => v,
}));

vi.mock("../hooks/useGravacaoExternaRealtime", () => ({
  useGravacaoExternaRealtime: () => ({ toast: null, clearToast: vi.fn() }),
}));

vi.mock("./GravacaoExternaPreview", () => ({
  GravacaoExternaArquivosPanel: () => null,
  GravacaoExternaPreview: () => null,
}));

vi.mock("./GravacaoExternaActions", () => ({
  GravacaoExternaActions: () => null,
  GravacaoExternaStatusBadge: () => <span>status</span>,
}));

vi.mock("./GravacaoExternaChatPanel", () => ({
  GravacaoExternaChatPanel: () => null,
}));

vi.mock("./GravacaoQueueItemContextMenu", () => ({
  GravacaoQueueItemContextMenu: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import { GravacaoExternaTab } from "./GravacaoExternaTab";

describe("GravacaoExternaTab agrupamento por fornecedor", () => {
  beforeEach(() => {
    isFornecedor = false;
  });

  it("agrupa as OSs por fornecedor em ordem alfabética, com 'Sem fornecedor' por último", () => {
    render(<GravacaoExternaTab />);

    const groups = screen.getAllByRole("region");
    expect(groups.map((g) => g.getAttribute("aria-label"))).toEqual([
      "Alfa Birô",
      "Zeta Gráfica",
      "Sem fornecedor",
    ]);

    const zeta = screen.getByRole("region", { name: "Zeta Gráfica" });
    expect(within(zeta).getByRole("button", { name: /01001\/26/ })).toBeInTheDocument();
    expect(within(zeta).getByRole("button", { name: /01003\/26/ })).toBeInTheDocument();
    expect(within(zeta).queryByRole("button", { name: /01002\/26/ })).toBeNull();

    const alfa = screen.getByRole("region", { name: "Alfa Birô" });
    expect(within(alfa).getByRole("button", { name: /01002\/26/ })).toBeInTheDocument();

    const sem = screen.getByRole("region", { name: "Sem fornecedor" });
    expect(within(sem).getByRole("button", { name: /01004\/26/ })).toBeInTheDocument();
  });

  it("não agrupa quando o usuário logado é fornecedor", () => {
    isFornecedor = true;
    render(<GravacaoExternaTab />);

    expect(screen.queryAllByRole("region")).toHaveLength(0);
    expect(screen.queryByText("Zeta Gráfica")).toBeNull();
    expect(screen.getByRole("button", { name: /01001\/26/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /01004\/26/ })).toBeInTheDocument();
  });
});
