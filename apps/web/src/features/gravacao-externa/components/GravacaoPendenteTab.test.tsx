import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GravacaoPendenteTab } from "./GravacaoPendenteTab";

const patchControle = vi.fn();
const deleteControle = vi.fn();
let canDelete = true;

vi.mock("@/api/hooks/useGravacaoPendente", () => ({
  useGravacaoPendenteOsList: () => ({ data: { items: [] }, isPending: false }),
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
  useGravacaoPendenteDetail: () => ({ data: null }),
  useGravacaoPendenteFornecedores: () => ({
    data: { items: [{ ponto: "918.713", nome: "Forn" }] },
    isPending: false,
  }),
  usePatchGravacaoPendenteControleMutation: () => ({
    mutateAsync: patchControle,
    isPending: false,
  }),
  useDeleteGravacaoPendenteControleMutation: () => ({
    mutateAsync: deleteControle,
    isPending: false,
  }),
  useEnviarGravacaoPendenteMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock("@/features/auth/useAccessControl", () => ({
  useAccessControl: () => ({ can: () => canDelete }),
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

describe("GravacaoPendenteTab controle", () => {
  beforeEach(() => {
    patchControle.mockReset();
    patchControle.mockResolvedValue({});
    deleteControle.mockReset();
    deleteControle.mockResolvedValue({});
    canDelete = true;
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
});
