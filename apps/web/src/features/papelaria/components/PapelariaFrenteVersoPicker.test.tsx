import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PapelariaFaceFonte, PapelariaFacesResponse } from "@/features/papelaria/types";

import { composicaoInicial, ehFrenteVerso, PapelariaFrenteVersoPicker } from "./PapelariaFrenteVersoPicker";

function fonte(modelo_id: number, pagina: number, extra: Partial<PapelariaFaceFonte> = {}): PapelariaFaceFonte {
  return { modelo_id, pagina, rotulo: `M${modelo_id} p${pagina}`, arquivo_modelo: `m${modelo_id}.cdr`, tem_pdf: true, padrao: false, ...extra };
}

function faces(over: Partial<PapelariaFacesResponse> = {}): PapelariaFacesResponse {
  return {
    produto: "Ct Visita",
    cores: "Policromia",
    disponivel: true,
    modo_prova_pdf: true,
    papel_modelo: "frente_verso",
    frente: [fonte(12, 1), fonte(15, 1, { padrao: true }), fonte(13, 1, { tem_pdf: false })],
    verso: [fonte(12, 2), fonte(30, 1, { padrao: true }), fonte(13, 2, { tem_pdf: false })],
    padrao: { frente: { modelo_id: 15, pagina: 1 }, verso: { modelo_id: 30, pagina: 1 } },
    ...over,
  };
}

describe("composicaoInicial", () => {
  it("na abertura da OS usa o verso padrão", () => {
    expect(composicaoInicial(faces(), 15, "auto")).toEqual({
      frente: { modelo_id: 15, pagina: 1 },
      verso: { modelo_id: 30, pagina: 1 },
    });
  });

  it("ao clicar num card usa a frente e o verso daquele modelo", () => {
    expect(composicaoInicial(faces(), 12, "card")).toEqual({
      frente: { modelo_id: 12, pagina: 1 },
      verso: { modelo_id: 12, pagina: 2 },
    });
  });

  it("ignora opções sem PDF do modelo", () => {
    expect(composicaoInicial(faces(), 13, "card")).toEqual({
      frente: { modelo_id: 15, pagina: 1 },
      verso: { modelo_id: 30, pagina: 1 },
    });
  });

  it("detecta produto frente e verso", () => {
    expect(ehFrenteVerso("Frente e Verso")).toBe(true);
    expect(ehFrenteVerso("Somente Frente")).toBe(false);
  });
});

describe("PapelariaFrenteVersoPicker", () => {
  it("troca o verso e restaura o padrão", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <PapelariaFrenteVersoPicker
        faces={faces()}
        value={{ frente: { modelo_id: 15, pagina: 1 }, verso: { modelo_id: 30, pagina: 1 } }}
        onChange={onChange}
      />,
    );
    expect(screen.queryByRole("button", { name: /Usar padrão/ })).not.toBeInTheDocument();
    const verso = screen.getByLabelText("Modelo do verso");
    expect(within(verso).getByRole("option", { name: /M13 p2 \(sem PDF do modelo\)/ })).toBeDisabled();

    fireEvent.change(verso, { target: { value: "12:2" } });
    expect(onChange).toHaveBeenLastCalledWith({
      frente: { modelo_id: 15, pagina: 1 },
      verso: { modelo_id: 12, pagina: 2 },
    });

    rerender(
      <PapelariaFrenteVersoPicker
        faces={faces()}
        value={{ frente: { modelo_id: 15, pagina: 1 }, verso: { modelo_id: 12, pagina: 2 } }}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Usar padrão/ }));
    expect(onChange).toHaveBeenLastCalledWith({
      frente: { modelo_id: 15, pagina: 1 },
      verso: { modelo_id: 30, pagina: 1 },
    });
  });
});

