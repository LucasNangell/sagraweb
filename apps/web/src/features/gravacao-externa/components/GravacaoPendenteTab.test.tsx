import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GravacaoPendenteTab } from "./GravacaoPendenteTab";

const patchControle = vi.fn();
const deleteControle = vi.fn();
const adicionarOs = vi.fn();
const removerOs = vi.fn();
let canDelete = true;
let canPending = true;
let listItems: Array<Record<string, unknown>> = [];
let detailData: Record<string, unknown> | null = null;

vi.mock("@/api/hooks/useGravacaoPendente", () => ({
  useGravacaoPendenteOsList: () => ({ data: { items: listItems }, isPending: false }),
  useGravacaoPendenteHistorico: () => ({
    data: {
      items: [
        {
          gravacao_pendente_id: 42,
          gravacao_externa_id: 84,
          ano: 2026,
          nr_os: 100,
          solicitante: "Cliente",
          titulo: "Título",
          criado_em: "2026-07-01T10:00:00",
          enviada_em: "2026-07-02T10:00:00",
          concluida_em: "2026-07-03T10:00:00",
          entrega_lancada_em: "2026-07-04T10:00:00",
          pagamento_nf_em: "2026-07-05T12:00:00",
          total_chapas: 3,
          chapas_por_maquina: [{ maquina: "Komori", quantidade: 3 }],
        },
      ],
      total_chapas_geral: 3,
      chapas_restantes: 7,
      maquinas: [],
    },
    isPending: false,
  }),
  useGravacaoPendenteDetail: () => ({ data: detailData, isLoading: false }),
  useGravacaoPendenteFornecedores: () => ({
    data: { items: [{ ponto: "918.713", nome: "Forn" }] },
    isPending: false,
  }),
  usePatchGravacaoPendenteControleMutation: () => ({
    mutateAsync: patchControle,
    isPending: false,
  }),
  usePatchGravacaoPendenteObservacaoMutation: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteGravacaoPendenteControleMutation: () => ({
    mutateAsync: deleteControle,
    isPending: false,
  }),
  useEnviarGravacaoPendenteMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useAdicionarOsGravacaoPendenteMutation: () => ({
    mutateAsync: adicionarOs,
    isPending: false,
  }),
  useRemoverOsGravacaoPendenteMutation: () => ({
    mutateAsync: removerOs,
    isPending: false,
  }),
}));

vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({
    can: (key: string) =>
      key === "sb_gravacao_pendente_excluir" ? canDelete : canPending,
  }),
}));

vi.mock("@/features/auth/authStore", () => ({
  useAuthStore: (sel: (s: { user: { fornecedor?: boolean } | null }) => unknown) =>
    sel({ user: { fornecedor: false } }),
}));

vi.mock("@/hooks/useMatchMedia", () => ({ useMatchMedia: () => false }));
vi.mock("./GravacaoPendenteHistoricoCota", () => ({
  GravacaoPendenteHistoricoCota: () => <div />,
}));
vi.mock("./GravacaoExternaPreview", () => ({
  GravacaoExternaArquivosPanel: () => <div />,
  GravacaoExternaPreview: () => <div />,
}));
vi.mock("./GravacaoFornecedorSelectModal", () => ({
  GravacaoFornecedorSelectModal: () => null,
}));
vi.mock("./GravacaoPendenteAdicionarOsModal", () => ({
  GravacaoPendenteAdicionarOsModal: ({ open }: { open: boolean }) =>
    open ? <div role="dialog" aria-label="Adicionar OS à Gravação Pendente" /> : null,
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

describe("GravacaoPendenteTab controle", () => {
  beforeEach(() => {
    patchControle.mockReset();
    patchControle.mockResolvedValue({});
    deleteControle.mockReset();
    deleteControle.mockResolvedValue({});
    adicionarOs.mockReset();
    adicionarOs.mockResolvedValue({});
    removerOs.mockReset();
    removerOs.mockResolvedValue({});
    canDelete = true;
    canPending = true;
    listItems = [];
    detailData = null;
  });

  it("usa novos títulos e ordem das colunas", () => {
    render(<GravacaoPendenteTab />);
    fireEvent.click(screen.getByRole("button", { name: "Expandir lista de controle" }));

    const headers = screen.getAllByRole("columnheader").map((header) => header.textContent);
    expect(headers.indexOf("Chapas / máquina")).toBeLessThan(
      headers.indexOf("Disp. p/ Gravação"),
    );
    expect(headers).toEqual(
      expect.arrayContaining([
        "Saída p/ Birô",
        "Grav. Concluída",
        "Receb. CGRAF",
        "Recebido por",
        "Pagamento NF",
        "Ações",
      ]),
    );
  });

  it("abre modal de edição pelo lápis e salva via PATCH completo", async () => {
    render(<GravacaoPendenteTab />);
    fireEvent.click(screen.getByRole("button", { name: "Expandir lista de controle" }));

    expect(screen.queryByLabelText("Pagamento NF OS 00100/26")).toBeNull();
    expect(screen.getByText(/05\/07\/2026|5\/7\/2026/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Editar controle OS 00100/26" }));
    const dialog = screen.getByRole("dialog", { name: "Editar controle de chapas" });
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).toContain("Cliente");
    expect(dialog.textContent).toContain("Título");
    expect(dialog.textContent).toContain("OS / Ano");

    // Campos bloqueados não são inputs editáveis
    expect(screen.queryByRole("textbox", { name: "Cliente" })).toBeNull();
    expect(screen.queryByRole("textbox", { name: "Título" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Chapas Komori"), { target: { value: "4" } });
    fireEvent.change(screen.getByLabelText("Pagamento NF"), {
      target: { value: "2026-07-10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    await waitFor(() => {
      expect(patchControle).toHaveBeenCalledWith({
        gravacaoPendenteId: 42,
        body: expect.objectContaining({
          chapas: [{ maquina: "Komori", quantidade: 4 }],
          pagamento_nf_em: "2026-07-10T12:00:00",
        }),
      });
    });
  });

  it("mostra exclusão autorizada e oculta sem a permissão específica", () => {
    const { unmount } = render(<GravacaoPendenteTab />);
    expect(screen.getByRole("button", { name: "Excluir controle OS 00100/26" })).toBeTruthy();
    unmount();

    canDelete = false;
    render(<GravacaoPendenteTab />);
    expect(screen.queryByRole("button", { name: "Excluir controle OS 00100/26" })).toBeNull();
    expect(screen.getByRole("button", { name: "Editar controle OS 00100/26" })).toBeTruthy();
  });

  it("mantém o envio no detalhe e adiciona o novo botão no rodapé da lista", () => {
    listItems = [
      {
        nr_os: 101,
        ano: 2026,
        solicitante: "Cliente",
        gravacao_pendente_id: 42,
        gravacao_pendente_status: "ativa",
      },
    ];
    detailData = {
      id: 42,
      os_ano: 2026,
      os_nro: 101,
      cod_status: "manual",
      lancado_por_ponto: "918.713",
      status: "ativa",
      arquivos: [],
      chapas: [],
    };

    render(<GravacaoPendenteTab />);

    expect(
      screen.queryByRole("button", { name: "Enviar para gravação externa" }),
    ).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Adicionar OS" }));
    expect(
      screen.getByRole("dialog", { name: "Adicionar OS à Gravação Pendente" }),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("00101/26"));
    expect(
      screen.getByRole("button", { name: "Enviar para gravação externa" }),
    ).toBeEnabled();
  });

  it("remove pelo menu somente com acesso à página de OPs para gravação externa", async () => {
    listItems = [
      {
        nr_os: 101,
        ano: 2026,
        gravacao_pendente_id: 42,
        gravacao_pendente_status: "ativa",
      },
    ];
    vi.spyOn(window, "confirm").mockReturnValue(true);

    const { unmount } = render(<GravacaoPendenteTab />);
    fireEvent.click(screen.getByRole("button", { name: "Menu de contexto OS 00101/26" }));
    await waitFor(() => expect(removerOs).toHaveBeenCalledWith(42));
    unmount();

    canPending = false;
    render(<GravacaoPendenteTab />);
    expect(
      screen.queryByRole("button", { name: "Menu de contexto OS 00101/26" }),
    ).toBeNull();
  });
});
