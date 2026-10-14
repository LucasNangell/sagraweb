import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GravacaoPendenteTab } from "./GravacaoPendenteTab";

const patchControle = vi.fn();
const deleteControle = vi.fn();
const adicionarOs = vi.fn();
const removerOs = vi.fn();
const enviarOs = vi.fn();
const fetchFornecedores = vi.fn();
let canDelete = true;
let canPending = true;
let listItems: Array<Record<string, unknown>> = [];
let detailData: Record<string, unknown> | null = null;
let detailsById: Record<number, Record<string, unknown>> = {};

vi.mock("@/api/gravacaoPendente", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/gravacaoPendente")>()),
  fetchGravacaoPendenteFornecedores: () => fetchFornecedores(),
}));

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
  useGravacaoPendenteDetails: (_ano: number, _nrOs: number, ids: number[]) => ({
    data: ids.map((id) => detailsById[id] ?? (detailData?.["id"] === id ? detailData : undefined)),
    isLoading: false,
    isError: false,
    error: null,
  }),
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
  useEnviarGravacaoPendenteMutation: () => ({ mutateAsync: enviarOs, isPending: false }),
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
    enviarOs.mockReset();
    enviarOs.mockResolvedValue({});
    fetchFornecedores.mockReset();
    fetchFornecedores.mockResolvedValue({ items: [{ ponto: "918.713", nome: "Forn" }] });
    canDelete = true;
    canPending = true;
    listItems = [];
    detailData = null;
    detailsById = {};
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

  describe("card por OS e envio por máquina", () => {
    const capaMioloItems = () => [
      {
        nr_os: 101,
        ano: 2026,
        solicitante: "Cliente",
        componente: "capa",
        gravacao_pendente_id: 42,
        gravacao_pendente_status: "ativa",
      },
      {
        nr_os: 101,
        ano: 2026,
        solicitante: "Cliente",
        componente: "miolo",
        gravacao_pendente_id: 43,
        gravacao_pendente_status: "ativa",
      },
    ];
    const sessionDetail = (
      id: number,
      componente: string,
      chapas: Array<{ maquina: string; quantidade: number }>,
      extra: Record<string, unknown> = {},
    ) => ({
      id,
      os_ano: 2026,
      os_nro: 101,
      cod_status: "manual",
      componente,
      lancado_por_ponto: "918.713",
      status: "ativa",
      arquivos: chapas.map((c, i) => ({
        id: id * 100 + i,
        nome: `${c.maquina}.pdf`,
        maquina: c.maquina,
      })),
      chapas: chapas.map((c, i) => ({ id: id * 10 + i, ...c })),
      ...extra,
    });

    beforeEach(() => {
      vi.spyOn(window, "confirm").mockReturnValue(true);
      vi.spyOn(window, "alert").mockImplementation(() => undefined);
    });

    it("mostra um único card por OS sem chip de componente", () => {
      listItems = capaMioloItems();
      render(<GravacaoPendenteTab />);

      expect(screen.getAllByText("00101/26")).toHaveLength(1);
      expect(screen.queryByText("Capa")).toBeNull();
      expect(screen.queryByText("Miolo")).toBeNull();
    });

    it("soma chapas por máquina entre capa e miolo e envia todos sem seleção", async () => {
      listItems = capaMioloItems();
      detailsById = {
        42: sessionDetail(42, "capa", [{ maquina: "Komori", quantidade: 2 }]),
        43: sessionDetail(43, "miolo", [
          { maquina: "Komori", quantidade: 3 },
          { maquina: "Heidelberg", quantidade: 4 },
        ]),
      };
      render(<GravacaoPendenteTab />);
      fireEvent.click(screen.getByText("00101/26"));

      const komori = screen.getByRole("button", { name: /Komori: 5/ });
      expect(komori).toHaveAttribute("aria-pressed", "false");
      expect(komori.className).toContain("cursor-pointer");
      expect(screen.getByRole("button", { name: /Heidelberg: 4/ })).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Enviar para gravação externa" }));
      await waitFor(() => expect(enviarOs).toHaveBeenCalledTimes(1));
      expect(enviarOs).toHaveBeenCalledWith(
        expect.objectContaining({
          ano: 2026,
          nrOs: 101,
          fornecedorPonto: "918.713",
          gravacaoPendenteIds: [42, 43],
          maquinas: undefined,
        }),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("button", { name: "Enviar para gravação externa" }),
        ).toBeNull(),
      );
    });

    it("envia somente as máquinas selecionadas e mantém a OS aberta", async () => {
      listItems = capaMioloItems();
      detailsById = {
        42: sessionDetail(42, "capa", [{ maquina: "Komori", quantidade: 2 }]),
        43: sessionDetail(43, "miolo", [{ maquina: "Heidelberg", quantidade: 4 }]),
      };
      render(<GravacaoPendenteTab />);
      fireEvent.click(screen.getByText("00101/26"));

      const heidelberg = screen.getByRole("button", { name: /Heidelberg: 4/ });
      fireEvent.click(heidelberg);
      expect(heidelberg).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByText("Somente: Heidelberg")).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "Enviar para gravação externa" }));
      await waitFor(() => expect(enviarOs).toHaveBeenCalledTimes(1));
      expect(enviarOs).toHaveBeenCalledWith(
        expect.objectContaining({
          gravacaoPendenteIds: [42, 43],
          maquinas: ["Heidelberg"],
        }),
      );
      expect(window.confirm).toHaveBeenCalledWith(
        expect.stringContaining("somente os arquivos de Heidelberg"),
      );
      await waitFor(() =>
        expect(screen.getByRole("button", { name: /Heidelberg: 4/ })).toHaveAttribute(
          "aria-pressed",
          "false",
        ),
      );
      expect(
        screen.getByRole("button", { name: "Enviar para gravação externa" }),
      ).toBeTruthy();
    });

    it("selecionar todas as máquinas equivale a enviar a OS inteira", async () => {
      listItems = capaMioloItems().slice(0, 1);
      detailsById = {
        42: sessionDetail(42, "capa", [{ maquina: "Komori", quantidade: 2 }]),
      };
      render(<GravacaoPendenteTab />);
      fireEvent.click(screen.getByText("00101/26"));
      fireEvent.click(screen.getByRole("button", { name: /Komori: 2/ }));
      expect(screen.queryByText(/Somente:/)).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "Enviar para gravação externa" }));
      await waitFor(() => expect(enviarOs).toHaveBeenCalledTimes(1));
      expect(enviarOs).toHaveBeenCalledWith(expect.objectContaining({ maquinas: undefined }));
    });

    it("sinaliza máquinas já enviadas ao Birô", () => {
      listItems = capaMioloItems().slice(0, 1);
      detailsById = {
        42: sessionDetail(42, "capa", [{ maquina: "Komori", quantidade: 2 }], {
          envios: [
            {
              gravacao_pendente_id: 77,
              gravacao_externa_id: 501,
              fornecedor_ponto: "1.234",
              fornecedor_nome: "Birô Alfa",
              maquinas: ["Heidelberg"],
              arquivos: [{ id: 9, nome: "h.pdf", maquina: "Heidelberg" }],
              chapas: [{ id: 1, maquina: "Heidelberg", quantidade: 4 }],
            },
          ],
        }),
      };
      render(<GravacaoPendenteTab />);
      fireEvent.click(screen.getByText("00101/26"));

      expect(screen.getByTitle("Enviado para o Birô Birô Alfa").textContent).toContain(
        "Heidelberg",
      );
      expect(screen.getByText(/Enviado p\/ Birô Birô Alfa · Heidelberg/)).toBeTruthy();
      expect(screen.queryByRole("button", { name: /Heidelberg: 4/ })).toBeNull();
    });

    it("remove todas as sessões do card pelo menu", async () => {
      listItems = capaMioloItems();
      render(<GravacaoPendenteTab />);
      fireEvent.click(screen.getByRole("button", { name: "Menu de contexto OS 00101/26" }));
      await waitFor(() => expect(removerOs).toHaveBeenCalledTimes(2));
      expect(removerOs).toHaveBeenNthCalledWith(1, 42);
      expect(removerOs).toHaveBeenNthCalledWith(2, 43);
    });
  });
});
