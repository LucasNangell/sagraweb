import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ImposicaoVariantesResponse } from "@/features/papelaria/imposicao/perfil/types";

const previaMock = vi.fn();
vi.mock("@/api/imposicaoPerfil", () => ({
  fetchPreviaJuntada: (...args: unknown[]) => previaMock(...args),
}));

import { PapelariaImposicaoVarianteDialog } from "./PapelariaImposicaoVarianteDialog";

function opcoes(over: Partial<ImposicaoVariantesResponse> = {}): ImposicaoVariantesResponse {
  return {
    produto: "Produto X",
    variantes: {
      offset: {
        disponivel: true,
        fonte: "perfil",
        resumo: "745×605 mm · 4 slots · marcas ✓",
        destino_pdf: "offset",
        erros: [],
      },
      digital: {
        disponivel: false,
        fonte: null,
        resumo: null,
        destino_pdf: null,
        erros: ["Variante não configurada para este produto."],
      },
    },
    juntada: {},
    variantes_disponiveis: ["offset"],
    ...over,
  };
}

describe("PapelariaImposicaoVarianteDialog", () => {
  beforeEach(() => previaMock.mockReset());

  it("mostra o aviso quando o PDF da OS só tem a frente e continua permitindo gerar", () => {
    const onConfirm = vi.fn();
    const base = opcoes();
    render(
      <PapelariaImposicaoVarianteDialog
        open
        ano={2026}
        nro={6001}
        modeloId={7}
        opcoes={{
          ...base,
          variantes: {
            ...base.variantes,
            offset: { ...base.variantes.offset, aviso: "O PDF da OS tem 1 página: será gerado só frente." },
          },
        }}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByTestId("imposicao-variante-offset-aviso")).toHaveTextContent("só frente");
    fireEvent.click(screen.getByTestId("imposicao-variante-offset"));
    expect(onConfirm).toHaveBeenCalledWith({ variante: "offset", juntada_os: [] });
  });

  it("pergunta só Offset ou Digital e gera direto quando não há juntada", () => {
    const onConfirm = vi.fn();
    render(
      <PapelariaImposicaoVarianteDialog
        open
        ano={2026}
        nro={6001}
        modeloId={7}
        opcoes={opcoes()}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByText("Imposição Offset ou Digital?")).toBeInTheDocument();
    expect(screen.getByTestId("imposicao-variante-digital")).toBeDisabled();
    expect(screen.getByText("Variante não configurada para este produto.")).toBeInTheDocument();
    expect(screen.queryByRole("spinbutton")).toBeNull();
    fireEvent.click(screen.getByTestId("imposicao-variante-offset"));
    expect(onConfirm).toHaveBeenCalledWith({ variante: "offset", juntada_os: [] });
  });

  it("com candidatas, mostra o passo de juntada e envia as OSs marcadas", async () => {
    previaMock.mockResolvedValue({ ok: true, slots: [2, 2], total_slots: 4, folhas: 500, max_slots: 4 });
    const onConfirm = vi.fn();
    render(
      <PapelariaImposicaoVarianteDialog
        open
        ano={2026}
        nro={6001}
        modeloId={7}
        opcoes={opcoes({
          juntada: {
            offset: {
              situacao: "Aguard. Juntada",
              max_os: 4,
              candidatas: [{ ano: 2026, nro: 6100, produto: "Produto X", tiragem: 500, label: "06100-Fulano" }],
            },
          },
        })}
        onClose={() => {}}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("imposicao-variante-offset"));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText(/juntar OSs\?/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    await waitFor(() => expect(screen.getByText(/Slots: 2 \+ 2 = 4 de 4/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Gerar JDF com 2 OSs/ }));
    expect(onConfirm).toHaveBeenCalledWith({
      variante: "offset",
      juntada_os: [{ ano: 2026, nro: 6100 }],
    });
  });
});
