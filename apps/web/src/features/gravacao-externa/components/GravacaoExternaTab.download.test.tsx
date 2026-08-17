import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/hooks/useGravacaoExterna", () => ({
  GRAVACAO_EXTERNA_SAFETY_POLL_MS: 60_000,
  useGravacaoExternaOsList: () => ({
    data: {
      items: [
        {
          nr_os: 1209,
          ano: 2024,
          solicitante: "Teste",
          produto: null,
          situacao: "Gravação Externa",
          gravacao_externa_id: 1,
          gravacao_externa_status: "pendente",
        },
      ],
      total: 1,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGravacaoExternaDetail: () => ({
    data: {
      id: 1,
      os_ano: 2024,
      os_nro: 1209,
      status: "pendente",
      lancado_por_ponto: "918.713",
      arquivos: [{ id: 10, nome: "a.tif", relative: "a.tif", ordem: 0 }],
      mensagens: [],
    },
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
}));

vi.mock("@/features/auth/authStore", () => ({
  useAuthStore: (sel: (s: { user: { ponto: number } }) => unknown) =>
    sel({ user: { ponto: 918713 } }),
}));

let canOperatePerm = true;
vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({
    can: (key: string) =>
      key === "sb_gravacao_externa_operador" ? canOperatePerm : true,
  }),
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

const downloadMock = vi.fn();
vi.mock("@/features/gravacao-externa/utils/downloadGravacaoExternaZipAll", () => ({
  downloadGravacaoExternaZipAll: (...args: unknown[]) => downloadMock(...args),
}));

vi.mock("./GravacaoExternaPreview", () => ({
  GravacaoExternaArquivosPanel: () => <div>arquivos-panel</div>,
  GravacaoExternaPreview: () => <div>preview</div>,
}));

vi.mock("./GravacaoExternaActions", () => ({
  GravacaoExternaActions: () => null,
  GravacaoExternaStatusBadge: () => <span>Pendente</span>,
}));

vi.mock("./GravacaoExternaChatPanel", () => ({
  GravacaoExternaChatPanel: () => null,
}));

import { GravacaoExternaTab } from "./GravacaoExternaTab";

describe("GravacaoExternaTab download-all", () => {
  beforeEach(() => {
    canOperatePerm = true;
    downloadMock.mockReset();
    downloadMock.mockImplementation(
      async (opts: { onPhase?: (p: string) => void }) => {
        opts.onPhase?.("preparing");
        await new Promise((r) => setTimeout(r, 30));
        opts.onPhase?.("idle");
      },
    );
  });

  it("shows preparing banner when Baixar todos is clicked", async () => {
    render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("button", { name: /01209\/24/i }));

    const downloadBtn = await screen.findByRole("button", { name: /Baixar todos/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Preparando arquivos para download/i),
      ).toBeInTheDocument();
    });
    expect(downloadMock).toHaveBeenCalled();
  });

  it("hides Baixar todos without operator permission", async () => {
    canOperatePerm = false;
    render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("button", { name: /01209\/24/i }));
    await screen.findByText("arquivos-panel");
    expect(screen.queryByRole("button", { name: /Baixar todos/i })).toBeNull();
  });
});
