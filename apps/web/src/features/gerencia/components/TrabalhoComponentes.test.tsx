import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TrabalhoComponentes } from "./TrabalhoComponentes";
import type { TechSpec } from "../techSpec";

const spec: TechSpec = {
  version: 1,
  componentes: [
    {
      nome: "Capa",
      tipo: "CAPA",
      lotes: [
        {
          id: "l1",
          paginas: 4,
          maquina_link: "Offset",
          papel_link: "CF 250g",
          cores_link: "4x4",
          papel_desc: "",
          cores_desc: "",
          frente_verso: true,
          acabamentos: [{ label: "Laminação" }],
        },
        {
          id: "l2",
          paginas: 4,
          maquina_link: "Digital",
          papel_link: "Offset 90",
          cores_link: "P/B",
          papel_desc: "",
          cores_desc: "",
          frente_verso: false,
          acabamentos: [{ label: "Grampo" }],
        },
      ],
    },
  ],
};

describe("TrabalhoComponentes", () => {
  it("repete Papel, Cores, Acabamento específico e F/V em cada variação", () => {
    render(
      <TrabalhoComponentes
        spec={spec}
        onChange={vi.fn()}
        readOnly={false}
        maquinas={["Offset", "Digital"]}
        papeis={["CF 250g", "Offset 90"]}
        cores={["4x4", "P/B"]}
        acabamentos={[]}
      />,
    );

    expect(screen.getAllByLabelText("Páginas")).toHaveLength(2);
    expect(screen.getAllByLabelText("Papel")).toHaveLength(2);
    expect(screen.getAllByLabelText("Cores")).toHaveLength(2);
    expect(screen.getAllByLabelText("Máquina")).toHaveLength(2);
    expect(screen.getAllByLabelText("Acabamento específico")).toHaveLength(2);
    expect(screen.getAllByText("F/V")).toHaveLength(2);

    const second = screen.getByText("Variação 2").closest("div")?.parentElement;
    expect(second).toBeTruthy();
    expect(within(second as HTMLElement).getByLabelText("Papel")).toHaveValue(
      "Offset 90",
    );
    expect(
      within(second as HTMLElement).getByLabelText("Acabamento específico"),
    ).toHaveValue("Grampo");
  });

  it("não oferece botão para adicionar o componente Arquivo", () => {
    render(
      <TrabalhoComponentes
        spec={spec}
        onChange={vi.fn()}
        readOnly={false}
        maquinas={["Offset"]}
        papeis={["CF 250g"]}
        cores={["4x4"]}
        acabamentos={[]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Arquivo" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Miolo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Encarte" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Outro componente" }),
    ).toBeInTheDocument();
  });

  it("oferece Verso em branco só no componente Capa", () => {
    const onChange = vi.fn();
    render(
      <TrabalhoComponentes
        spec={spec}
        onChange={onChange}
        readOnly={false}
        maquinas={["Offset"]}
        papeis={["CF 250g"]}
        cores={["4x4"]}
        acabamentos={[]}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Verso em branco" });
    expect(checkbox).not.toBeChecked();
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as TechSpec;
    expect(next.componentes[0].verso_em_branco).toBe(true);
  });

  it("não mostra Verso em branco em Miolo", () => {
    render(
      <TrabalhoComponentes
        spec={{
          version: 1,
          componentes: [
            {
              nome: "Miolo",
              tipo: "MIOLO",
              lotes: [
                {
                  id: "m1",
                  paginas: 16,
                  maquina_link: "",
                  papel_link: "",
                  cores_link: "P/B",
                  papel_desc: "",
                  cores_desc: "",
                  frente_verso: false,
                  acabamentos: [],
                },
              ],
            },
          ],
        }}
        onChange={vi.fn()}
        readOnly={false}
        maquinas={["Offset"]}
        papeis={["Offset 90"]}
        cores={["P/B"]}
        acabamentos={[]}
      />,
    );

    expect(
      screen.queryByRole("checkbox", { name: "Verso em branco" }),
    ).not.toBeInTheDocument();
  });
});
