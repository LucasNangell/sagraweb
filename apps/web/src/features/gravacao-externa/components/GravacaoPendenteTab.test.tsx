import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GravacaoPendenteTab } from "./GravacaoPendenteTab";

const patchNf = vi.fn();
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
  usePatchGravacaoPendentePagamentoNfMutation: () => ({
    mutateAsync: patchNf,
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
    patchNf.mockReset();
    patchNf.mockResolvedValue({});
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
      ]),
    );
  });

  it("mantém NF bloqueada até editar e mostra exclusão autorizada", async () => {
    render(<GravacaoPendenteTab />);
    fireEvent.click(screen.getByRole("button", { name: "Expandir lista de controle" }));

    const input = screen.getByLabelText("Pagamento NF OS 00100/26");
    expect(input).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Editar Pagamento NF OS 00100/26" }));
    expect(input).toHaveProperty("disabled", false);
    fireEvent.change(input, { target: { value: "2026-07-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar Pagamento NF OS 00100/26" }));
    await waitFor(() => {
      expect(patchNf).toHaveBeenCalledWith({
        gravacaoExternaId: 84,
        pagamento_nf_em: "2026-07-10T12:00:00",
      });
    });
    expect(screen.getByRole("button", { name: "Excluir controle OS 00100/26" })).toBeTruthy();
  });

  it("oculta exclusão sem a permissão específica", () => {
    canDelete = false;
    render(<GravacaoPendenteTab />);
    expect(screen.queryByRole("button", { name: "Excluir controle OS 00100/26" })).toBeNull();
  });
});
