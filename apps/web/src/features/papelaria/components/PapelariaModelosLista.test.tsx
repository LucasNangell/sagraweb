import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PapelariaCorelModelSummary, PapelariaFacesResponse } from "@/features/papelaria/types";

import { composicaoMantendoVerso } from "./PapelariaFrenteVersoPicker";
import { PapelariaModelosLista, resumoListaModelos } from "./PapelariaModelosLista";

const fonte = (modelo_id: number, pagina: number, rotulo: string, extra = {}) => ({
  modelo_id,
  pagina,
  rotulo,
  arquivo_modelo: `${rotulo}.pdf`,
  tem_pdf: true,
  padrao: false,
  ...extra,
});

const faces: PapelariaFacesResponse = {
  produto: "Ct Visita",
  cores: "Policromia",
  disponivel: true,
  modo_prova_pdf: true,
  papel_modelo: "frente",
  frente: [fonte(15, 1, "Ct Visita F", { padrao: true }), fonte(16, 1, "Ct Visita Relevo", { tem_pdf: false })],
  verso: [fonte(27, 1, "Verso padrão", { padrao: true }), fonte(30, 1, "Verso Redes")],
  padrao: { frente: { modelo_id: 15, pagina: 1 }, verso: { modelo_id: 27, pagina: 1 } },
};

const modelo = (id: number, nome: string): PapelariaCorelModelSummary =>
  ({ id, nome_exibicao: nome, arquivo_modelo: `${nome}.cdr`, produto: "Ct Visita", frente_versao: "Somente Frente", cores: "Policromia" }) as PapelariaCorelModelSummary;

describe("PapelariaModelosLista", () => {
  it("frente e verso: mostra Frentes e Versos (só o nome) e escolhe cada um", () => {
    const onSelectFrente = vi.fn();
    const onSelectVerso = vi.fn();
    render(
      <PapelariaModelosLista
        modelos={[modelo(15, "Ct Visita F")]}
        selectedModelId={15}
        onSelectModel={vi.fn()}
        faces={faces}
        composicao={{ frente: { modelo_id: 15, pagina: 1 }, verso: { modelo_id: 27, pagina: 1 } }}
        onSelectFrente={onSelectFrente}
        onSelectVerso={onSelectVerso}
      />,
    );
    const frentes = screen.getByRole("region", { name: "Frentes" });
    const versos = screen.getByRole("region", { name: "Versos" });
    expect(within(frentes).getAllByRole("button").map((b) => b.textContent)).toEqual(["Ct Visita F"]); // sem PDF fica de fora
    expect(within(versos).getByRole("button", { name: "Verso padrão" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(versos).getByRole("button", { name: "Verso Redes" }));
    expect(onSelectVerso).toHaveBeenCalledWith(expect.objectContaining({ modelo_id: 30, pagina: 1 }));
    expect(resumoListaModelos([], faces, { frente: faces.padrao.frente!, verso: faces.padrao.verso! })).toBe("1 frente · 2 versos");
  });

  it("produto só frente: lista os modelos só com o nome", () => {
    const onSelectModel = vi.fn();
    render(
      <PapelariaModelosLista modelos={[modelo(1, "Bloco A5"), modelo(2, "Bloco A5 RS")]} selectedModelId={1} onSelectModel={onSelectModel} />,
    );
    const botoes = screen.getAllByRole("button");
    expect(botoes.map((b) => b.textContent)).toEqual(["Bloco A5", "Bloco A5 RS"]);
    fireEvent.click(botoes[1]!);
    expect(onSelectModel).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));
  });
});

describe("composicaoMantendoVerso", () => {
  it("ao trocar a frente, mantém o verso já escolhido", () => {
    const anterior = { frente: { modelo_id: 15, pagina: 1 }, verso: { modelo_id: 30, pagina: 1 } };
    const facesComOutraFrente = { ...faces, frente: [...faces.frente, fonte(40, 1, "Outra frente")] };
    expect(composicaoMantendoVerso(facesComOutraFrente, 40, "card", anterior)).toEqual({
      frente: { modelo_id: 40, pagina: 1 },
      verso: { modelo_id: 30, pagina: 1 },
    });
    // Sem escolha anterior: padrões.
    expect(composicaoMantendoVerso(faces, 15, "auto", null)).toEqual({
      frente: { modelo_id: 15, pagina: 1 },
      verso: { modelo_id: 27, pagina: 1 },
    });
  });
});
