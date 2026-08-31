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
  it("repete Papel, Cores, Impressão, Acabamento específico e F/V em cada variação", () => {
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
    expect(screen.getAllByLabelText("Formato")).toHaveLength(2);
    expect(screen.getAllByPlaceholderText("Igual ao trabalho")).toHaveLength(2);
    expect(screen.getAllByLabelText("Papel")).toHaveLength(2);
    expect(screen.getAllByLabelText("Cores")).toHaveLength(2);
    expect(screen.getAllByLabelText("Impressão")).toHaveLength(2);
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

  it("não mostra o checkbox Verso em branco", () => {
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
      screen.queryByRole("checkbox", { name: "Verso em branco" }),
    ).not.toBeInTheDocument();
  });

  it("ao escolher 4/0 desmarca F/V", () => {
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

    const selects = screen.getAllByLabelText("Impressão");
    fireEvent.change(selects[0], { target: { value: "4/0" } });
    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0] as TechSpec;
    expect(next.componentes[0].lotes[0].impressao).toBe("4/0");
    expect(next.componentes[0].lotes[0].frente_verso).toBe(false);
  });

  it("abre o seletor de acabamento específico da variação", () => {
    render(
      <TrabalhoComponentes
        spec={spec}
        onChange={vi.fn()}
        readOnly={false}
        maquinas={["Offset"]}
        papeis={["CF 250g"]}
        cores={["4x4"]}
        acabamentos={[{ id: 1, label: "Verniz", variacoes: [] }]}
      />,
    );

    fireEvent.click(screen.getAllByLabelText("Acabamento específico")[0]);
    expect(
      screen.getByRole("dialog", { name: "Incluir acabamentos" }),
    ).toBeInTheDocument();
  });

  it("não abre o seletor de acabamento específico em somente leitura", () => {
    render(
      <TrabalhoComponentes
        spec={spec}
        onChange={vi.fn()}
        readOnly
        maquinas={["Offset"]}
        papeis={["CF 250g"]}
        cores={["4x4"]}
        acabamentos={[]}
      />,
    );

    fireEvent.click(screen.getAllByLabelText("Acabamento específico")[0]);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("grava formato da variação e vazio não persiste override", () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TrabalhoComponentes
        spec={spec}
        onChange={onChange}
        readOnly={false}
        maquinas={["Offset"]}
        papeis={["CF 250g"]}
        cores={["4x4"]}
        acabamentos={[]}
        formatos={[
          { formato: "A4", altura_mm: 210, largura_mm: 297 },
          { formato: "A5", altura_mm: 148, largura_mm: 210 },
        ]}
      />,
    );

    const campos = screen.getAllByLabelText("Formato");
    fireEvent.change(campos[0], { target: { value: "A5" } });
    expect(onChange).toHaveBeenCalled();
    const withFmt = onChange.mock.calls[0][0] as TechSpec;
    expect(withFmt.componentes[0].lotes[0].formato).toBe("A5");
    expect(withFmt.componentes[0].lotes[1].formato).toBeUndefined();

    onChange.mockClear();
    rerender(
      <TrabalhoComponentes
        spec={withFmt}
        onChange={onChange}
        readOnly={false}
        maquinas={["Offset"]}
        papeis={["CF 250g"]}
        cores={["4x4"]}
        acabamentos={[]}
        formatos={[
          { formato: "A4", altura_mm: 210, largura_mm: 297 },
          { formato: "A5", altura_mm: 148, largura_mm: 210 },
        ]}
      />,
    );
    fireEvent.change(screen.getAllByLabelText("Formato")[0], {
      target: { value: "" },
    });
    const cleared = onChange.mock.calls[0][0] as TechSpec;
    expect(cleared.componentes[0].lotes[0].formato).toBeUndefined();
  });
});
