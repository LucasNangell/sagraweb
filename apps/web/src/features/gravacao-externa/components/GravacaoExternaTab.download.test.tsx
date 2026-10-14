import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const removerOs = vi.fn();

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
          gravacao_status: "pendente",
        },
      ],
      total: 1,
    },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  }),
  useGravacaoExternaDetails: (_ano: number, _nrOs: number, ids: number[]) => ({
    data: ids.map((id) => ({
      id,
      os_ano: 2024,
      os_nro: 1209,
      status: "pendente",
      lancado_por_ponto: "918.713",
      arquivos: [{ id: 10, nome: "a.tif", relative: "a.tif", ordem: 0 }],
      mensagens: [],
    })),
    failed: ids.map(() => false),
    isLoading: false,
    isError: false,
    error: null,
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
  useRemoverOsGravacaoExternaMutation: () => ({
    mutateAsync: removerOs,
    isPending: false,
  }),
}));

vi.mock("@/features/auth/authStore", () => ({
  useAuthStore: (sel: (s: { user: { ponto: number } }) => unknown) =>
    sel({ user: { ponto: 918713, fornecedor: false } }),
}));

let canOperatePerm = true;
let canPendingPerm = true;
vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({
    can: (key: string) => {
      if (key === "sb_gravacao_externa_operador") return canOperatePerm;
      if (key === "sb_gravacao_pendente") return canPendingPerm;
      return true;
    },
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

vi.mock("./GravacaoQueueItemContextMenu", () => ({
  GravacaoQueueItemContextMenu: ({
    children,
    enabled,
    label,
    onRemove,
  }: {
    children: React.ReactNode;
    enabled: boolean;
    label: string;
    onRemove: () => void;
  }) => (
    <>
      {children}
      {enabled ? (
        <button type="button" aria-label={`Menu de contexto ${label}`} onClick={onRemove} />
      ) : null}
    </>
  ),
}));

import { GravacaoExternaTab } from "./GravacaoExternaTab";

describe("GravacaoExternaTab download-all", () => {
  beforeEach(() => {
    canOperatePerm = true;
    canPendingPerm = true;
    removerOs.mockReset();
    removerOs.mockResolvedValue({});
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
    fireEvent.click(screen.getByRole("button", { name: /^01209\/24/i }));

    const downloadBtn = await screen.findByRole("button", { name: /Baixar todos/i });
    fireEvent.click(downloadBtn);

    await waitFor(() => {
      expect(
        screen.getByText(/Preparando arquivos para download/i),
      ).toBeInTheDocument();
    });
    expect(downloadMock).toHaveBeenCalledWith(
      expect.objectContaining({ ano: 2024, nrOs: 1209, gravacaoExternaId: 1 }),
    );
  });

  it("hides Baixar todos without operator permission", async () => {
    canOperatePerm = false;
    render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("button", { name: /^01209\/24/i }));
    await screen.findByText("arquivos-panel");
    expect(screen.queryByRole("button", { name: /Baixar todos/i })).toBeNull();
  });

  it("remove da fila do Birô somente com acesso à página de OPs pendentes", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { unmount } = render(<GravacaoExternaTab />);
    fireEvent.click(screen.getByRole("button", { name: "Menu de contexto OS 01209/24" }));
    await waitFor(() => expect(removerOs).toHaveBeenCalledWith(1));
    unmount();

    canPendingPerm = false;
    render(<GravacaoExternaTab />);
    expect(
      screen.queryByRole("button", { name: "Menu de contexto OS 01209/24" }),
    ).toBeNull();
  });
});
